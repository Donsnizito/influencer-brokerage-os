import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { updateTrackingInfo } from '../utils/tracker.js';
import { logError, Tiers } from '../utils/errorHandler.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const MAX_DAILY_OUTREACH = 70;

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

export async function runInfluencerOutreach() {
    if (!process.env.NEOMAIL_USER && !process.env.SENDGRID_API_KEY) {
        logError(Tiers.CRITICAL, 'influencer_outreach', "Email credentials not configured. Exiting.");
        return;
    }

    const templateRaw = loadTemplate('influencer_outreach_email1.txt');
    // Extract subject from template
    const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
    const subjectRaw = subjectMatch ? subjectMatch[1] : 'Partnership Opportunity';
    const bodyRaw = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

    const nichesData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'config', 'niches.json'), 'utf8'));
    const getLabel = (id) => nichesData.niches.find(n => n.id === id)?.label || id;

    // Fetch applicable influencers
    const filter = "AND(status = 'INFLUENCER_DISCOVERED', email != '', email != 'MANUAL_NEEDED', status != 'INVALID_EMAIL')";
    const records = await fetchRecords(influencersTable, filter);

    console.log(`Found ${records.length} influencers ready for outreach.`);

    const freemailDomains = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'mac.com']);
    
    // Group by email domain
    const groupsByDomain = {};
    for (const rec of records) {
        if (!isValidEmail(rec.email)) continue;
        const domain = rec.email.split('@')[1].toLowerCase();
        if (!groupsByDomain[domain]) groupsByDomain[domain] = [];
        groupsByDomain[domain].push(rec);
    }

    let sentCount = 0;
    const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
    const senderString = `"${process.env.OWNER_NAME}" <${fromEmail}>`;

    const agencyTemplateRaw = loadTemplate('agency_roster_pitch_email1.txt');
    const agencySubjectMatch = agencyTemplateRaw.match(/SUBJECT:\s*(.+)/);
    const agencySubjectRaw = agencySubjectMatch ? agencySubjectMatch[1] : 'Roster Partnership Opportunity';
    const agencyBodyRaw = agencyTemplateRaw.replace(/SUBJECT:\s*.+\n+/, '');

    for (const [domain, group] of Object.entries(groupsByDomain)) {
        if (sentCount >= MAX_DAILY_OUTREACH) break;

        if (group.length > 1 && !freemailDomains.has(domain)) {
            // AGENCY ROSTER PITCH
            console.log(`Detected Agency Domain: ${domain} with ${group.length} creators. Rolling up...`);
            
            const primaryContact = group[0].email; // Send to the first one, or partnerships@ if we had it
            const rosterNames = group.map(g => `- ${g.name}`).join('\n');
            const nicheLabel = getLabel(group[0].niche);

            const subject = agencySubjectRaw;
            const body = agencyBodyRaw
                .replace(/{niche_reference}/g, nicheLabel)
                .replace(/{roster_names}/g, rosterNames)
                .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                .replace(/{brokerage_name}/g, process.env.AGENCY_NAME || "Agency");

            try {
                await transporter.sendMail({
                    from: senderString,
                    to: primaryContact,
                    subject: subject,
                    text: body
                });

                // Update all grouped influencers
                for (const rec of group) {
                    await updateRecord(influencersTable, rec.id, { status: 'QUOTE_REQUESTED' });
                    updateTrackingInfo(rec.id, {
                        last_contacted: new Date().toISOString().split('T')[0],
                        follow_up_count: 0
                    });
                    logActivity('influencer_outreach', rec.id, 'AGENCY_EMAIL_SENT', 'INFLUENCER_DISCOVERED', 'QUOTE_REQUESTED');
                }
                
                console.log(`Sent Agency Roll-up outreach to ${primaryContact} for ${group.length} creators.`);
                sentCount++;
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                logError(Tiers.HIGH, 'influencer_outreach', `Failed to send Agency email to ${primaryContact}`, { error: err.message });
            }
        } else {
            // INDIVIDUAL PITCHES
            for (const rec of group) {
                if (sentCount >= MAX_DAILY_OUTREACH) break;

        if (!isValidEmail(rec.email)) {
            console.log(`Skipping invalid/mock email: ${rec.email}`);
            try {
                await updateRecord(influencersTable, rec.id, { status: 'INVALID_EMAIL' });
            } catch (e) {}
            continue;
        }

                const firstName = rec.name ? rec.name.split(' ')[0] : 'there';
                const nicheLabel = getLabel(rec.niche);

                const subject = subjectRaw.replace('{first_name}', firstName);
                const body = bodyRaw
                    .replace(/{first_name}/g, firstName)
                    .replace(/{niche_reference}/g, nicheLabel)
                    .replace(/{personal_touch}/g, "your recent videos have been incredible")
                    .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                    .replace(/{agency_name}/g, process.env.AGENCY_NAME || "Agency");

                try {
                    await transporter.sendMail({
                        from: senderString,
                        to: rec.email,
                        subject: subject,
                        text: body
                    });

                    await updateRecord(influencersTable, rec.id, { status: 'QUOTE_REQUESTED' });
                    updateTrackingInfo(rec.id, {
                        last_contacted: new Date().toISOString().split('T')[0],
                        follow_up_count: 0
                    });
                    logActivity('influencer_outreach', rec.id, 'EMAIL_SENT', 'INFLUENCER_DISCOVERED', 'QUOTE_REQUESTED');
                    console.log(`Sent individual outreach to ${rec.email}`);
                    sentCount++;
                    
                    await new Promise(r => setTimeout(r, 2000));
                } catch (err) {
                    logError(Tiers.HIGH, 'influencer_outreach', `Failed to send individual email to ${rec.email}`, { error: err.message });
                }
            }
        }
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runInfluencerOutreach().then(() => console.log('Outreach run complete.'));
}
