import { influencersTable, fetchRecords } from '../src/utils/airtable.js';

async function run() {
    const records = await fetchRecords(influencersTable);
    console.log(`Total Influencers: ${records.length}`);
    const stats = {};

    for (const rec of records) {
        const status = rec.status || 'UNKNOWN';
        if (!stats[status]) {
            stats[status] = { count: 0, oldest: null, newest: null, records: [] };
        }
        stats[status].count++;
        
        // Use 'last_activity' or 'created_at' if available
        const timeVal = rec.created_at || rec.last_activity; 
        if (timeVal) {
            const time = new Date(timeVal).getTime();
            if (!stats[status].oldest || time < stats[status].oldest) stats[status].oldest = time;
            if (!stats[status].newest || time > stats[status].newest) stats[status].newest = time;
        }
        stats[status].records.push(rec);
    }
    
    for (const [status, data] of Object.entries(stats)) {
        console.log(`\nStatus: ${status}`);
        console.log(`  Count: ${data.count}`);
        console.log(`  Oldest: ${data.oldest ? new Date(data.oldest).toISOString() : 'N/A'}`);
        console.log(`  Newest: ${data.newest ? new Date(data.newest).toISOString() : 'N/A'}`);
        
        console.log(`  Sample records:`);
        const samples = data.records.slice(0, 3);
        samples.forEach(s => {
            console.log(`    ID: ${s.id}, Email: ${s.email || 'N/A'}, Created: ${s.created_at || 'N/A'}, Last Activity: ${s.last_activity || 'N/A'}, Activity Log: ${(s.activity_log || '').substring(0, 50)}...`);
        });
    }

    if (records.length > 0) {
      console.log('\nSample Field Keys:', Object.keys(records[0]));
    }
}
run();
