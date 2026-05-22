import fs from 'fs';
import path from 'path';
import { influencersTable, brandsTable, fetchRecords, updateRecord, deleteRecord } from '../src/utils/airtable.js';
import { normalizeNicheString, validateNiche } from '../src/utils/niches.js';

const LOG_FILE = path.resolve(process.cwd(), 'data/logs/migration_2026_05_22.log');

function logAction(msg) {
    console.log(msg);
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
}

async function migrateTable(tableName, tableLabel) {
    logAction(`\n--- Starting migration for ${tableLabel} ---`);
    const records = await fetchRecords(tableName);
    
    let updatedCount = 0;
    let deletedCount = 0;
    let skippedCount = 0;
    let collisionCount = 0;

    // Track combinations of email + normalized niche
    const seenMap = new Map();
    for (const record of records) {
        const email = record.email || record.contact_email;
        if (!email) continue;
        
        const normalized = normalizeNicheString(record.niche || '');
        const validation = validateNiche(normalized);
        
        if (validation.valid) {
            const key = `${email}:${normalized}`;
            if (!seenMap.has(key)) {
                // If it's already normalized, mark it as seen
                if (record.niche === normalized) {
                    seenMap.set(key, record.id);
                }
            }
        }
    }

    for (const record of records) {
        const email = record.email || record.contact_email || 'UNKNOWN';
        const rawNiche = record.niche || '';
        const normalized = normalizeNicheString(rawNiche);
        const validation = validateNiche(normalized);

        if (!validation.valid) {
            logAction(`DELETED: Record ${record.id} (${email}) with invalid niche '${rawNiche}'`);
            await deleteRecord(tableName, record.id);
            deletedCount++;
        } else if (normalized !== rawNiche) {
            const key = `${email}:${normalized}`;
            if (seenMap.has(key) && seenMap.get(key) !== record.id) {
                // Collision
                logAction(`COLLISION SKIPPED: Record ${record.id} (${email}). '${rawNiche}' normalizes to '${normalized}', but a record with this niche and email already exists.`);
                collisionCount++;
            } else {
                logAction(`UPDATED: Record ${record.id} (${email}) niche from '${rawNiche}' to '${normalized}'`);
                try {
                    await updateRecord(tableName, record.id, { niche: normalized });
                    seenMap.set(key, record.id);
                    updatedCount++;
                } catch (err) {
                    logAction(`ERROR updating record ${record.id}: ${err.message}`);
                }
            }
        } else {
            skippedCount++;
        }
    }

    logAction(`Completed ${tableLabel}: ${updatedCount} updated, ${deletedCount} deleted, ${skippedCount} skipped, ${collisionCount} collisions.`);
}

async function run() {
    const logsDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }

    logAction("Starting Niche Normalization Migration...");
    await migrateTable(influencersTable, 'Influencers');
    await migrateTable(brandsTable, 'Brands');
    logAction("Migration finished.");
}

run();
