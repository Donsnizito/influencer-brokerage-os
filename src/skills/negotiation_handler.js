import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { dealsTable, brandsTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const policyPath = path.resolve(process.cwd(), 'config', 'negotiation_policy.json');
const policyData = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

export function classifyNegotiation(emailText) {
    const text = emailText.toLowerCase();

    // HARD_STOP Triggers
    if (text.includes('exclusive') || text.includes('exclusivity') ||
        text.includes('rights') || text.includes('usage') || text.includes('license') || text.includes('perpetual') ||
        text.includes('contract') || text.includes('legal') || text.includes('clause') || text.includes('liability') ||
        text.includes('payment terms') || text.includes('net 30') || text.includes('net 60')) {
        return 'HARD_STOP';
    }

    // HUMAN_APPROVAL_REQUIRED Triggers
    if (text.includes('$') || text.includes('price') || text.includes('rate') || text.includes('fee') || text.includes('discount') ||
        text.includes('deliverable') || text.includes('shorts') || text.includes('story') || text.includes('revisions') ||
        text.includes('timeline') || text.includes('deadline') || text.includes('postpone') || text.includes('counter')) {
        return 'HUMAN_APPROVAL_REQUIRED';
    }

    // AUTO_SEND_ALLOWED
    if (text.includes('hello') || text.includes('thanks') || text.includes('call') || text.includes('schedule') ||
        text.includes('clarify') || text.includes('media kit') || text.includes('question')) {
        return 'AUTO_SEND_ALLOWED';
    }

    // Default
    return 'HUMAN_APPROVAL_REQUIRED';
}

export async function processInboundEmail(dealId, emailText, senderType) {
    console.log(`Processing inbound email for Deal ID: ${dealId}`);

    const mode = classifyNegotiation(emailText);
    let escalationFlag = '';
    let statusUpdate = 'NEGOTIATING';
    
    // Fetch deal
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) return;
    const deal = deals[0];

    let history = [];
    try {
        history = JSON.parse(deal.negotiation_history || '[]');
    } catch(e) {}
    
    history.push({
        timestamp: new Date().toISOString(),
        sender: senderType,
        text: emailText,
        classification: mode
    });

    const updateData = {
        negotiation_history: JSON.stringify(history),
        status: statusUpdate
    };

    if (mode === 'HARD_STOP') {
        updateData.escalation_flag = 'RED';
        console.log(`[RED FLAG] Deal ${dealId} requires immediate owner intervention.`);
    } else if (mode === 'HUMAN_APPROVAL_REQUIRED') {
        updateData.escalation_flag = 'YELLOW';
        console.log(`[YELLOW FLAG] Deal ${dealId} requires owner approval for drafted response.`);
    } else if (mode === 'AUTO_SEND_ALLOWED') {
        updateData.escalation_flag = 'GREEN';
        console.log(`[GREEN FLAG] Deal ${dealId} auto-send allowed (non-financial).`);
        // In reality, would trigger an auto-reply here
    }

    await updateRecord(dealsTable, deal.id, updateData);
    logActivity('negotiation_handler', deal.id, `INBOUND_${mode}`, deal.status, statusUpdate);
}

// Example usage
// processInboundEmail('rec123456', 'We need exclusivity for 90 days.', 'brand');

export async function generateRosterLink(brandId) {
    const token = crypto.randomBytes(16).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 14); // 14 days from now

    await updateRecord(brandsTable, brandId, {
        roster_token: token,
        roster_token_expires: expires.toISOString(),
        roster_view_count: 0
    });

    const rosterUrl = `http://localhost:3000/roster?t=${token}`;
    console.log(`Generated Roster URL for Brand ${brandId}: ${rosterUrl}`);
    
    // In reality, this URL would be injected into an email reply to the brand
    return rosterUrl;
}
