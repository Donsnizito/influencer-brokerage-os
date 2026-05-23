import { webhookEventsTable, fetchRecords, createRecord, updateRecord } from './airtable.js';

// Check if an event has already been processed.
// Returns the existing record if found, null if not.
export async function findExistingEvent(provider, eventId) {
    try {
        // filterByFormula requires fields with spaces to be wrapped, but event_id and provider don't have spaces.
        const formula = `AND({event_id} = '${eventId}', {provider} = '${provider}')`;
        const records = await fetchRecords(webhookEventsTable, formula);
        if (records && records.length > 0) {
            return records[0];
        }
        return null;
    } catch (error) {
        console.error(`Error in findExistingEvent (${provider}, ${eventId}):`, error.message);
        return null;
    }
}

// Create a new WebhookEvents record at receive time, before processing.
// Returns the Airtable record ID for later updates.
export async function recordReceive({ provider, eventId, eventType, verified, rawPayload }) {
    try {
        const result = await createRecord(webhookEventsTable, {
            event_id: eventId,
            provider: provider,
            event_type: eventType,
            verified: verified,
            processed: false,
            received_at: new Date().toISOString(),
            raw_payload: rawPayload ? String(rawPayload).slice(0, 5000) : ''
        });
        return result.id;
    } catch (error) {
        console.error(`Error in recordReceive (${provider}, ${eventId}):`, error.message);
        return null;
    }
}

// Mark an event as successfully processed.
export async function markProcessed(recordId, notes = '') {
    if (!recordId) return; // In case recordReceive failed but handler continued
    try {
        await updateRecord(webhookEventsTable, recordId, {
            processed: true,
            notes: notes ? String(notes).slice(0, 5000) : ''
        });
    } catch (error) {
        console.error(`Error in markProcessed (${recordId}):`, error.message);
    }
}

// Mark an event as failed with a reason.
export async function markFailed(recordId, errorMessage) {
    if (!recordId) return;
    try {
        await updateRecord(webhookEventsTable, recordId, {
            processed: false,
            notes: errorMessage ? String(errorMessage).slice(0, 5000) : ''
        });
    } catch (error) {
        console.error(`Error in markFailed (${recordId}):`, error.message);
    }
}
