import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { influencersTable, createRecord, fetchRecords } from '../utils/airtable.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { logActivity } from '../utils/logger.js';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const X_BEARER_TOKEN = process.env.X_BEARER_TOKEN;
const MAX_QUERIES = 20;

const nichesData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'config', 'niches.json'), 'utf8'));

// High confidence email extractor
function extractEmail(text) {
    if (!text) return null;
    const re = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/;
    const match = text.match(re);
    if (!match) return null;
    const email = match[1];
    
    // Validate against mock/fake
    const lower = email.toLowerCase();
    if (lower.includes('mock_') || lower.includes('test@') || lower.includes('example.com')) return null;
    return email;
}

export async function runMicroDaemon() {
    if (!X_BEARER_TOKEN) {
        logError(Tiers.CRITICAL, 'micro_daemon', "X_BEARER_TOKEN missing. Halting daemon.");
        return;
    }

    console.log("Starting X/Twitter Micro Daemon Enrichment...");

    // Pick a random niche to explore to ensure diverse signal testing
    const randomNiche = nichesData.niches[Math.floor(Math.random() * nichesData.niches.length)];
    const queryTerm = randomNiche.keywords[Math.floor(Math.random() * randomNiche.keywords.length)];

    console.log(`Exploring Niche: ${randomNiche.label} | Keyword: "${queryTerm}"`);

    // We search for tweets containing the keyword and 'email' or '@' to increase likelihood of finding contact info
    const query = `"${queryTerm}" (email OR contact OR business) -is:retweet`;

    try {
        const response = await axios.get('https://api.twitter.com/2/tweets/search/recent', {
            headers: {
                'Authorization': `Bearer ${X_BEARER_TOKEN}`
            },
            params: {
                query: query,
                max_results: 20, // Strict batch limit
                expansions: 'author_id',
                'user.fields': 'description,public_metrics,url'
            }
        });

        if (!response.data.data) {
            logError(Tiers.MEDIUM, 'micro_daemon', "No results found for query.", { query });
            return;
        }

        const users = response.data.includes.users || [];
        
        // Fetch existing emails to deduplicate
        const existingRecords = await fetchRecords(influencersTable);
        const existingEmails = new Set(existingRecords.map(r => r.email).filter(e => e));

        let addedCount = 0;

        for (const user of users) {
            const email = extractEmail(user.description);
            if (!email) {
                // Must have high confidence email
                continue;
            }

            if (existingEmails.has(email)) {
                // Duplicate
                continue;
            }

            const followers = user.public_metrics?.followers_count || 0;
            // Basic threshold to ensure quality
            if (followers < 1000) {
                continue;
            }

            const newRecord = {
                name: `${user.name} (X)`,
                channel_url: `https://x.com/${user.username}`,
                email: email,
                niche: randomNiche.id, // We map it directly to the strict niche
                subscriber_count: followers,
                avg_views: 0, // X API doesn't give global avg views easily, leave 0
                status: 'INFLUENCER_DISCOVERED',
                source: `X/Twitter Daemon`
            };

            const created = await createRecord(influencersTable, newRecord);
            existingEmails.add(email);
            logActivity('micro_daemon', created.id, 'X_DISCOVERY', 'NONE', 'INFLUENCER_DISCOVERED');
            addedCount++;
        }

        console.log(`Micro Daemon complete. Added ${addedCount} high-confidence leads from X.`);

    } catch (error) {
        logError(Tiers.HIGH, 'micro_daemon', `X API Error: ${error.message}`, { error: error.response?.data || error.message });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runMicroDaemon().then(() => console.log('Daemon run complete.'));
}
