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
