import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';
import { dealsTable, brandsTable, influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import nodemailer from 'nodemailer';
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
                days_until_due: 14
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

const transporter = process.env.SENDGRID_API_KEY 
    ? nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY }
      })
    : null;

async function sendOperatorPayoutAlert({ dealId, dealRecordId, amount, grossAmount, brokerFee, influencerName, influencerEmail }) {
    const operatorEmail = process.env.OPERATOR_NOTIFICATION_EMAIL;
    if (!operatorEmail) {
        logError(Tiers.HIGH, 'payment_handler', 'OPERATOR_NOTIFICATION_EMAIL not set — payout alert not sent', { dealId });
        return;
    }
    
    if (!transporter) {
        logError(Tiers.HIGH, 'payment_handler', 'No email transporter configured — payout alert not sent', { dealId });
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
        await transporter.sendMail({
            from: `"Brokerage Alerts" <${fromEmail}>`,
            to: operatorEmail,
            subject,
            text: body
        });
        console.log(`✉️  Operator alert sent to ${operatorEmail} for Deal ${dealId}`);
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

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    createInvoices().then(() => console.log('Invoice creation run complete.'));
}
