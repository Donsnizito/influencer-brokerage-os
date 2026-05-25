import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { findExistingEvent, recordReceive, markProcessed, markFailed } from './utils/webhook_idempotency.js';
import { verifyPandaDocSignature } from './utils/pandadoc_signature.js';
import fs from 'fs';
import { releasePayout, createInvoices } from './skills/payment_handler.js';
import { generateContracts } from './skills/contract_generator.js';
import { dealsTable, influencersTable, brandsTable, fetchRecords, updateRecord, createRecord } from './utils/airtable.js';
import { logActivity } from './utils/logger.js';
import { getTrackingInfo, updateTrackingInfo } from './utils/tracker.js';
import { getParentNiche, getChildNiches, getParentLabel } from './utils/niches.js';
import multer from 'multer';
import { verifyInboundSignature } from './utils/sendgrid_signature.js';
import { processInboundEmail } from './skills/negotiation_handler.js';
import { Readable } from 'stream';
import { pandaDocClient } from './utils/pandadoc_client.js';
import { logError, Tiers } from './utils/errorHandler.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const upload = multer();

// ------------------------------------------------------------------
// Static Dashboard (served BEFORE express.json() to protect raw body)
// ------------------------------------------------------------------
app.use(express.static(path.resolve(__dirname, '../dashboard')));

// ------------------------------------------------------------------
// Stripe Webhook — must use raw body, BEFORE express.json()
// ------------------------------------------------------------------
app.post('/webhooks/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('❌ Stripe webhook signature failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    const existing = await findExistingEvent('stripe', event.id);
    if (existing) {
        logActivity('stripe_webhook', 'duplicate', 'EVENT_DEDUPED', '-', '-');
        return res.json({ received: true, deduped: true });
    }

    const eventRecord = await recordReceive({
        provider: 'stripe',
        eventId: event.id,
        eventType: event.type,
        verified: true,
        rawPayload: req.body.toString().slice(0, 5000)
    });

    try {
        if (event.type === 'invoice.paid') {
            const invoice = event.data.object;
            const deals = await fetchRecords(dealsTable, `stripe_invoice_id = '${invoice.id}'`);
            if (deals.length > 0) {
                const deal = deals[0];
                await updateRecord(dealsTable, deal.id, {
                    status: 'PAYMENT_COLLECTED',
                    payment_collected_date: new Date().toISOString().split('T')[0]
                });
                logActivity('payment_handler', deal.id, 'INVOICE_PAID', 'INVOICE_SENT', 'PAYMENT_COLLECTED');
                console.log(`✅ Payment collected for Deal ${deal.id}`);
            }
        }
        await markProcessed(eventRecord);
    } catch (error) {
        await markFailed(eventRecord, error.message);
    }

    res.json({ received: true });
});

