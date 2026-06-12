import Stripe from 'stripe';
import dotenv from 'dotenv';
import { pathToFileURL } from 'url';
import path from 'path';
import { dealsTable, brandsTable, influencersTable, complianceEventsTable, unresolvedPaymentsTable, fetchRecords, updateRecord, createRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { sendOutreachEmail } from '../utils/notifications.js';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export async function createInvoices() {
    if (!process.env.STRIPE_SECRET_KEY) {
        console.warn("Stripe Secret Key not found. Skipping invoice creation.");
        return;
    }

    const deals = await fetchRecords(dealsTable, "status = 'CONTRACT_SIGNED'");

    for (const deal of deals) {
        if (!deal.agreed_rate) continue;

        console.log(`Creating invoice for Deal: ${deal.id}`);

        try {
            const brandId = Array.isArray(deal.brand_id) ? deal.brand_id[0] : deal.brand_id;
            const brands = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
            if (brands.length === 0) {
                logError(Tiers.HIGH, 'payment_handler', `Brand not found for Deal ${deal.id}`, { brand_id: brandId });
                continue;
            }
            const brand = brands[0];

            if (!brand.contact_email || !brand.contact_email.includes('@')) {
                logError(Tiers.HIGH, 'payment_handler', `Invalid brand email for Deal ${deal.id}`, { email: brand.contact_email });
                continue;
            }

            const customer = await stripe.customers.create({
                email: brand.contact_email,
                name: brand.company_name || undefined,
                description: `Brand for Deal ${deal.id}`
            });

            // Create Invoice Item
            await stripe.invoiceItems.create({
                customer: customer.id,
                amount: Math.round(deal.agreed_rate * 100), // Stripe expects cents
                currency: 'usd',
                description: `Influencer Marketing Campaign — ${deal.deliverables || 'Standard Package'} — ${brand.company_name || 'Brand'}`
            });

            // Create invoice WITHOUT auto_advance, so we can explicitly finalize after bundling
            const invoice = await stripe.invoices.create({
                customer: customer.id,
                auto_advance: false,
                collection_method: 'send_invoice',
                days_until_due: 14,
                pending_invoice_items_behavior: 'include'
            });

            // Explicitly finalize the invoice — this bundles all pending InvoiceItems for the customer
            await stripe.invoices.finalizeInvoice(invoice.id);

            // Then send the finalized invoice
            await stripe.invoices.sendInvoice(invoice.id);

            // Update Airtable
            await updateRecord(dealsTable, deal.id, {
                status: 'INVOICE_SENT',
                stripe_invoice_id: invoice.id
            });

            logActivity('payment_handler', deal.id, 'INVOICE_SENT', 'CONTRACT_SIGNED', 'INVOICE_SENT');
            console.log(`Invoice ${invoice.id} sent for Deal ${deal.id}`);

        } catch (error) {
            console.error(`Failed to create invoice for Deal ${deal.id}:`, error.message);
        }
    }
}

async function sendOperatorPayoutAlert({ dealId, dealRecordId, amount, grossAmount, brokerFee, influencerName, influencerEmail }) {
    const operatorEmail = process.env.OPERATOR_NOTIFICATION_EMAIL;
    if (!operatorEmail) {
        logError(Tiers.HIGH, 'payment_handler', 'OPERATOR_NOTIFICATION_EMAIL not set — payout alert not sent', { dealId });
        return;
    }
    
    if (!process.env.SENDGRID_API_KEY) {
        logError(Tiers.HIGH, 'payment_handler', 'SENDGRID_API_KEY not set — payout alert not sent', { dealId });
        return;
    }
    
    const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
    
    const subject = `💰 PAYOUT OWED: $${amount} → ${influencerName} (Deal ${dealRecordId})`;
    const body = `
PAYOUT NOTIFICATION
===================

A deal has reached PAYMENT_COLLECTED state and the influencer payout needs to be disbursed manually via Mercury.

DEAL DETAILS
------------
Deal ID:            ${dealRecordId}
Airtable Record:    ${dealId}
Gross Amount:       $${grossAmount}
Broker Fee (15%):   $${brokerFee}
PAYOUT TO PAY:      $${amount}

INFLUENCER
----------
Name:               ${influencerName}
Email:              ${influencerEmail}

NEXT STEPS
----------
1. Send $${amount} to ${influencerName} via Mercury (or your preferred channel)
2. Once disbursed, mark the Deal as PAYMENT_RELEASED in the dashboard

This is an automated alert from the brokerage system.
`;

    try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.SENDGRID_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personalizations: [{
                    to: [{ email: operatorEmail }]
                }],
                from: {
                    email: fromEmail,
                    name: 'Brokerage Alerts'
                },
                subject: subject,
                content: [{
                    type: 'text/plain',
                    value: body
                }]
            })
        });
        
        if (response.ok) {
            console.log(`✉️  Operator alert sent to ${operatorEmail} for Deal ${dealId}`);
        } else {
            const errText = await response.text();
            logError(Tiers.HIGH, 'payment_handler', `Failed to send operator alert for Deal ${dealId}`, { 
                status: response.status, 
                error: errText 
            });
        }
    } catch (err) {
        logError(Tiers.HIGH, 'payment_handler', `Failed to send operator alert for Deal ${dealId}`, { error: err.message });
    }
}

