import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { influencersTable, brandsTable, dealsTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { getTrackingInfo, updateTrackingInfo } from '../utils/tracker.js';
import { logError, Tiers } from '../utils/errorHandler.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MAX_DAILY_OUTREACH = 70; // Shared limit
const MAX_FOLLOWUPS = 5;

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

function isValidEmail(email) {
    if (!email) return false;
    const lower = email.toLowerCase();
    if (lower.includes('mock_') || lower.includes('test@') || lower.includes('example.com')) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

export async function runFollowUpEngine() {
    if (!process.env.NEOMAIL_USER && !process.env.SENDGRID_API_KEY) return;
    
    let sentCount = 0;

    const today = new Date();
    
    // helper to get days difference
    const getDaysDiff = (dateStr) => {
        if (!dateStr) return 999;
        const past = new Date(dateStr);
        return Math.floor((today - past) / (1000 * 60 * 60 * 24));
    };

    // 1. INFLUENCER FOLLOW-UPS
    const infRecords = await fetchRecords(influencersTable, "OR(status = 'QUOTE_REQUESTED', status = 'QUOTE_RECEIVED')");
    
    for (const rec of infRecords) {
        if (sentCount >= MAX_DAILY_OUTREACH) break;

        if (!isValidEmail(rec.email)) {
            console.log(`Skipping invalid/mock email: ${rec.email}`);
            try { await updateRecord(influencersTable, rec.id, { status: 'INVALID_EMAIL' }); } catch (e) {}
            continue;
        }

        const tracking = getTrackingInfo(rec.id);
        const daysSince = getDaysDiff(tracking.last_contacted);
        const followupCount = tracking.follow_up_count || 0;

        let templateName = null;

        if (daysSince >= 4 && followupCount === 0) {
            templateName = 'influencer_followup_day4.txt';
        } else if (daysSince >= 10 && followupCount === 1) {
            templateName = 'influencer_followup_day10.txt';
        } else if (followupCount >= 2 && daysSince >= 14) {
            await updateRecord(influencersTable, rec.id, { status: 'COLD' });
            logActivity('follow_up_engine', rec.id, 'MARKED_COLD', rec.status, 'COLD');
            continue;
        }

        if (templateName) {
            const templateRaw = loadTemplate(templateName);
            const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
            const subjectRaw = subjectMatch ? subjectMatch[1] : 'Following up';
            const bodyRaw = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

            const firstName = rec.name ? rec.name.split(' ')[0] : 'there';
            
            const subject = subjectRaw.replace('{first_name}', firstName);
            const body = bodyRaw
                .replace(/{first_name}/g, firstName)
                .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                .replace(/{agency_name}/g, process.env.AGENCY_NAME || "Agency");

            try {
                const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
                await transporter.sendMail({
                    from: `"${process.env.OWNER_NAME}" <${fromEmail}>`,
                    to: rec.email,
                    subject: subject,
                    text: body
                });

                updateTrackingInfo(rec.id, {
                    last_contacted: today.toISOString().split('T')[0],
                    follow_up_count: followupCount + 1
                });

                logActivity('follow_up_engine', rec.id, `FOLLOWUP_${followupCount + 1}_SENT`, rec.status, rec.status);
                console.log(`Sent Followup ${followupCount + 1} to Influencer ${rec.email}`);
                sentCount++;
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                logError(Tiers.HIGH, 'follow_up_engine', `Failed to send follow-up to ${rec.email}`, { error: err.message });
            }
        }
    }

    // 2. BRAND FOLLOW-UPS
    const brandRecords = await fetchRecords(brandsTable, "status = 'BRAND_PITCHED'");
    for (const rec of brandRecords) {
        if (sentCount >= MAX_DAILY_OUTREACH) break;

        if (!isValidEmail(rec.contact_email)) {
            console.log(`Skipping invalid/mock email: ${rec.contact_email}`);
            try { await updateRecord(brandsTable, rec.id, { status: 'INVALID_EMAIL' }); } catch (e) {}
            continue;
        }

        const tracking = getTrackingInfo(rec.id);
        const daysSince = getDaysDiff(tracking.last_contacted);
        const followupCount = tracking.follow_up_count || 0;

        if (daysSince >= 4 && followupCount === 0) {
            const templateRaw = loadTemplate('brand_followup_day4.txt');
            const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
            const subjectRaw = subjectMatch ? subjectMatch[1] : 'Following up';
            const bodyRaw = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

            const subject = subjectRaw
                .replace(/{niche}/g, rec.niche || 'your space')
                .replace(/{company_name}/g, rec.name);
            const body = bodyRaw
                .replace(/{contact_name}/g, rec.contact_name || 'there')
                .replace(/{niche}/g, rec.niche || 'your space')
                .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                .replace(/{agency_name}/g, process.env.AGENCY_NAME || "Agency");

            try {
                const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
                await transporter.sendMail({
                    from: `"${process.env.OWNER_NAME}" <${fromEmail}>`,
                    to: rec.contact_email,
                    subject: subject,
                    text: body
                });

                updateTrackingInfo(rec.id, {
                    last_contacted: today.toISOString().split('T')[0],
                    follow_up_count: followupCount + 1
                });

                logActivity('follow_up_engine', rec.id, `BRAND_FOLLOWUP_SENT`, rec.status, rec.status);
                console.log(`Sent Followup to Brand ${rec.name}`);
                sentCount++;
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                logError(Tiers.HIGH, 'follow_up_engine', `Failed to send follow-up to brand ${rec.name}`, { error: err.message });
            }
        } else if (followupCount >= 1 && daysSince >= 10) {
            await updateRecord(brandsTable, rec.id, { status: 'BRAND_COLD' });
            logActivity('follow_up_engine', rec.id, 'MARKED_BRAND_COLD', rec.status, 'BRAND_COLD');
        }
    }

    // 3. NEGOTIATION STAGNATION
    const policyPath = path.resolve(process.cwd(), 'config', 'negotiation_policy.json');
    const policyData = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    const staleDaysLimit = policyData.stale_deal_escalation_days || 5;

    const deals = await fetchRecords(dealsTable, "OR(status = 'NEGOTIATING', status = 'CONTRACT_SENT')");
    for (const deal of deals) {
        // Find last touch point in history
        let lastTouch = new Date(deal.createdTime || 0); // fallback
        try {
            const history = JSON.parse(deal.negotiation_history || '[]');
            if (history.length > 0) {
                lastTouch = new Date(history[history.length - 1].timestamp);
            }
        } catch (e) {}

        const daysSince = Math.floor((today - lastTouch) / (1000 * 60 * 60 * 24));
        
        const tracking = getTrackingInfo(deal.id);
        if (daysSince > staleDaysLimit && tracking.escalation_flag !== 'YELLOW') {
            updateTrackingInfo(deal.id, { escalation_flag: 'YELLOW' });
            logActivity('follow_up_engine', deal.id, 'STALE_ESCALATION', deal.status, deal.status);
            console.log(`Flagged Deal ${deal.id} as YELLOW due to ${daysSince} days stagnation.`);
        }
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runFollowUpEngine().then(() => console.log('Follow-up run complete.'));
}