// ------------------------------------------------------------------
// PandaDoc Webhook
// ------------------------------------------------------------------
app.post('/webhooks/pandadoc', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.query.signature;
    const rawBody = req.body; // Buffer

    const isVerified = verifyPandaDocSignature(rawBody, signature, process.env.PANDADOC_WEBHOOK_SECRET);

    if (!isVerified) {
        if (process.env.PANDADOC_VERIFY_STRICT === 'true') {
            await recordReceive({ 
                provider: 'pandadoc', 
                eventId: 'unverified', 
                eventType: 'invalid_signature', 
                verified: false, 
                rawPayload: rawBody ? rawBody.toString().slice(0, 500) : ''
            });
            return res.status(401).send('Invalid signature');
        } else {
            console.warn('[PANDADOC SOFT-FAIL] Signature missing or invalid - accepting webhook anyway');
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(rawBody.toString());
    } catch (err) {
        await recordReceive({ 
            provider: 'pandadoc', 
            eventId: 'parse_error', 
            eventType: 'invalid_json', 
            verified: isVerified, 
            rawPayload: rawBody ? rawBody.toString().slice(0, 500) : ''
        });
        return res.status(400).send('Invalid JSON');
    }

    if (!Array.isArray(parsed)) {
        console.warn('PandaDoc webhook payload is not an array.');
        return res.status(200).send('Payload not an array - ignored');
    }

    for (const evt of parsed) {
        const { event, data } = evt;
        const docId = data?.id || '';
        const docStatus = data?.status || '';
        const dateModified = data?.date_modified || '';

        const event_id = crypto.createHash('sha256')
            .update(`${docId}|${docStatus}|${dateModified}`)
            .digest('hex')
            .slice(0, 32);

        const existing = await findExistingEvent('pandadoc', event_id);
        if (existing) {
            logActivity('pandadoc_webhook', 'duplicate', 'EVENT_DEDUPED', '-', '-');
            continue;
        }

        const eventRecord = await recordReceive({
            provider: 'pandadoc',
            eventId: event_id,
            eventType: event || 'unknown',
            verified: isVerified,
            rawPayload: rawBody.toString().slice(0, 5000)
        });

        try {
            if (event === 'document_state_changed') {
                if (!docId) {
                    await markProcessed(eventRecord, 'No doc ID in payload');
                    continue;
                }
                
                const deals = await fetchRecords(dealsTable, `SEARCH('${docId}', pandadoc_doc_id) > 0`);
                if (deals.length === 0) {
                    await markProcessed(eventRecord, `No deal found for doc ${docId}`);
                    continue;
                }
                const deal = deals[0];
                
                if (docStatus === 'document.completed') {
                    await updateRecord(dealsTable, deal.id, {
                        status: 'CONTRACT_SIGNED',
                        contract_signed_date: new Date().toISOString().split('T')[0]
                    });
                    logActivity('contract_generator', deal.id, 'CONTRACT_SIGNED', 'CONTRACT_SENT', 'CONTRACT_SIGNED');
                    await markProcessed(eventRecord, `Deal ${deal.id} marked CONTRACT_SIGNED`);
                    setImmediate(async () => {
                        try {
                            await createInvoices();
                        } catch (err) {
                            logError(Tiers.HIGH, 'background_invoice', 'Invoice creation failed', { error: err.message });
                        }
                    });
                    continue;
                }
                
                if (docStatus === 'document.draft') {
                    if (deal.contract_state !== 'DRAFTING') {
                        await markProcessed(eventRecord, `Deal ${deal.id} not in DRAFTING state (was ${deal.contract_state})`);
                        continue;
                    }
                    
                    try {
                        await pandaDocClient.post(`/documents/${docId}/send`, { silent: false });
                        logActivity('contract_generator', deal.id, 'DRAFT_SENT', 'DRAFTING', 'SENT');
                        
                        const allDocIds = deal.pandadoc_doc_id.split(',').map(s => s.trim());
                        const sentDocs = (deal.contract_docs_sent || '').split(',').filter(s => s);
                        sentDocs.push(docId);
                        const allSent = allDocIds.every(id => sentDocs.includes(id));
                        
                        if (allSent) {
                            await updateRecord(dealsTable, deal.id, {
                                contract_state: 'SENT',
                                contract_docs_sent: sentDocs.join(','),
                                status: 'CONTRACT_SENT',
                                contract_sent_date: new Date().toISOString().split('T')[0]
                            });
                            logActivity('contract_generator', deal.id, 'ALL_CONTRACTS_SENT', 'DRAFTING', 'CONTRACT_SENT');
                        } else {
                            await updateRecord(dealsTable, deal.id, {
                                contract_docs_sent: sentDocs.join(',')
                            });
                        }
                        
                        await markProcessed(eventRecord, `Doc ${docId} sent for Deal ${deal.id}`);
                    } catch (err) {
                        await markFailed(eventRecord, `Send failed for doc ${docId}: ${err.message}`);
                        logError(Tiers.HIGH, 'contract_generator', `Failed to send doc ${docId}`, { error: err.message });
                    }
                    
                    continue;
                }
                
                await markProcessed(eventRecord, `Unhandled status: ${docStatus}`);
                continue;
            } else {
                await markProcessed(eventRecord, `Ignored event: ${event}`);
                continue;
            }
        } catch (error) {
            await markFailed(eventRecord, error.message);
            continue;
        }
    }

    res.json({ received: true });
});