// THIS MUST ONLY BE TRIGGERED MANUALLY BY THE DASHBOARD
export async function releasePayout(dealId) {
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) throw new Error("Deal not found.");
    
    const deal = deals[0];
    if (deal.status !== 'PAYMENT_COLLECTED') {
        throw new Error(`Deal status is ${deal.status}, expected PAYMENT_COLLECTED.`);
    }
    
    // Calculate payout (deal amount minus broker fee)
    const grossAmount = Number(deal.agreed_rate || 0);
    if (grossAmount <= 0) throw new Error("agreed_rate not set on Deal.");
    
    const brokerFee = Math.round(grossAmount * 0.15);
    const payoutAmount = grossAmount - brokerFee;
    
    // Look up influencer for name and email
    const infId = Array.isArray(deal.influencer_id) ? deal.influencer_id[0] : deal.influencer_id;
    const influencers = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
    if (influencers.length === 0) throw new Error(`Influencer not found for Deal ${dealId}`);
    const influencer = influencers[0];
    
    // Write operator-facing flag on Deal
    await updateRecord(dealsTable, deal.id, {
        payout_status: 'PAYOUT_OWED',
        payout_amount: payoutAmount,
        payout_to_influencer_email: influencer.email,
        payout_to_influencer_name: influencer.name,
        payout_flagged_date: new Date().toISOString().split('T')[0]
    });
    
    // Send operator alert email
    await sendOperatorPayoutAlert({
        dealId: deal.id,
        dealRecordId: deal.deal_id,
        amount: payoutAmount,
        grossAmount,
        brokerFee,
        influencerName: influencer.name,
        influencerEmail: influencer.email,
    });
    
    logActivity('payment_handler', deal.id, 'PAYOUT_FLAGGED_FOR_OPERATOR', 'PAYMENT_COLLECTED', 'PAYMENT_COLLECTED');
    console.log(`📢 Payout flagged for Deal ${deal.id}: $${payoutAmount} owed to ${influencer.name}`);
    
    return { 
        flagged: true, 
        amount: payoutAmount, 
        influencer: influencer.name 
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Brief 14: 80/20 payout split functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Release the 80% portion of the creator payout when brand_approval is received.
 *
 * Called by the operator dashboard after a brand_approval ComplianceEvent has been
 * recorded. Fires a Stripe transfer to the creator's connected account,
 * writes a payment_released_80 ComplianceEvent, and updates creator_payout_schedule.
 *
 * At early volume (pre-30 deals/month), the operator confirms delivery quality
 * before approving. Auto-release is a future Brief 15 enhancement.
 *
 * @param {string} dealId - Airtable record ID
 * @returns {Promise<{ released: boolean, amount: number, transferId: string|null }>}
 */
export async function release80Percent(dealId) {
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) throw new Error(`Deal not found: ${dealId}`);
    const deal = deals[0];

    // Verify deal is in a post-lock state that supports 80% release
    const postLockStates = ['LOCKED', 'CONTRACTS_SENT', 'CONTRACTS_SIGNED', 'CAMPAIGN_LIVE', 'DELIVERY_UPLOADED', 'DELIVERY_APPROVED'];
    if (!postLockStates.includes(deal.status)) {
        throw new Error(`Deal ${dealId} status '${deal.status}' does not support 80% release`);
    }

    // Parse payout schedule — defensive per §0.3
    let payoutSchedule;
    try {
        payoutSchedule = JSON.parse(deal.creator_payout_schedule ?? '{}');
    } catch (e) {
        throw new Error(`Cannot parse creator_payout_schedule for Deal ${dealId}: ${e.message}`);
    }

    // Idempotency: check if 80% already released
    if (payoutSchedule.split_80_released_at) {
        console.log(`[payment_handler] 80% already released for Deal ${dealId} on ${payoutSchedule.split_80_released_at}`);
        return { released: false, reason: 'already_released', amount: payoutSchedule.split_80_amount };
    }

    const amount = payoutSchedule.split_80_amount;
    if (!amount || amount <= 0) throw new Error(`Invalid split_80_amount for Deal ${dealId}`);

    // At early volume: Stripe transfer requires connected account ID on the influencer record.
    // If not configured, fall back to operator-alert model (same pattern as releasePayout).
    const infId = Array.isArray(deal.influencer_id) ? deal.influencer_id[0] : deal.influencer_id;
    const influencers = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
    if (influencers.length === 0) throw new Error(`Influencer not found for Deal ${dealId}`);
    const influencer = influencers[0];

    let transferId = null;

    if (influencer.stripe_connected_account_id) {
        // Fire Stripe transfer to creator's connected account
        const transfer = await stripe.transfers.create({
            amount: Math.round(amount * 100), // cents
            currency: 'usd',
            destination: influencer.stripe_connected_account_id,
            description: `80% payout for Deal ${dealId}`,
            metadata: { deal_id: dealId, payout_split: '80' }
        });
        transferId = transfer.id;
        console.log(`[payment_handler] 80% Stripe transfer created: ${transferId} ($${amount}) for Deal ${dealId}`);
    } else {
        // No connected account: operator-alert model (email alert with amount)
        logError(Tiers.HIGH, 'payment_handler', `No stripe_connected_account_id on influencer ${infId} — 80% payout flagged for manual disbursement`, { dealId, amount });
    }

    const releasedAt = new Date().toISOString();

    // Write payment_released_80 ComplianceEvent
    await complianceEventsTable.create([{
        fields: {
            deal_id: [dealId],
            event_type: 'payment_released_80',
            event_payload: JSON.stringify({ amount, transfer_id: transferId }),
            event_source: 'system_derived',
            event_actor: 'payment_handler',
            event_notes: `80% payout released: $${amount}${transferId ? ` (Stripe transfer ${transferId})` : ' (manual disbursement pending)'}`
        }
    }]);

    // Update creator_payout_schedule
    payoutSchedule.split_80_released_at = releasedAt;
    payoutSchedule.split_80_stripe_transfer_id = transferId;
    await updateRecord(dealsTable, dealId, {
        status: 'DELIVERY_APPROVED',
        creator_payout_schedule: JSON.stringify(payoutSchedule)
    });

    logActivity('payment_handler', dealId, 'PAYOUT_80_RELEASED', deal.status, 'DELIVERY_APPROVED');
    return { released: true, amount, transferId };
}

