import Airtable from 'airtable';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from the root directory
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
    console.warn("⚠️ Airtable API Key or Base ID is missing from .env");
}

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

export const influencersTable = base('Influencers');
export const brandsTable = base('Brands');
export const dealsTable = base('Deals');
export const webhookEventsTable = base('WebhookEvents');
export const outreachDraftsTable = base('OutreachDrafts');  // Brief 12 — Brief 7d verified this table exists with all 26 fields
export const complianceEventsTable = base('ComplianceEvents');  // Brief 14 — operator creates table per Section B.1 (10 fields: event_id Autonumber, deal_id linked, event_type single-select, event_at created-time, event_payload long-text JSON, event_attachment attachment, event_source single-select, event_actor single-line, event_notes long-text, updated_at last-modified)
export const unresolvedPaymentsTable = base('UnresolvedPayments');  // Brief 14 Pin 1 — durable surface for payment_intent.succeeded events with missing deal_id metadata (7 fields: payment_intent_id, stripe_event_id, customer_email, amount, received_at created-time, resolved_at date, resolution_notes long-text)

export async function fetchRecords(table, filterFormula = '') {
    try {
        const records = await table.select({ filterByFormula: filterFormula }).all();
        return records.map(record => ({ id: record.id, ...record.fields }));
    } catch (error) {
        console.error(`Error fetching records from Airtable:`, error.message);
        return [];
    }
}

export async function updateRecord(table, recordId, fields) {
    try {
        const result = await table.update(recordId, fields);
        return result;
    } catch (error) {
        console.error(`Error updating record in Airtable:`, error.message);
        throw error;
    }
}

export async function createRecord(table, fields) {
    try {
        const result = await table.create(fields);
        return result;
    } catch (error) {
        console.error(`Error creating record in Airtable:`, error.message);
        throw error;
    }
}

export async function deleteRecord(table, recordId) {
    try {
        const result = await table.destroy(recordId);
        return result;
    } catch (error) {
        console.error(`Error deleting record in Airtable:`, error.message);
        throw error;
    }
}
