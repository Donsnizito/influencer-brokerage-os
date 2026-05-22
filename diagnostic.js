import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { influencersTable, brandsTable, fetchRecords } from './src/utils/airtable.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runAudit() {
    try {
        // 1. Niches
        const nichesPath = path.resolve(__dirname, 'config', 'niches.json');
        const nichesData = JSON.parse(fs.readFileSync(nichesPath, 'utf8'));
        const distinctNiches = nichesData.niches.map(n => n.id);
        
        // 2. Fetch all data
        const influencers = await fetchRecords(influencersTable);
        const brands = await fetchRecords(brandsTable);
        
        // Influencer stats
        const infStatusCounts = {};
        const infNicheCounts = {};
        const infQuoteReceivedNicheCounts = {};
        
        for (const inf of influencers) {
            const status = inf.status || 'UNKNOWN';
            const niche = inf.niche || 'UNKNOWN';
            
            infStatusCounts[status] = (infStatusCounts[status] || 0) + 1;
            infNicheCounts[niche] = (infNicheCounts[niche] || 0) + 1;
            
            if (status === 'QUOTE_RECEIVED') {
                infQuoteReceivedNicheCounts[niche] = (infQuoteReceivedNicheCounts[niche] || 0) + 1;
            }
        }
        
        // Brand stats
        const brandStatusCounts = {};
        const brandNicheCounts = {};
        const brandNegotiatingNicheCounts = {};
        
        for (const brand of brands) {
            const status = brand.status || 'UNKNOWN';
            const niche = brand.niche || 'UNKNOWN';
            
            brandStatusCounts[status] = (brandStatusCounts[status] || 0) + 1;
            brandNicheCounts[niche] = (brandNicheCounts[niche] || 0) + 1;
            
            // "NEGOTIATING or later" ... let's assume NEGOTIATING is the primary one mentioned, or check all statuses
            // The prompt says "Specifically: count of brands at status = NEGOTIATING or later (brands eligible to receive a roster) grouped by niche"
            // Let's include NEGOTIATING, CONTRACT_SENT, DEAL_LOCKED, CONTRACT_SIGNED etc if they exist. Let's just check NEGOTIATING for now, but also capture others.
            if (status === 'NEGOTIATING' || status === 'INTERESTED') {
                brandNegotiatingNicheCounts[niche] = (brandNegotiatingNicheCounts[niche] || 0) + 1;
            }
        }
        
        // Feasibility Cross-tab & Empty roster check
        const crossTab = [];
        const rosterSizes = { '0': 0, '1': 0, '2': 0, '3+': 0 };
        
        for (const [niche, count] of Object.entries(brandNegotiatingNicheCounts)) {
            const infCount = infQuoteReceivedNicheCounts[niche] || 0;
            crossTab.push({ niche, brandCount: count, infCount });
            
            // For each brand in this niche, they would see `infCount` influencers.
            // Empty roster check is PER BRAND. So if there are 5 brands in a niche with 2 influencers, that's 5 brands seeing a roster of 2.
            let bucket = infCount >= 3 ? '3+' : String(infCount);
            rosterSizes[bucket] += count;
        }
        
        crossTab.sort((a, b) => a.infCount - b.infCount);
        
        console.log(JSON.stringify({
            niches: distinctNiches,
            infTotal: influencers.length,
            infStatusCounts,
            infNicheCounts,
            infQuoteReceivedNicheCounts,
            brandTotal: brands.length,
            brandStatusCounts,
            brandNicheCounts,
            brandNegotiatingNicheCounts,
            crossTab,
            rosterSizes
        }, null, 2));
        
    } catch (error) {
        console.error("Error running audit:", error);
    }
}

runAudit();
