import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';
import dotenv from 'dotenv';
import crypto from 'crypto';
import { findExistingEvent, recordReceive, markProcessed, markFailed } from './utils/webhook_idempotency.js';
import { verifyPandaDocSignature } from './utils/pandadoc_signature.js';
import fs from 'fs';
import { releasePayout, createInvoices, release20Percent, sendOperatorAlertForUnresolvedPayment } from './skills/payment_handler.js';
import { generateContracts } from './skills/contract_generator.js';
import { dealsTable, influencersTable, brandsTable, complianceEventsTable, unresolvedPaymentsTable, fetchRecords, updateRecord, createRecord } from './utils/airtable.js';
// Brief 12: production outreach orchestration routes
import { runOutreachBatchForBrand } from './skills/outreach_orchestration.js';
import { sendOutreachDraft } from './skills/outreach_send.js';
import { logActivity } from './utils/logger.js';
import { getTrackingInfo, updateTrackingInfo } from './utils/tracker.js';
import { getParentNiche, getChildNiches, getParentLabel } from './utils/niches.js';
import multer from 'multer';
import { verifyInboundSignature } from './utils/sendgrid_signature.js';
import { processInboundEmail } from './skills/negotiation_handler.js';
import { extractHeaders } from './lib/email_headers.js'; // Brief 13: In-Reply-To / References extraction
import { Readable } from 'stream';
import { pandaDocClient } from './utils/pandadoc_client.js';
import { logError, Tiers } from './utils/errorHandler.js';
// Brief 14: compliance engine + lock pipeline
import { validateLockedSpec, deriveDealState, checkDay30Eligibility } from './skills/compliance_engine.js';

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
        if (event.type === 'invoice.paid' || event.type === 'invoice_payment.paid') {
            const obj = event.data.object;
            const invoiceId = event.type === 'invoice.paid' ? obj.id : obj.invoice;
            const deals = await fetchRecords(dealsTable, `stripe_invoice_id = '${invoiceId}'`);
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

        // ── Brief 14: lock pipeline triggered by payment_intent.succeeded ──
        // Idempotency: generic via findExistingEvent('stripe', event.id) — inherited for free.
        // Discovery (Pin 4): webhook_idempotency.js keys by Stripe event ID which is unique
        // per event type instance. payment_intent.succeeded events have their own evt_xxx IDs.
        if (event.type === 'payment_intent.succeeded') {
            const result = await handleStripePaymentSucceeded(event);
            console.log(`[stripe_webhook] payment_intent.succeeded result:`, result);
        }

        await markProcessed(eventRecord);
    } catch (error) {
        await markFailed(eventRecord, error.message);
    }

    res.json({ received: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Brief 14: lock pipeline handler (payment_intent.succeeded)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Post-lock status set — any of these means the deal is already locked.
 * Used for idempotency check in the lock pipeline.
 */
function isPostLockStatus(status) {
    return ['LOCKED', 'CONTRACTS_SENT', 'CONTRACTS_SIGNED', 'CAMPAIGN_LIVE',
            'DELIVERY_UPLOADED', 'DELIVERY_APPROVED', 'CAMPAIGN_COMPLETE', 'BREACH_FLAGGED'].includes(status);
}

/**
 * Lock pipeline for payment_intent.succeeded events.
 * Dual-path: CART_DRAFT and CAMPAIGN_APPROVED both transition identically.
 *
 * @param {Object} stripeEvent - Verified Stripe webhook event
 * @returns {Promise<Object>} Result object describing what happened
 */
async function handleStripePaymentSucceeded(stripeEvent) {
    const paymentIntent = stripeEvent.data.object;
    const dealId = paymentIntent.metadata?.deal_id;

    // Pin 1: no deal_id in metadata — fail loud with dual-surface recovery
    if (!dealId) {
        const customerEmail = paymentIntent.receipt_email ?? paymentIntent.customer ?? null;
        const amount = paymentIntent.amount ?? 0;
        const timestamp = new Date(stripeEvent.created * 1000).toISOString();

        logError(Tiers.HIGH, 'stripe_webhook',
            `payment_intent.succeeded with no deal_id metadata: PI=${paymentIntent.id} event=${stripeEvent.id} customer=${customerEmail} amount=${amount} ts=${timestamp}`,
            { paymentIntentId: paymentIntent.id, stripeEventId: stripeEvent.id, customerEmail, amount, timestamp }
        );

        // Dual-surface recovery: durable record + immediate alert (Pin 1 requirement)
        await sendOperatorAlertForUnresolvedPayment({
            paymentIntentId: paymentIntent.id,
            stripeEventId: stripeEvent.id,
            customerEmail,
            amount,
            timestamp
        });

        return { processed: false, reason: 'no_deal_id_metadata' };
    }

    // Fetch the Deal record
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) {
        logError(Tiers.HIGH, 'stripe_webhook', `payment_intent.succeeded: deal not found: ${dealId}`, { paymentIntentId: paymentIntent.id });
        return { processed: false, reason: 'deal_not_found' };
    }
    const deal = deals[0];

    // Idempotency: already locked → return 200 immediately (Stripe dedup)
    if (isPostLockStatus(deal.status)) {
        logActivity('stripe_webhook', dealId, 'ALREADY_LOCKED', deal.status, deal.status);
        console.log(`[stripe_webhook] Deal ${dealId} already in post-lock status (${deal.status}); ignoring duplicate webhook`);
        return { processed: true, reason: 'already_locked', status: deal.status };
    }

    // Validate current status is a recognized pre-lock state
    const preLockStates = ['CART_DRAFT', 'CAMPAIGN_APPROVED'];
    if (!preLockStates.includes(deal.status)) {
        // Invalid pre-lock state — log but return 200 so Stripe doesn't retry
        logError(Tiers.HIGH, 'stripe_webhook',
            `payment_intent.succeeded: deal ${dealId} in invalid pre-lock status: ${deal.status}`,
            { paymentIntentId: paymentIntent.id }
        );
        return { processed: false, reason: 'invalid_pre_lock_status', status: deal.status };
    }

    // Parse and validate compliance_spec
    let workingSpec;
    try {
        workingSpec = JSON.parse(deal.compliance_spec ?? '{}');
    } catch (err) {
        logError(Tiers.HIGH, 'stripe_webhook', `deal ${dealId} has malformed compliance_spec`, { error: err.message });
        return { processed: false, reason: 'malformed_working_spec' };
    }

    const validation = validateLockedSpec(workingSpec);
    if (!validation.valid) {
        // CRITICAL: brand paid but spec is invalid. Mark deal BREACH_FLAGGED for operator resolution.
        logError(Tiers.HIGH, 'stripe_webhook',
            `deal ${dealId} spec invalid at lock: ${validation.errors.join(', ')}`,
            { paymentIntentId: paymentIntent.id, errors: validation.errors }
        );
        await updateRecord(dealsTable, dealId, { status: 'BREACH_FLAGGED' });
        return { processed: false, reason: 'spec_validation_failed', errors: validation.errors };
    }

    // ── Transition to LOCKED: freeze spec + create payout schedule ──
    const total = workingSpec.payout_terms.total_creator_payout_amount;
    const split80 = workingSpec.payout_terms.split_80_amount;
    const split20 = workingSpec.payout_terms.split_20_amount;

    await updateRecord(dealsTable, dealId, {
        status: 'LOCKED',
        compliance_spec: JSON.stringify(workingSpec), // explicit write signals immutability from this point
        creator_payout_schedule: JSON.stringify({
            total_payout_to_creator: total,
            split_80_amount: split80,
            split_20_amount: split20,
            split_80_released_at: null,
            split_80_stripe_transfer_id: null,
            split_20_released_at: null,
            split_20_stripe_transfer_id: null,
            compliance_hold: false
        })
    });

    logActivity('stripe_webhook', dealId, 'DEAL_LOCKED', deal.status, 'LOCKED');
    console.log(`[stripe_webhook] Deal ${dealId} locked (${deal.status} → LOCKED)`);

    // ── Generate contracts ──
    try {
        const contractResult = await generateContracts(dealId);
        console.log(`[stripe_webhook] Contracts generated for Deal ${dealId}:`, contractResult);

        await updateRecord(dealsTable, dealId, { status: 'CONTRACTS_SENT' });
        logActivity('stripe_webhook', dealId, 'CONTRACTS_SENT', 'LOCKED', 'CONTRACTS_SENT');

        return { processed: true, locked: true, contracts_generated: true, deal_id: dealId };
    } catch (err) {
        logError(Tiers.HIGH, 'stripe_webhook', `Contract generation failed for Deal ${dealId}: ${err.message}`, { error: err.message });
        // Deal is LOCKED but contracts didn't generate. Operator must manually invoke /api/generate_contracts.
        return { processed: true, locked: true, contracts_generated: false, error: err.message, deal_id: dealId };
    }
}

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

    // ── Brief 14 extension: PandaDoc recipient_completed → ComplianceEvent ──
    // Idempotency: dual-layer
    //   Layer 1: WebhookEvents dedup (above, keyed by ${docId}|${docStatus}|${dateModified})
    //   Layer 2: ComplianceEvents existence check (below — prevents double-write across retries)
    // Discovery (Pin 4): PandaDoc recipient_completed events have their own dateModified
    // per signer action, generating unique hashes. Dual-layer idempotency is belt-and-suspenders.
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
                    // Brief 14 extension: determine which party completed (brand or creator)
                    // by checking pandadoc_brand_document_id / pandadoc_creator_document_id
                    // fields written by contract_generator.js (E.3-α lookup).
                    let signatureEventType = null;
                    if (deal.pandadoc_brand_document_id === docId) {
                        signatureEventType = 'contract_signed_brand';
                    } else if (deal.pandadoc_creator_document_id === docId) {
                        signatureEventType = 'contract_signed_creator';
                    }
                    // Fallback: if individual doc IDs not yet written (pre-Brief-14 deals),
                    // use the legacy CONTRACT_SIGNED path without ComplianceEvent.

                    if (signatureEventType) {
                        // Layer 2 idempotency: check ComplianceEvents table before writing
                        const existingSignature = await fetchRecords(
                            complianceEventsTable,
                            `AND({deal_id} = '${deal.id}', {event_type} = '${signatureEventType}')`
                        );
                        if (existingSignature.length === 0) {
                            await complianceEventsTable.create([{
                                fields: {
                                    deal_id: [deal.id],
                                    event_type: signatureEventType,
                                    event_payload: JSON.stringify({ pandadoc_document_id: docId, pandadoc_status: docStatus }),
                                    event_source: 'system_derived',
                                    event_actor: 'pandadoc_webhook',
                                    event_notes: `Signed via PandaDoc; document ${docId}`
                                }
                            }]);
                            console.log(`[pandadoc_webhook] ${signatureEventType} ComplianceEvent written for Deal ${deal.id}`);
                        }

                        // Check if both parties have now signed → CONTRACTS_SIGNED
                        // [K.7 CLEANUP CANDIDATE] — we write both CONTRACT_SIGNED (legacy field,
                        // pre-Brief-14 dashboard rendering dependency) and CONTRACTS_SIGNED (new enum).
                        // Cleanup trigger: verify all downstream consumers (dashboard rendering,
                        // contracts tab, audit queries) read CONTRACTS_SIGNED, then remove CONTRACT_SIGNED
                        // writes. Origin: Brief 14 commit. Reference: see also K.6 (status enum coexistence).
                        const allSignatures = await fetchRecords(
                            complianceEventsTable,
                            `AND({deal_id} = '${deal.id}', OR({event_type} = 'contract_signed_brand', {event_type} = 'contract_signed_creator'))`
                        );
                        if (allSignatures.length >= 2) {
                            await updateRecord(dealsTable, deal.id, {
                                status: 'CONTRACTS_SIGNED',    // new canonical enum (Brief 14)
                                contract_state: 'SIGNED',      // existing field preserved for legacy dashboard
                                contract_signed_date: new Date().toISOString().split('T')[0]
                            });
                            logActivity('contract_generator', deal.id, 'BOTH_CONTRACTS_SIGNED', 'CONTRACTS_SENT', 'CONTRACTS_SIGNED');
                            console.log(`[pandadoc_webhook] Both signatures received for Deal ${deal.id}; status → CONTRACTS_SIGNED`);
                        }
                    } else {
                        // Legacy path: individual doc IDs not present — use old CONTRACT_SIGNED transition
                        await updateRecord(dealsTable, deal.id, {
                            status: 'CONTRACT_SIGNED',
                            contract_signed_date: new Date().toISOString().split('T')[0]
                        });
                        logActivity('contract_generator', deal.id, 'CONTRACT_SIGNED', 'CONTRACT_SENT', 'CONTRACT_SIGNED');
                        setImmediate(async () => {
                            try {
                                await createInvoices();
                            } catch (err) {
                                logError(Tiers.HIGH, 'background_invoice', 'Invoice creation failed', { error: err.message });
                            }
                        });
                    }
                    await markProcessed(eventRecord, `Deal ${deal.id} signature event processed`);
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

        // Brief 13: extract In-Reply-To and References headers for draft reply-matching
        const headersText = fields.headers ?? '';
        const parsedHeaders = extractHeaders(headersText, ['In-Reply-To', 'References']);
        const inReplyToHeader = parsedHeaders['in-reply-to'];
        const referencesHeader = parsedHeaders['references'];

        try {
            // Identify sender
            const influencers = await fetchRecords(influencersTable, `{email} = '${senderEmail}'`);
            const brands = await fetchRecords(brandsTable, `{contact_email} = '${senderEmail}'`);

            if (influencers.length > 0 && brands.length > 0) {
                console.warn(`Email ${senderEmail} matches both influencer and brand. Treating as influencer.`);
                await processInboundEmail({ record: influencers[0], emailText: textContent, senderType: 'influencer', senderEmail, inReplyToHeader, referencesHeader });
            } else if (influencers.length > 0) {
                await processInboundEmail({ record: influencers[0], emailText: textContent, senderType: 'influencer', senderEmail, inReplyToHeader, referencesHeader });
            } else if (brands.length > 0) {
                await processInboundEmail({ record: brands[0], emailText: textContent, senderType: 'brand', senderEmail, inReplyToHeader, referencesHeader });
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
// SendGrid Event Webhook (Bounces, etc)
// ------------------------------------------------------------------
app.post('/webhooks/sendgrid/bounce', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const sig = req.headers['x-twilio-email-event-webhook-signature'];
        const ts = req.headers['x-twilio-email-event-webhook-timestamp'];

        const verified = verifyInboundSignature(req.body, sig, ts);
        if (!verified) {
            console.warn('❌ SendGrid event signature failed');
            return res.status(401).send('Invalid signature');
        }

        let parsed;
        try {
            parsed = JSON.parse(req.body.toString());
        } catch (e) {
            return res.status(400).send('Invalid JSON');
        }

        if (!Array.isArray(parsed)) {
            parsed = [parsed];
        }

        for (const evt of parsed) {
            const sg_message_id = evt.sg_message_id || '';
            const email = evt.email || '';
            const event = evt.event || '';

            if (event !== 'bounce') continue;

            const idempotencyKey = crypto.createHash('sha256')
                .update(`bounce|${sg_message_id}|${email}`)
                .digest('hex')
                .slice(0, 32);

            const existing = await findExistingEvent('sendgrid', idempotencyKey);
            if (existing) {
                continue;
            }

            const eventRecord = await recordReceive({
                provider: 'sendgrid',
                eventId: idempotencyKey,
                eventType: 'bounce',
                verified: verified,
                rawPayload: JSON.stringify(evt).slice(0, 5000)
            });

            try {
                // Find in influencers
                const influencers = await fetchRecords(influencersTable, `{email} = '${email}'`);
                if (influencers.length > 0) {
                    await updateRecord(influencersTable, influencers[0].id, {
                        email_invalid: true,
                        status: 'BOUNCED'
                    });
                } else {
                    // Find in brands
                    const brands = await fetchRecords(brandsTable, `{contact_email} = '${email}'`);
                    if (brands.length > 0) {
                        await updateRecord(brandsTable, brands[0].id, {
                            email_invalid: true,
                            status: 'BOUNCED'
                        });
                    }
                }

                logActivity('sendgrid_webhook', email, 'BOUNCE_PROCESSED', '-', 'BOUNCED');
                await markProcessed(eventRecord, `Processed bounce for ${email}`);
            } catch (err) {
                await markFailed(eventRecord, err.message);
            }
        }

        res.status(200).send();
    } catch (err) {
        console.error('SendGrid Bounce Error:', err.message);
        res.status(200).send();
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
            const infId = deal.influencer_id;
            const brandId = deal.brand_id;
            
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
// Brief 12: Production Outreach Orchestration routes
// ------------------------------------------------------------------

// POST /api/outreach/batch
// Runs match → score → LLM-generate → persist cycle for a brand.
// Body: { brandId: string, options?: { topN?: number, ignoreEmptyDeliveryEvidence?: boolean } }
// Returns the full batch result including draftsCreated array and per-creator errors.
// Note: ignoreEmptyDeliveryEvidence is a test-only option (see matching_engine.js Stage 4).
// It must NEVER be set to true in production dashboard calls.
app.post('/api/outreach/batch', async (req, res) => {
    const { brandId, options } = req.body;
    if (!brandId || typeof brandId !== 'string') {
        return res.status(400).json({ error: 'brandId required (string)' });
    }
    try {
        const result = await runOutreachBatchForBrand(brandId, options ?? {});
        res.json(result);
    } catch (err) {
        console.error(`[POST /api/outreach/batch] failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/outreach/send/:draftId
// Operator-triggered send for a single OutreachDraft (status must be pending_review).
// Returns success:true with sendgridMessageId on success.
// Returns success:false (HTTP 200) on SendGrid failure — dashboard renders failure state.
// Returns HTTP 400 on hard errors (draft not found, wrong status, brand not found).
app.post('/api/outreach/send/:draftId', async (req, res) => {
    const { draftId } = req.params;
    if (!draftId || typeof draftId !== 'string') {
        return res.status(400).json({ error: 'draftId required in path' });
    }
    try {
        const result = await sendOutreachDraft(draftId);
        // Both success and failure return HTTP 200 — the dashboard reads result.success
        // to determine which state to render. SendGrid failures are known outcomes,
        // not unhandled exceptions; the dashboard needs the failure detail.
        res.json(result);
    } catch (err) {
        // Hard errors (draft not found, status invalid, brand not found) — these are 4xx.
        // The client can read err.message to surface the specific reason to the operator.
        console.error(`[POST /api/outreach/send/${draftId}] failed: ${err.message}`);
        res.status(400).json({ error: err.message });
    }
});

// ------------------------------------------------------------------
// Brief 14: 20% release endpoint (operator-triggered)
// ------------------------------------------------------------------

// POST /api/deals/:dealId/release-20-percent
// Operator-triggered. Verifies day-30 eligibility and compliance status
// before firing the 20% Stripe transfer.
// Returns 200 with { eligible, reason } if not yet eligible (not an error).
// Returns 200 with { released, amount } on success.
app.post('/api/deals/:dealId/release-20-percent', async (req, res) => {
    const { dealId } = req.params;
    if (!dealId) return res.status(400).json({ error: 'dealId required in path' });

    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
        if (deals.length === 0) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];

        const events = await fetchRecords(complianceEventsTable, `{deal_id} = '${dealId}'`);
        const eligibility = checkDay30Eligibility(deal, events);

        if (!eligibility.eligible) {
            return res.json({
                released: false,
                eligible: false,
                reason: eligibility.reason,
                daysRemaining: eligibility.daysRemaining
            });
        }

        const result = await release20Percent(dealId);
        res.json({ released: result.released, amount: result.amount, transferId: result.transferId });
    } catch (err) {
        console.error(`[POST /api/deals/${dealId}/release-20-percent] failed: ${err.message}`);
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------------
// Brief 14: compliance read endpoints (consumed by Brief 15 dashboards,
// Brief 15d Lara, Brief 16 equivalence test)
// ------------------------------------------------------------------

// GET /api/deals/:dealId/compliance-status
// Calls deriveDealState() and returns the derived compliance state.
// No writes. Pure read.
app.get('/api/deals/:dealId/compliance-status', async (req, res) => {
    const { dealId } = req.params;
    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
        if (deals.length === 0) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];

        const events = await fetchRecords(complianceEventsTable, `{deal_id} = '${dealId}'`);
        const state = deriveDealState(deal, events);
        res.json({ deal_id: dealId, ...state });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deals/:dealId/payout-schedule
// Returns the parsed creator_payout_schedule JSON for a deal.
app.get('/api/deals/:dealId/payout-schedule', async (req, res) => {
    const { dealId } = req.params;
    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
        if (deals.length === 0) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];

        let schedule = null;
        try {
            schedule = JSON.parse(deal.creator_payout_schedule ?? 'null');
        } catch (e) {
            return res.status(500).json({ error: 'creator_payout_schedule is malformed JSON' });
        }

        res.json({ deal_id: dealId, schedule });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deals/:dealId/compliance-events
// Returns all ComplianceEvents for a deal, ordered by creation.
app.get('/api/deals/:dealId/compliance-events', async (req, res) => {
    const { dealId } = req.params;
    try {
        const events = await fetchRecords(complianceEventsTable, `{deal_id} = '${dealId}'`);
        res.json({ deal_id: dealId, events, count: events.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/deals/:dealId/compliance-spec
// Returns the parsed compliance_spec JSON for a deal.
// Separate from /api/deals because the spec JSON can be large and is
// consumed independently by PandaDoc rendering, Brief 15b brand portal,
// Brief 15c creator portal, and Brief 16 equivalence test.
app.get('/api/deals/:dealId/compliance-spec', async (req, res) => {
    const { dealId } = req.params;
    try {
        const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
        if (deals.length === 0) return res.status(404).json({ error: 'Deal not found' });
        const deal = deals[0];

        let spec = null;
        try {
            spec = JSON.parse(deal.compliance_spec ?? 'null');
        } catch (e) {
            return res.status(500).json({ error: 'compliance_spec is malformed JSON' });
        }

        res.json({ deal_id: dealId, locked: isPostLockStatus(deal.status), spec });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------------
// Brief 14 Pin 1: unresolved payments read endpoint
// Consumed by Brief 15 operator dashboard to surface the recovery queue.
// ------------------------------------------------------------------

// GET /api/unresolved-payments
// Returns all records in the UnresolvedPayments table (unresolved and resolved).
// Brief 15 dashboard will filter by resolved_at = null to surface open queue.
app.get('/api/unresolved-payments', async (req, res) => {
    try {
        const records = await fetchRecords(unresolvedPaymentsTable);
        const open = records.filter(r => !r.resolved_at);
        const resolved = records.filter(r => r.resolved_at);
        res.json({ open, resolved, total: records.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ------------------------------------------------------------------
// Start
// ------------------------------------------------------------------
app.listen(PORT, () => {
    console.log(`🚀 Broker Dashboard → http://localhost:${PORT}`);
    console.log(`   Stripe Webhook endpoint       → POST /webhooks/stripe`);
    console.log(`   PandaDoc Webhook endpoint     → POST /webhooks/pandadoc`);
    console.log(`   Brief 12 Outreach routes      → POST /api/outreach/batch | POST /api/outreach/send/:draftId`);
    console.log(`   Brief 14 Compliance routes    → GET  /api/deals/:dealId/compliance-status`);
    console.log(`                                 → GET  /api/deals/:dealId/payout-schedule`);
    console.log(`                                 → GET  /api/deals/:dealId/compliance-events`);
    console.log(`                                 → GET  /api/deals/:dealId/compliance-spec`);
    console.log(`                                 → POST /api/deals/:dealId/release-20-percent`);
    console.log(`   Brief 14 Unresolved Payments  → GET  /api/unresolved-payments`);
});