/**
 * Release the 20% compliance-validation hold after day-30 eligibility is confirmed.
 *
 * Called by POST /api/deals/:dealId/release-20-percent (operator-triggered dashboard button).
 * The endpoint has already verified day-30 eligibility via checkDay30Eligibility().
 * This function executes the transfer and writes the ComplianceEvent.
 *
 * @param {string} dealId - Airtable record ID
 * @returns {Promise<{ released: boolean, amount: number, transferId: string|null }>}
 */
export async function release20Percent(dealId) {
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) throw new Error(`Deal not found: ${dealId}`);
    const deal = deals[0];

    let payoutSchedule;
    try {
        payoutSchedule = JSON.parse(deal.creator_payout_schedule ?? '{}');
    } catch (e) {
        throw new Error(`Cannot parse creator_payout_schedule for Deal ${dealId}: ${e.message}`);
    }

    // Idempotency: check if 20% already released
    if (payoutSchedule.split_20_released_at) {
        console.log(`[payment_handler] 20% already released for Deal ${dealId} on ${payoutSchedule.split_20_released_at}`);
        return { released: false, reason: 'already_released', amount: payoutSchedule.split_20_amount };
    }

    const amount = payoutSchedule.split_20_amount;
    if (!amount || amount <= 0) throw new Error(`Invalid split_20_amount for Deal ${dealId}`);

    const infId = Array.isArray(deal.influencer_id) ? deal.influencer_id[0] : deal.influencer_id;
    const influencers = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
    if (influencers.length === 0) throw new Error(`Influencer not found for Deal ${dealId}`);
    const influencer = influencers[0];

    let transferId = null;

    if (influencer.stripe_connected_account_id) {
        const transfer = await stripe.transfers.create({
            amount: Math.round(amount * 100),
            currency: 'usd',
            destination: influencer.stripe_connected_account_id,
            description: `20% compliance-hold release for Deal ${dealId}`,
            metadata: { deal_id: dealId, payout_split: '20' }
        });
        transferId = transfer.id;
        console.log(`[payment_handler] 20% Stripe transfer created: ${transferId} ($${amount}) for Deal ${dealId}`);
    } else {
        logError(Tiers.HIGH, 'payment_handler', `No stripe_connected_account_id on influencer ${infId} — 20% payout flagged for manual disbursement`, { dealId, amount });
    }

    const releasedAt = new Date().toISOString();

    // Write payment_released_20 ComplianceEvent
    await complianceEventsTable.create([{
        fields: {
            deal_id: [dealId],
            event_type: 'payment_released_20',
            event_payload: JSON.stringify({ amount, transfer_id: transferId }),
            event_source: 'system_derived',
            event_actor: 'payment_handler',
            event_notes: `20% compliance-hold released: $${amount}${transferId ? ` (Stripe transfer ${transferId})` : ' (manual disbursement pending)'}`
        }
    }]);

    // Update creator_payout_schedule + deal status
    payoutSchedule.split_20_released_at = releasedAt;
    payoutSchedule.split_20_stripe_transfer_id = transferId;
    payoutSchedule.compliance_hold = false;
    await updateRecord(dealsTable, dealId, {
        status: 'CAMPAIGN_COMPLETE',
        creator_payout_schedule: JSON.stringify(payoutSchedule)
    });

    logActivity('payment_handler', dealId, 'PAYOUT_20_RELEASED', deal.status, 'CAMPAIGN_COMPLETE');
    return { released: true, amount, transferId };
}

