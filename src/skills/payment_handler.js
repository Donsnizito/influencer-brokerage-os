import Stripe from 'stripe';
import dotenv from 'dotenv';
import path from 'path';
import { dealsTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';

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
            // In a real app, you'd look up the Stripe Customer ID or create a new one based on the brand's email
            // For now, we simulate with a dummy customer creation
            const customer = await stripe.customers.create({
                email: "brand_contact@placeholder.com", // Fetch from linked brand record
                description: `Brand for Deal ${deal.id}`
            });

            // Create Invoice Item
            await stripe.invoiceItems.create({
                customer: customer.id,
                amount: Math.round(deal.agreed_rate * 100), // Stripe expects cents
                currency: 'usd',
                description: `Influencer Marketing Campaign — ${deal.deliverables || 'Standard Package'}`
            });

            // Create and Finalize Invoice
            const invoice = await stripe.invoices.create({
                customer: customer.id,
                auto_advance: true,
                collection_method: 'send_invoice',
                days_until_due: 14
            });

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

// THIS MUST ONLY BE TRIGGERED MANUALLY BY THE DASHBOARD
export async function releasePayout(dealId) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe Secret Key not found.");

    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) throw new Error("Deal not found.");
    
    const deal = deals[0];
    if (deal.status !== 'PAYMENT_COLLECTED') throw new Error(`Deal status is ${deal.status}, expected PAYMENT_COLLECTED.`);

    if (!deal.influencer_payout) throw new Error("influencer_payout amount not set on Deal.");

    try {
        // In reality, this requires the Influencer's connected Stripe Account ID
        // const transfer = await stripe.transfers.create({
        //     amount: Math.round(deal.influencer_payout * 100),
        //     currency: 'usd',
        //     destination: 'acct_1032D82eZvKYlo2C', // Influencer's connected account ID
        // });

        console.log(`[SIMULATION] Stripe Transfer created for $${deal.influencer_payout}`);

        await updateRecord(dealsTable, deal.id, {
            status: 'PAYMENT_RELEASED',
            payment_released_date: new Date().toISOString().split('T')[0]
        });

        // Auto transition to live
        await updateRecord(dealsTable, deal.id, {
            status: 'CAMPAIGN_LIVE'
        });

        logActivity('payment_handler', deal.id, 'PAYOUT_RELEASED', 'PAYMENT_COLLECTED', 'CAMPAIGN_LIVE');
        console.log(`Payout released and Campaign marked live for Deal ${deal.id}`);

        return true;
    } catch (error) {
        console.error(`Failed to release payout for Deal ${deal.id}:`, error.message);
        throw error;
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    createInvoices().then(() => console.log('Invoice creation run complete.'));
}
