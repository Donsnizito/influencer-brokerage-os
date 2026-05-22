import fs from 'fs';
import path from 'path';
import { influencersTable, fetchRecords, deleteRecord } from '../src/utils/airtable.js';

async function run() {
    console.log("Fetching influencers...");
    const records = await fetchRecords(influencersTable);
    
    let deletedCount = 0;
    const logsDir = path.resolve(process.cwd(), 'data/logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    const logFile = path.join(logsDir, 'cleanup_2026_05_22.log');

    for (const record of records) {
        const email = record.email ? record.email.trim().toLowerCase() : '';
        if (!email || email === 'manual_needed') {
            await deleteRecord(influencersTable, record.id);
            deletedCount++;
            const logMsg = `Deleted record ${record.id} with email "${record.email}"\n`;
            fs.appendFileSync(logFile, logMsg);
            console.log(logMsg.trim());
        }
    }

    console.log(`Finished deleting ${deletedCount} records.`);
    fs.appendFileSync(logFile, `Total deleted: ${deletedCount}\n`);
}

run().catch(console.error);
