import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { dealsTable, brandsTable, influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { classifyAndExtract } from '../utils/llm.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const transporter = process.env.SENDGRID_API_KEY 
    ? nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY
        }
      })
    : nodemailer.createTransport({
        host: process.env.NEOMAIL_SMTP_HOST || 'mail.neomail.com',
        port: process.env.NEOMAIL_SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.NEOMAIL_USER,
            pass: process.env.NEOMAIL_PASS
        }
      });

function loadTemplate(templateName) {
    const p = path.resolve(process.cwd(), 'email_templates', templateName);
    return fs.readFileSync(p, 'utf8');
}

export async function classifyNegotiation(emailText, senderType) {
    const systemPrompt = `You are an inbound email classifier for an influencer marketing brokerage. You will receive an email reply from either an influencer/creator or a brand/advertiser, and your job is to classify the reply and extract structured data.

The sender type is: ${senderType}

Classify the reply into exactly one of three categories:

- GREEN: A simple positive engagement that requires no negotiation. Examples: a thank-you, a clarifying question, a scheduling request, a request for more information, or an unconditional yes.

- YELLOW: A reply that contains negotiable substance and requires human approval before responding. Examples: discussion of price/rate/fees, deliverable changes, timeline adjustments, counter-offers, or revisions.

- RED: A reply that contains legal, contractual, or rights-related complexity that requires immediate owner intervention. Examples: requests for exclusivity, perpetual usage rights, custom legal clauses, liability terms, or non-standard payment terms (net 30/60/90).

In addition to classification, extract structured data ONLY if the sender type is 'influencer' AND the email contains a quote (rate, deliverable, timeline). Extract into this shape:

{
  "rate": <number — dollar amount as integer>,
  "deliverable_type": <string — e.g., "1x TikTok integration", "1 YouTube video">,
  "timeline": <string — e.g., "2 weeks", "delivery by Dec 15">,
  "usage_rights": <string — what rights the brand gets, default "Standard">,
  "exclusivity_window": <string — exclusivity terms if any, default "None">
}

If the email is from an influencer but contains no quote data, set extractedData to null.

If the email is from a brand, set extractedData to null regardless.

Also extract a one-sentence intent description.

Respond ONLY with valid JSON in this exact shape, no preamble, no markdown fencing:

{
  "classification": "GREEN" | "YELLOW" | "RED",
  "intent": "one-sentence description of what the sender is saying",
  "extractedData": null | { quote shape above }
}`;

    return await classifyAndExtract({
        systemPrompt,
        userMessage: emailText,
        expectedSchema: 'JSON'
    });
}

export async function processInboundEmail(record, emailText, senderType) {
    console.log(`Processing inbound email for ${senderType} ID: ${record.id}`);

    let classificationResult;
    try {
        classificationResult = await classifyNegotiation(emailText, senderType);
    } catch (e) {
        console.error('LLM Classification Failed:', e.message);
        logActivity('negotiation_handler', record.id, 'LLM_CLASSIFICATION_FAILED', record.status, record.status);
        return;
    }

    const { classification, intent, extractedData } = classificationResult;

    if (senderType === 'influencer') {
        if (classification === 'GREEN') {
            if (extractedData !== null) {
                const downstreamStatuses = ['QUOTE_RECEIVED', 'DEAL_INITIATED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PAYMENT_COLLECTED'];
                const currentStatus = record.status;
                const newStatus = downstreamStatuses.includes(currentStatus) ? currentStatus : 'QUOTE_RECEIVED';

                await updateRecord(influencersTable, record.id, { 
                    status: newStatus,
                    quote_terms: JSON.stringify(extractedData) 
                });
                logActivity('negotiation_handler', record.id, 'QUOTE_RECEIVED', currentStatus, newStatus);
            } else {
                logActivity('negotiation_handler', record.id, 'INBOUND_GREEN_NO_QUOTE', record.status, record.status);
            }
        } else if (classification === 'YELLOW' || classification === 'RED') {
            await updateRecord(influencersTable, record.id, { inbound_flag: classification });
            logActivity('negotiation_handler', record.id, `INBOUND_${classification}`, record.status, record.status);
        }
    } else if (senderType === 'brand') {
        if (classification === 'GREEN') {
            const downstreamStatuses = ['INTERESTED', 'DEAL_INITIATED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PAYMENT_COLLECTED'];
            const currentStatus = record.status;
            const newStatus = downstreamStatuses.includes(currentStatus) ? currentStatus : 'INTERESTED';

            let rosterUrl;
            let token = record.roster_token;
            if (!token || (record.roster_token_expires && new Date() > new Date(record.roster_token_expires))) {
                rosterUrl = await generateRosterLink(record.id);
            } else {
                const baseUrl = process.env.PUBLIC_SERVER_URL || 'http://localhost:3000';
                rosterUrl = `${baseUrl}/roster?t=${token}`;
            }

            await updateRecord(brandsTable, record.id, { status: newStatus });
            logActivity('negotiation_handler', record.id, 'INBOUND_GREEN_BRAND', currentStatus, newStatus);

            const templateRaw = loadTemplate('brand_roster_link_email.txt');
            const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
            let subject = subjectMatch ? subjectMatch[1] : `Your roster — creators ready to work with ${record.company_name}`;
            let body = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

            subject = subject.replace(/{company_name}/g, record.company_name || 'your company');
            body = body.replace(/{contact_name}/g, record.contact_name || 'there')
                       .replace(/{company_name}/g, record.company_name || 'your company')
                       .replace(/{roster_url}/g, rosterUrl)
                       .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                       .replace(/{agency_name}/g, process.env.AGENCY_NAME || "Agency");

            const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
            try {
                await transporter.sendMail({
                    from: `"${process.env.OWNER_NAME}" <${fromEmail}>`,
                    to: record.contact_email,
                    subject: subject,
                    text: body
                });
            } catch (err) {
                console.error(`Failed to send roster link email to ${record.contact_email}: ${err.message}`);
            }

        } else if (classification === 'YELLOW' || classification === 'RED') {
            await updateRecord(brandsTable, record.id, { inbound_flag: classification });
            logActivity('negotiation_handler', record.id, `INBOUND_${classification}`, record.status, record.status);
        }
    }
}

export async function generateRosterLink(brandId) {
    const token = crypto.randomBytes(16).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 14); // 14 days from now

    await updateRecord(brandsTable, brandId, {
        roster_token: token,
        roster_token_expires: expires.toISOString(),
        roster_view_count: 0
    });

    const baseUrl = process.env.PUBLIC_SERVER_URL || 'http://localhost:3000';
    return `${baseUrl}/roster?t=${token}`;
}
