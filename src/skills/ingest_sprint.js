import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { influencersTable, brandsTable, createRecord, fetchRecords } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { fileURLToPath } from 'url';
import { normalizeNicheString, validateNiche } from '../utils/niches.js';

const INGEST_INF_DIR = path.resolve(process.cwd(), 'data/ingest/influencers');
const INGEST_BRAND_DIR = path.resolve(process.cwd(), 'data/ingest/brands');

// Niche validation now handled via src/utils/niches.js

function isValidEmail(email) {
    if (!email) return false;
    const lower = email.toLowerCase();
    if (lower.includes('mock_') || lower.includes('test@') || lower.includes('example.com')) return false;
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

export async function runIngestSprint() {
    await ingestType(INGEST_INF_DIR, influencersTable, 'INFLUENCER_DISCOVERED', true);
    await ingestType(INGEST_BRAND_DIR, brandsTable, 'BRAND_COLD', false);
}

async function ingestType(ingestDir, table, initialStatus, isInfluencer) {
    if (!fs.existsSync(ingestDir)) {
        fs.mkdirSync(ingestDir, { recursive: true });
        console.log(`Created ingest directory: ${ingestDir}`);
        return;
    }

    const files = fs.readdirSync(ingestDir).filter(f => f.endsWith('.csv'));
    
    if (files.length === 0) {
        console.log(`No CSV files found in ${ingestDir}.`);
        return;
    }

    // Load existing emails to prevent duplicates
    const existingRecords = await fetchRecords(table);
    const existingEmails = new Set(existingRecords.map(r => r.email || r.contact_email).filter(e => e));

    for (const file of files) {
        console.log(`\n[Sprint] Processing CSV: ${file}`);
        const filePath = path.join(ingestDir, file);
        const results = [];

        await new Promise((resolve, reject) => {
            fs.createReadStream(filePath)
                .pipe(csv())
                .on('data', (data) => results.push(data))
                .on('end', resolve)
                .on('error', reject);
        });

        let addedCount = 0;
        let skipCount = 0;

        for (const row of results) {
            let email = row.Email || row.email || row.business_email || row.contact_email || row.Contact || '';
            
            // Explicitly prefer business_email if available (it often contains the real deal email)
            if (row.business_email && isValidEmail(row.business_email)) {
                email = row.business_email;
            } else if (row.contact_email && isValidEmail(row.contact_email)) {
                email = row.contact_email;
            }
            
            if (!isValidEmail(email)) {
                logError(Tiers.MEDIUM, 'ingest_sprint', `Skipped record with missing/invalid email: ${email || 'UNKNOWN'}`);
                skipCount++;
                continue;
            }

            if (existingEmails.has(email)) {
                skipCount++;
                continue;
            }

            const rawNiche = row.Niche || row.niche || row.Category || '';
            
            if (!rawNiche) {
                const logMsg = `[${new Date().toISOString()}] Rejected: empty_niche_field | Raw: "" | Source: ${email}\n`;
                const logsDir = path.resolve(process.cwd(), 'data/logs');
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                fs.appendFileSync(path.join(logsDir, 'ingest_rejections.log'), logMsg);
                
                logError(Tiers.MEDIUM, 'ingest_sprint', `Skipped record with empty niche: ${email}`);
                skipCount++;
                continue;
            }

            const normalizedNiche = normalizeNicheString(rawNiche);
            const validation = validateNiche(normalizedNiche);

            if (!validation.valid) {
                const logMsg = `[${new Date().toISOString()}] Rejected: ${validation.reason} | Raw: "${rawNiche}" | Source: ${email}\n`;
                const logsDir = path.resolve(process.cwd(), 'data/logs');
                if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
                fs.appendFileSync(path.join(logsDir, 'ingest_rejections.log'), logMsg);
                
                logError(Tiers.MEDIUM, 'ingest_sprint', `Skipped record due to invalid niche: ${rawNiche}`, { email });
                skipCount++;
                continue;
            }

            const strictNicheId = validation.niche;

            const name = row.Name || row.name || row.Username || row.handle || row.company_name || row.brand_name || 'Unknown';
            const url = row.URL || row.url || row.Link || row.Profile || row.website || '';
            const platform = row.Platform || row.platform || row.Network || 'Unknown';

            const parseNum = (val) => {
                if (!val) return 0;
                let str = val.toString().toUpperCase().replace(/,/g, '');
                if (str.endsWith('M')) return parseFloat(str) * 1000000;
                if (str.endsWith('K')) return parseFloat(str) * 1000;
                return parseInt(str) || 0;
            };

            const subCount = parseNum(row.Followers || row.followers || row.Subscribers || 0);
            const engagement = parseNum(row.Engagement || row.engagement || row.AvgViews || 0);

            const newRecord = isInfluencer ? {
                name: `${name} (${platform})`,
                channel_url: url || `https://${platform}.com/${name}`,
                email: email,
                niche: strictNicheId,
                subscriber_count: subCount,
                avg_views: engagement,
                status: initialStatus
            } : {
                name: name,
                contact_email: email,
                niche: strictNicheId,
                status: initialStatus
            };

            try {
                const created = await createRecord(table, newRecord);
                existingEmails.add(email);
                logActivity('ingest_sprint', created.id, 'CSV_INGEST', 'NONE', initialStatus);
                addedCount++;
            } catch (e) {
                logError(Tiers.HIGH, 'ingest_sprint', `Failed to insert record: ${email}`, { error: e.message });
            }
        }

        console.log(`✅ Finished ${file}: Added ${addedCount} usable leads. Skipped ${skipCount} (invalid/duplicates).`);
        
        const archiveDir = path.join(ingestDir, 'archive');
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
        fs.renameSync(filePath, path.join(archiveDir, file));
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runIngestSprint().then(() => console.log('\nSprint ingestion complete.'));
}
