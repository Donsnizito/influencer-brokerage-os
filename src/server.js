import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import fs from 'fs';
import { releasePayout, createInvoices } from './skills/payment_handler.js';
import { generateContracts } from './skills/contract_generator.js';
import { dealsTable, influencersTable, brandsTable, fetchRecords, updateRecord, createRecord } from './utils/airtable.js';
import { logActivity } from './utils/logger.js';
import { getTrackingInfo, updateTrackingInfo } from './utils/tracker.js';
import { getParentNiche, getChildNiches, getParentLabel } from './utils/niches.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

    res.json({ received: true });
});

// ------------------------------------------------------------------
// PandaDoc Webhook
// ------------------------------------------------------------------
app.post('/webhooks/pandadoc', express.json(), async (req, res) => {
    const { data, event } = req.body;

    if (event === 'document_state_changed' && data?.status === 'document.completed') {
        const docId = data?.id;
        if (!docId) return res.json({ received: true });

        // Find deal with this pandadoc_doc_id
        const deals = await fetchRecords(dealsTable, `SEARCH('${docId}', pandadoc_doc_id) > 0`);
        if (deals.length > 0) {
            const deal = deals[0];
            await updateRecord(dealsTable, deal.id, {
                status: 'CONTRACT_SIGNED',
                contract_signed_date: new Date().toISOString().split('T')[0]
            });
            logActivity('contract_generator', deal.id, 'CONTRACT_SIGNED', 'CONTRACT_SENT', 'CONTRACT_SIGNED');
            console.log(`✅ Contract signed for Deal ${deal.id}`);

            // Auto-trigger invoice creation
            await createInvoices();
        }
    }

    res.json({ received: true });
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
    html = html.replace(/{{BRAND_NAME}}/g, brand.name || 'your brand')
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
                brand_name: br.name || 'Unknown Brand',
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
                brand_name: br.name || 'Unknown Brand',
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
        await releasePayout(deal_id);
        res.json({ success: true, message: `Payout released for deal ${deal_id}` });
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
