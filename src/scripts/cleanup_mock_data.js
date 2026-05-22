import { influencersTable, brandsTable, dealsTable, fetchRecords, deleteRecord } from '../utils/airtable.js';

async function runCleanup() {
    console.log("Starting cleanup of mock records...");

    let deletedCount = 0;

    // 1. Clean up Influencers
    const influencers = await fetchRecords(influencersTable);
    for (const inf of influencers) {
        if ((inf.email && inf.email.includes('mock_')) || (inf.name && inf.name.includes('mock_'))) {
            await deleteRecord(influencersTable, inf.id);
            console.log(`Deleted mock influencer: ${inf.email || inf.name}`);
            deletedCount++;
        }
    }

    // 2. Clean up Brands
    const brands = await fetchRecords(brandsTable);
    for (const brand of brands) {
        if ((brand.contact_email && brand.contact_email.includes('mock_')) || (brand.company_name && brand.company_name.includes('mock_'))) {
            await deleteRecord(brandsTable, brand.id);
            console.log(`Deleted mock brand: ${brand.contact_email || brand.company_name}`);
            deletedCount++;
        }
    }

    // 3. Clean up Deals
    const deals = await fetchRecords(dealsTable);
    for (const deal of deals) {
        if ((deal.influencer_email && deal.influencer_email.includes('mock_')) || (deal.brand_email && deal.brand_email.includes('mock_'))) {
            await deleteRecord(dealsTable, deal.id);
            console.log(`Deleted mock deal involving mock email.`);
            deletedCount++;
        }
    }

    console.log(`Cleanup complete! Deleted ${deletedCount} mock records.`);
}

runCleanup().catch(console.error);
