import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import { brandsTable, createRecord, fetchRecords } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { fileURLToPath } from 'url';

const INGEST_DIR = path.resolve(process.cwd(), 'data/ingest/brands');

export async function ingestBrandCsvs() {
    if (!fs.existsSync(INGEST_DIR)) {
        console.log(`Ingest directory not found: ${INGEST_DIR}`);
        return;
    }

    const files = fs.readdirSync(INGEST_DIR).filter(f => f.endsWith('.csv'));
    
    if (files.length === 0) {
        console.log(`No CSV files found in ${INGEST_DIR}. Drop Shopify Collabs/Ad Library exports here.`);
        return;
    }

    // Load existing emails to prevent duplicates
    const existingRecords = await fetchRecords(brandsTable);
    const existingEmails = new Set(existingRecords.map(r => r.contact_email).filter(e => e));

    for (const file of files) {
        console.log(`\nProcessing Brand CSV: ${file}`);
        const filePath = path.join(INGEST_DIR, file);
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
            const email = row.Email || row.email || row.Contact || row.contact_email || '';
            if (!email || existingEmails.has(email)) {
                skipCount++;
                continue;
            }

            const companyName = row.Company || row.company || row.Name || row.name || 'Unknown Brand';
            const contactName = row.ContactName || row.contact_name || row.Person || 'Marketing Team';
            const niche = row.Niche || row.niche || row.Category || 'Unknown';

            const newRecord = {
                company_name: companyName,
                contact_name: contactName,
                contact_email: email,
                niche: niche,
                status: 'BRAND_COLD'
            };

            try {
                const created = await createRecord(brandsTable, newRecord);
                existingEmails.add(email);
                logActivity('brand_scout', created.id, 'BRAND_INGESTED', 'NONE', 'BRAND_COLD');
                addedCount++;
            } catch (e) {
                console.error(`Failed to insert ${companyName}:`, e.message);
            }
        }

        console.log(`✅ Finished ${file}: Added ${addedCount} brand leads. Skipped ${skipCount} (duplicates/missing emails).`);
        
        // Move processed file
        const archiveDir = path.join(INGEST_DIR, 'archive');
        if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir);
        fs.renameSync(filePath, path.join(archiveDir, file));
    }
}

// Entrypoint
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    ingestBrandCsvs().then(() => console.log('\nBrand scout run complete.'));
}
