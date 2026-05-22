import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { brandsTable, influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { updateTrackingInfo } from '../utils/tracker.js';
import { logError, Tiers } from '../utils/errorHandler.js';

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

function isValidEmail(email) {
    if (!email) return false;
    const lower = email.toLowerCase();
    if (lower.includes('mock_') || lower.includes('test@') || lower.includes('example.com')) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

export async function runBrandOutreach() {
    if (!process.env.NEOMAIL_USER && !process.env.SENDGRID_API_KEY) return;

    const templateRaw = loadTemplate('brand_pitch_email1.txt');
    const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
    const subjectRaw = subjectMatch ? subjectMatch[1] : 'Creators in {niche}';
    const bodyRaw = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

    const nichesData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'config', 'niches.json'), 'utf8'));
    const getLabel = (id) => nichesData.niches.find(n => n.id === id)?.label || id;

    // 1. Fetch available influencers to build clusters
    // Only pitch if influencers have received a quote or are further along
    const infRecords = await fetchRecords(influencersTable, "AND(status != 'INFLUENCER_DISCOVERED', status != 'QUOTE_REQUESTED', status != 'COLD', status != 'INVALID_EMAIL')");

    const clusters = {};
    for (const rec of infRecords) {
        if (!clusters[rec.niche]) clusters[rec.niche] = [];
        clusters[rec.niche].push(rec);
    }

    // 2. Process clusters
    for (const niche in clusters) {
        const infs = clusters[niche];
        const combinedFollowers = infs.reduce((sum, inf) => sum + (inf.subscriber_count || 0), 0);
        
        // Ensure cluster meets criteria to protect pitch credibility
        if (infs.length < 5) {
            console.log(`Skipping niche ${niche}: Only ${infs.length} creators (need 5+)`);
            continue;
        }
        const avgEngagement = infs.reduce((sum, inf) => sum + (inf.engagement_rate || 0), 0) / infs.length;

        // Fetch brands for this niche that are cold
        const brands = await fetchRecords(brandsTable, `AND(niche = '${niche}', OR(status = 'BRAND_COLD', status = ''))`);
        
        for (const brand of brands) {
            if (!isValidEmail(brand.contact_email)) {
                console.log(`Skipping invalid/mock brand email: ${brand.contact_email}`);
                try { await updateRecord(brandsTable, brand.id, { status: 'INVALID_EMAIL' }); } catch (e) {}
                continue;
            }

            const nicheLabel = getLabel(niche);
            const subject = subjectRaw
                .replace(/{niche}/g, nicheLabel)
                .replace(/{company_name}/g, brand.name);

            const body = bodyRaw
                .replace(/{contact_name}/g, brand.contact_name || 'there')
                .replace(/{niche}/g, nicheLabel)
                .replace(/{company_name}/g, brand.name)
                .replace(/{combined_followers}/g, combinedFollowers.toLocaleString())
                .replace(/{avg_engagement}/g, (avgEngagement * 100).toFixed(2))
                .replace(/{adjacent_verticals}/g, "related spaces")
                .replace(/{owner_name}/g, process.env.OWNER_NAME || "Owner")
                .replace(/{agency_name}/g, process.env.AGENCY_NAME || "Agency");

            try {
                const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
                await transporter.sendMail({
                    from: `"${process.env.OWNER_NAME}" <${fromEmail}>`,
                    to: brand.contact_email,
                    subject: subject,
                    text: body
                });

                await updateRecord(brandsTable, brand.id, {
                    status: 'BRAND_PITCHED'
                });

                updateTrackingInfo(brand.id, {
                    last_contacted: new Date().toISOString().split('T')[0],
                    follow_up_count: 0
                });

                logActivity('brand_outreach', brand.id, 'PITCH_SENT', 'BRAND_COLD', 'BRAND_PITCHED');
                console.log(`Pitched brand ${brand.name} for niche ${nicheLabel}`);
                
                await new Promise(r => setTimeout(r, 2000));
            } catch (err) {
                logError(Tiers.HIGH, 'brand_outreach', `Failed to send pitch to ${brand.name}`, { error: err.message });
            }
        }
    }
}

import { fileURLToPath } from 'url';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runBrandOutreach().then(() => console.log('Brand outreach run complete.'));
}
