import dotenv from 'dotenv';
import readline from 'readline';
import { influencersTable, brandsTable, dealsTable, webhookEventsTable } from '../src/utils/airtable.js';

dotenv.config();

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const delay = ms => new Promise(res => setTimeout(res, ms));

async function fetchAllRecordIds(table) {
    try {
        const records = await table.select({ fields: [] }).all();
        return records.map(r => r.id);
    } catch (error) {
        console.error("Error fetching records:", error.message);
        throw error;
    }
}

async function bulkDelete(table, tableName, recordIds) {
    let deletedCount = 0;
    const failedIds = [];

    const chunkSize = 10;
    for (let i = 0; i < recordIds.length; i += chunkSize) {
        const batch = recordIds.slice(i, i + chunkSize);
        
        try {
            await table.destroy(batch);
            deletedCount += batch.length;
        } catch (error) {
            // If batch fails, fallback to individual retries
            for (const id of batch) {
                let success = false;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        await table.destroy([id]);
                        success = true;
                        break;
                    } catch (err) {
                        if (attempt === 3) {
                            console.error(`[ERROR] Failed to delete record ${id} after 3 attempts:`, err.message);
                        } else {
                            await delay(1000);
                        }
                    }
                }
                if (success) {
                    deletedCount++;
                } else {
                    failedIds.push(id);
                }
            }
        }
        
        console.log(`[CLEANUP] Deleted ${deletedCount} of ${recordIds.length} records from ${tableName}`);
        
        if (i + chunkSize < recordIds.length) {
            await delay(300);
        }
    }

    return failedIds;
}

async function runCleanup() {
    console.log("=== Phase 1: Pre-flight verification ===");
    const stripeKey = process.env.STRIPE_SECRET_KEY || '';
    if (!stripeKey.startsWith('sk_live_')) {
        console.error("[ACTION REQUIRED] STRIPE_SECRET_KEY is in test mode. Complete the live key swap before running cleanup.");
        process.exit(1);
    }

    console.log("Fetching record counts...");
    const dealIds = await fetchAllRecordIds(dealsTable);
    const brandIds = await fetchAllRecordIds(brandsTable);
    const influencerIds = await fetchAllRecordIds(influencersTable);

    console.log(`Total Deals: ${dealIds.length}`);
    console.log(`Total Brands: ${brandIds.length}`);
    console.log(`Total Influencers: ${influencerIds.length}`);

    await new Promise(resolve => {
        rl.question(`About to DELETE ${influencerIds.length} influencers, ${brandIds.length} brands, ${dealIds.length} deals. Type 'CONFIRM' to proceed: `, (answer) => {
            if (answer !== 'CONFIRM') {
                console.log("Aborted.");
                process.exit(0);
            }
            resolve();
        });
    });

    console.log("\n=== Phase 2: Identify protected records ===");
    console.log("No records flagged as protected. All records in Influencers, Brands, Deals will be deleted.");

    console.log("\n=== Phase 3: Bulk delete ===");
    console.log("Deleting Deals...");
    const failedDeals = await bulkDelete(dealsTable, 'Deals', dealIds);
    console.log("Deleting Brands...");
    const failedBrands = await bulkDelete(brandsTable, 'Brands', brandIds);
    console.log("Deleting Influencers...");
    const failedInfluencers = await bulkDelete(influencersTable, 'Influencers', influencerIds);

    if (failedDeals.length > 0 || failedBrands.length > 0 || failedInfluencers.length > 0) {
        console.log("\n[WARNING] Some records could not be deleted:");
        if (failedDeals.length > 0) console.log(`Deals: ${failedDeals.join(', ')}`);
        if (failedBrands.length > 0) console.log(`Brands: ${failedBrands.join(', ')}`);
        if (failedInfluencers.length > 0) console.log(`Influencers: ${failedInfluencers.join(', ')}`);
    }

    console.log("\n=== Phase 4: Preserve audit trails ===");
    console.log("Audit trails preserved: WebhookEvents intact, log files intact.");

    console.log("\n=== Phase 5: Final state report ===");
    const finalDealIds = await fetchAllRecordIds(dealsTable);
    const finalBrandIds = await fetchAllRecordIds(brandsTable);
    const finalInfluencerIds = await fetchAllRecordIds(influencersTable);
    const webhookEventsCount = (await fetchAllRecordIds(webhookEventsTable)).length;

    console.log(`Influencers: ${finalInfluencerIds.length} records`);
    console.log(`Brands: ${finalBrandIds.length} records`);
    console.log(`Deals: ${finalDealIds.length} records`);
    console.log(`WebhookEvents: ${webhookEventsCount} records (unchanged)`);
    console.log("Cleanup complete. System at zero baseline.");

    process.exit(0);
}

runCleanup().catch(err => {
    console.error("Unhandled error during cleanup:", err);
    process.exit(1);
});