/**
 * Write an UnresolvedPayments record and send operator alert email for a
 * payment_intent.succeeded event that arrived without deal_id metadata.
 *
 * Pin 1 — dual-surface recovery:
 *   Surface 1 (durable): UnresolvedPayments Airtable record (queryable, dashboard-renderable)
 *   Surface 2 (immediate): operator alert email via sendOutreachEmail / SendGrid
 *
 * @param {{ paymentIntentId: string, stripeEventId: string, customerEmail: string, amount: number, timestamp: string }} params
 * @returns {Promise<{ recordId: string|null }>}
 */
export async function sendOperatorAlertForUnresolvedPayment({ paymentIntentId, stripeEventId, customerEmail, amount, timestamp }) {
    const operatorEmail = process.env.OPERATOR_NOTIFICATION_EMAIL;
    const amountFormatted = `$${(amount / 100).toFixed(2)}`; // Stripe amount is in cents

    // Surface 1: Write to UnresolvedPayments (durable state)
    let recordId = null;
    try {
        const created = await unresolvedPaymentsTable.create([{
            fields: {
                payment_intent_id: paymentIntentId,
                stripe_event_id: stripeEventId,
                customer_email: customerEmail ?? '',
                amount: amount / 100 // store in dollars
            }
        }]);
        recordId = created[0]?.id ?? null;
        console.log(`[payment_handler] UnresolvedPayments record created: ${recordId} for payment_intent ${paymentIntentId}`);
    } catch (err) {
        logError(Tiers.HIGH, 'payment_handler', `Failed to write UnresolvedPayments record`, {
            paymentIntentId, stripeEventId, error: err.message
        });
    }

    // Surface 2: Immediate operator alert email
    if (!operatorEmail) {
        logError(Tiers.HIGH, 'payment_handler', 'OPERATOR_NOTIFICATION_EMAIL not set — unresolved payment alert not sent', { paymentIntentId });
        return { recordId };
    }

    const subject = `⚠️ UNRESOLVED PAYMENT: ${amountFormatted} — no deal_id metadata (${paymentIntentId})`;
    const body = `UNRESOLVED PAYMENT ALERT
========================

A Stripe payment_intent.succeeded event arrived without deal_id metadata.
The payment has been received but the deal lock could not be triggered.

STRIPE DETAILS
--------------
Payment Intent:   ${paymentIntentId}
Stripe Event ID:  ${stripeEventId}
Customer Email:   ${customerEmail ?? '(not available)'}
Amount:           ${amountFormatted}
Received At:      ${timestamp}

ACTION REQUIRED
---------------
1. Look up the payment in the Stripe dashboard: ${paymentIntentId}
2. Identify which Deal this payment was for (customer email: ${customerEmail})
3. Manually trigger the lock pipeline for that Deal via the operator dashboard
4. Mark the UnresolvedPayments record as resolved (record ID: ${recordId ?? 'creation failed — check logs'})

This event is recorded in the UnresolvedPayments table for audit and querying.

This is an automated alert from the brokerage compliance system.
`;

    try {
        await sendOutreachEmail({ to: operatorEmail, subject, body });
        console.log(`[payment_handler] Unresolved payment alert sent to ${operatorEmail} for ${paymentIntentId}`);
    } catch (err) {
        logError(Tiers.HIGH, 'payment_handler', `Failed to send unresolved payment alert email`, {
            paymentIntentId, error: err.message
        });
    }

    return { recordId };
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    createInvoices().then(() => console.log('Invoice creation run complete.'));
}
