import { brandsTable, fetchRecords, updateRecord } from '../src/utils/airtable.js';

async function run() {
    console.log("Fetching brands...");
    const records = await fetchRecords(brandsTable);
    
    let updatedCount = 0;
    
    for (const record of records) {
        const name = record.name;
        const companyName = record.company_name;

        if (name && !companyName) {
            try {
                await updateRecord(brandsTable, record.id, { company_name: name });
                console.log(`Updated record ${record.id}: Copied name '${name}' to company_name.`);
                updatedCount++;
            } catch (err) {
                if (err.error === 'UNKNOWN_FIELD_NAME') {
                    console.log(`[ACTION REQUIRED] Airtable missing column 'company_name'. Please create it in the Brands table.`);
                    break;
                } else {
                    console.error(`Error updating record ${record.id}:`, err);
                }
            }
        } else if (name && companyName && name !== companyName) {
            console.log(`Conflict on record ${record.id}: name is '${name}', company_name is '${companyName}'. Keeping company_name.`);
        }
    }

    console.log(`Finished updating ${updatedCount} records.`);
}

run().catch(console.error);