// ------------------------------------------------------------------
// SendGrid Inbound Webhook
// ------------------------------------------------------------------
app.post('/webhooks/sendgrid/inbound', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
    try {
        const sig = req.headers['x-twilio-email-event-webhook-signature'];
        const ts = req.headers['x-twilio-email-event-webhook-timestamp'];

        const verified = verifyInboundSignature(req.body, sig, ts);
        if (!verified) {
            console.warn('❌ SendGrid inbound signature failed');
            return res.status(401).send('Invalid signature');
        }

        // Parse multipart form data using multer
        const fakeReq = Object.assign(new Readable(), {
            headers: req.headers,
            _read: () => {}
        });
        fakeReq.push(req.body);
        fakeReq.push(null);

        await new Promise((resolve, reject) => {
            upload.none()(fakeReq, res, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        const fields = fakeReq.body || {};
        const fromField = fields.from || '';
        const subjectField = fields.subject || '';
        const timestampStr = ts || new Date().getTime().toString();
        
        const idempotencyKey = crypto.createHash('sha256')
            .update(`${fromField}|${timestampStr}|${subjectField}`)
            .digest('hex')
            .slice(0, 32);

        const existing = await findExistingEvent('sendgrid', idempotencyKey);
        if (existing) {
            logActivity('sendgrid_webhook', 'duplicate', 'EVENT_DEDUPED', '-', '-');
            return res.status(200).send();
        }

        const eventRecord = await recordReceive({
            provider: 'sendgrid',
            eventId: idempotencyKey,
            eventType: 'inbound_parse',
            verified: verified,
            rawPayload: req.body ? req.body.toString().slice(0, 5000) : ''
        });

        const emailMatch = fromField.match(/<([^>]+)>/);
        const senderEmail = emailMatch ? emailMatch[1].trim() : fromField.trim();

        if (!senderEmail) {
            await markFailed(eventRecord, 'No sender email');
            return res.status(200).send();
        }

        const emailText = fields.text || '';
        let textContent = emailText;
        if (!textContent && fields.html) {
            // Strip HTML to plaintext if text is empty
            textContent = fields.html.replace(/<[^>]*>?/gm, '');
        }

        if (!textContent) {
            console.warn('Malformed inbound email (no text or html content)');
            logActivity('inbound_orphan', 'unknown', 'MALFORMED_EMAIL', 'NONE', 'NONE');
            await markFailed(eventRecord, 'Malformed email (no text content)');
            return res.status(200).send();
        }

        try {
            // Identify sender
            const influencers = await fetchRecords(influencersTable, `{email} = '${senderEmail}'`);
            const brands = await fetchRecords(brandsTable, `{contact_email} = '${senderEmail}'`);

            if (influencers.length > 0 && brands.length > 0) {
                console.warn(`Email ${senderEmail} matches both influencer and brand. Treating as influencer.`);
                await processInboundEmail(influencers[0], textContent, 'influencer');
            } else if (influencers.length > 0) {
                await processInboundEmail(influencers[0], textContent, 'influencer');
            } else if (brands.length > 0) {
                await processInboundEmail(brands[0], textContent, 'brand');
            } else {
                logActivity('inbound_orphan', 'unknown', 'INBOUND_ORPHAN', 'NONE', 'NONE');
            }

            await markProcessed(eventRecord, `Processed email from ${senderEmail}`);
            return res.status(200).send();
        } catch (processErr) {
            console.error('Email processing failed:', processErr.message);
            await markFailed(eventRecord, processErr.message);
            return res.status(200).send();
        }
    } catch (err) {
        console.error('Inbound Email Error:', err.message);
        // Always return 200 to SendGrid
        return res.status(200).send();
    }
});

// ------------------------------------------------------------------
// JSON API (after webhooks)
// ------------------------------------------------------------------
app.use(express.json());

// GET: Server-Side Rendered Roster Portal
app.get('/roster', async (req, res) => {
    const token = req.query.t;
    if (!token) return res.status(400).send("Invalid or missing token.");

    const brands = await fetchRecords(brandsTable, `roster_token = '${token}'`);
    if (brands.length === 0) return res.status(404).send("Roster not found or token expired.");
    
    const brand = brands[0];
    
    // Check expiry
    if (brand.roster_token_expires && new Date() > new Date(brand.roster_token_expires)) {
        return res.status(410).send("This roster link has expired.");
    }

    // Increment view count
    await updateRecord(brandsTable, brand.id, {
        roster_view_count: (brand.roster_view_count || 0) + 1
    });

    // Exact sub-niche match first
    let influencers = await fetchRecords(influencersTable, `AND(niche = '${brand.niche}', status = 'QUOTE_RECEIVED')`);
    let matchHint = '';

    if (influencers.length > 0) {
        matchHint = `<div class="match-hint" style="color: #10b981; font-weight: 600; margin-top: 10px;">${influencers.length} exact matches</div>`;
    } else {
        // Parent-niche fallback
        const parentNiche = getParentNiche(brand.niche);
        if (!parentNiche) {
            console.warn(`No parent niche found for sub-niche: ${brand.niche}`);
            return res.send("<h1>No available creators in this roster at the moment.</h1>");
        }

        const siblingNiches = getChildNiches(parentNiche);
        if (siblingNiches.length > 0) {
            // Build OR query for siblings
            const orConditions = siblingNiches.map(n => `niche = '${n}'`).join(', ');
            influencers = await fetchRecords(influencersTable, `AND(OR(${orConditions}), status = 'QUOTE_RECEIVED')`);
        }
        
        if (influencers.length > 0) {
            const parentLabel = getParentLabel(parentNiche) || parentNiche;
            matchHint = `<div class="match-hint" style="color: #fbbf24; font-weight: 600; margin-top: 10px;">${influencers.length} related matches (parent niche: ${parentLabel})</div>`;
        } else {
            return res.send("<h1>No available creators in this roster at the moment.</h1>");
        }
    }

    // Generate Creator Cards HTML
    let cardsHtml = '';
    for (const inf of influencers) {
        let terms = { rate: 'TBD', deliverable_type: 'Custom', timeline: 'TBD' };
        try { if (inf.quote_terms) terms = JSON.parse(inf.quote_terms); } catch(e) {}
        
        // Price with 15% markup
        const displayPrice = terms.rate !== 'TBD' ? Math.round(Number(terms.rate) * 1.15) : 'TBD';

        cardsHtml += `
            <div class="creator-card">
                <div class="checkbox-container">
                    <input type="checkbox" name="selected_creators" value="${inf.id}">
                </div>
                <div class="creator-info">
                    <h2 class="creator-name">${inf.name || 'Creator'}</h2>
                    <div class="stats">
                        <span>👥 ${(inf.subscriber_count || 0).toLocaleString()} Subs</span>
                        <span>📈 ${((inf.avg_views || 0)).toLocaleString()} Avg Views</span>
                    </div>
                    <div class="terms">
                        <p><strong>Deliverable:</strong> ${terms.deliverable_type}</p>
                        <p><strong>Timeline:</strong> ${terms.timeline}</p>
                        <p><strong>Usage & Exclusivity:</strong> ${terms.usage_rights || 'Standard'} | ${terms.exclusivity_window || 'None'}</p>
                        <div class="price">$${displayPrice.toLocaleString()}</div>
                    </div>
                </div>
            </div>
        `;
    }

    const expiryDate = brand.roster_token_expires ? new Date(brand.roster_token_expires).toLocaleDateString() : 'TBD';

    let html = fs.readFileSync(path.resolve(__dirname, 'views', 'roster.html'), 'utf8');
    html = html.replace(/{{BRAND_NAME}}/g, brand.company_name || 'your brand')
               .replace(/{{EXPIRY_DATE}}/g, expiryDate)
               .replace(/{{CREATOR_CARDS}}/g, cardsHtml)
               .replace(/{{TOKEN}}/g, token)
               .replace(/{{MATCH_HINT}}/g, matchHint);

    res.send(html);
});

// POST: Roster Selection
app.post('/api/roster/select', async (req, res) => {
    const { token, selected } = req.body;
    if (!token || !selected || !Array.isArray(selected)) return res.status(400).json({ error: 'Invalid payload' });

    try {
        const brands = await fetchRecords(brandsTable, `roster_token = '${token}'`);
        if (brands.length === 0) return res.status(404).json({ error: 'Token invalid' });
        const brand = brands[0];

        for (const infId of selected) {
            const infs = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
            if (infs.length === 0) continue;
            const inf = infs[0];

            let terms = {};
            try { if (inf.quote_terms) terms = JSON.parse(inf.quote_terms); } catch(e) {}
            const broker_fee = terms.rate ? Math.round(Number(terms.rate) * 0.15) : 0;
            const agreed_rate = terms.rate ? Number(terms.rate) : 0;

            // Create Deal
            await createRecord(dealsTable, {
                deal_id: `DEAL-${Math.floor(Math.random() * 10000)}`,
                brand_id: brand.id,
                influencer_id: inf.id,
                status: 'DEAL_INITIATED',
                agreed_rate: agreed_rate,
                deliverables: terms.deliverable_type || '',
                quote_terms: inf.quote_terms || ''
            });

            // Transition selected influencer state
            await updateRecord(influencersTable, inf.id, { status: 'DEAL_INITIATED' });
        }

        // Invalidate token
        await updateRecord(brandsTable, brand.id, { roster_token: null, roster_token_expires: null, status: 'INTERESTED' });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST: Roster Decline
app.post('/api/roster/decline', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token required' });

    try {
        const brands = await fetchRecords(brandsTable, `roster_token = '${token}'`);
        if (brands.length === 0) return res.status(404).json({ error: 'Token invalid' });
        const brand = brands[0];

        await updateRecord(brandsTable, brand.id, { 
            status: 'ROSTER_DECLINED',
            roster_token: null,
            roster_token_expires: null
        });

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET: All Deals
app.get('/api/deals', async (req, res) => {
    try {
        const [deals, influencers, brands] = await Promise.all([
            fetchRecords(dealsTable),
            fetchRecords(influencersTable),
            fetchRecords(brandsTable)
        ]);

        const influencersMap = {};
        influencers.forEach(inf => {
            influencersMap[inf.id] = inf;
        });

        const brandsMap = {};
        brands.forEach(br => {
            brandsMap[br.id] = br;
        });

        const mappedDeals = deals.map(deal => {
            const infId = deal.influencer_id?.[0];
            const brandId = deal.brand_id?.[0];
            
            const inf = influencersMap[infId] || {};
            const br = brandsMap[brandId] || {};
            const tracking = getTrackingInfo(deal.id);
            
            return {
                ...deal,
                influencer_name: inf.name || 'Unknown Influencer',
                brand_name: br.company_name || 'Unknown Brand',
                niche: inf.niche || br.niche || 'lifestyle',
                broker_fee: deal.agreed_rate ? Math.round(deal.agreed_rate * 0.15) : null,
                escalation_flag: tracking.escalation_flag || null
            };
        });

        const mappedInfluencers = influencers.map(inf => {
            const tracking = getTrackingInfo(inf.id);
            return {
                id: inf.id,
                status: inf.status || 'INFLUENCER_DISCOVERED',
                niche: inf.niche || 'lifestyle',
                influencer_name: inf.name || 'Unknown Influencer',
                brand_name: null,
                agreed_rate: null,
                broker_fee: null,
                escalation_flag: tracking.escalation_flag || null
            };
        });

        const mappedBrands = brands.map(br => {
            const tracking = getTrackingInfo(br.id);
            return {
                id: br.id,
                status: br.status || 'BRAND_COLD',
                niche: br.niche || 'lifestyle',
                influencer_name: null,
                brand_name: br.company_name || 'Unknown Brand',
                agreed_rate: null,
                broker_fee: null,
                escalation_flag: tracking.escalation_flag || null
            };
        });

        const allUnified = [
            ...mappedDeals,
            ...mappedInfluencers,
            ...mappedBrands
        ];

        res.json(allUnified);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Manual Payout Release — requires explicit human trigger
app.post('/api/release_payout', async (req, res) => {
    const { deal_id } = req.body;
    if (!deal_id) return res.status(400).json({ error: 'deal_id is required' });

    try {
        const result = await releasePayout(deal_id);
        res.json({ success: true, message: `Payout flagged for deal ${deal_id}`, data: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Operator confirms manual payout is complete
app.post('/api/confirm_payout_complete', async (req, res) => {
    const { deal_id } = req.body;
    if (!deal_id) return res.status(400).json({ error: 'deal_id is required' });
    
    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${deal_id}'`);
        if (!deals.length) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];
        
        if (deal.payout_status !== 'PAYOUT_OWED') {
            return res.status(400).json({ error: `Deal payout_status is ${deal.payout_status}, expected PAYOUT_OWED` });
        }
        
        await updateRecord(dealsTable, deal.id, {
            status: 'PAYMENT_RELEASED',
            payout_status: 'PAYOUT_COMPLETE',
            payment_released_date: new Date().toISOString().split('T')[0]
        });
        
        // Optional: auto-transition to CAMPAIGN_LIVE
        await updateRecord(dealsTable, deal.id, {
            status: 'CAMPAIGN_LIVE'
        });
        
        logActivity('payment_handler', deal.id, 'PAYOUT_CONFIRMED_BY_OPERATOR', 'PAYMENT_COLLECTED', 'CAMPAIGN_LIVE');
        res.json({ success: true, message: `Payout confirmed and Deal ${deal_id} marked CAMPAIGN_LIVE` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Generate Contracts for locked deals
app.post('/api/generate_contracts', async (req, res) => {
    try {
        await generateContracts();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Create invoices for signed deals
app.post('/api/create_invoices', async (req, res) => {
    try {
        await createInvoices();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST: Approve YELLOW escalation — sends drafted response
app.post('/api/approve_action', async (req, res) => {
    const { deal_id } = req.body;
    if (!deal_id) return res.status(400).json({ error: 'deal_id is required' });

    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${deal_id}'`);
        if (!deals.length) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];

        const tracking = getTrackingInfo(deal.id);
        updateTrackingInfo(deal.id, { escalation_flag: 'GREEN' });
        logActivity('negotiation_handler', deal.id, 'OWNER_APPROVED', tracking.escalation_flag || 'YELLOW', 'GREEN');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Broker Dashboard → http://localhost:${PORT}`);
    console.log(`   Stripe Webhook endpoint  → POST /webhooks/stripe`);
    console.log(`   PandaDoc Webhook endpoint → POST /webhooks/pandadoc`);
});
