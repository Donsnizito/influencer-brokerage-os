# Influencer Scout Skill
## Overview
Discovers influencers matching owner criteria via YouTube Data API v3 and adds them to Airtable.

## Execution Flow
1. Load credentials from environment variables (`process.env.YOUTUBE_API_KEY`).
2. Determine `niche_id` (either provided via arguments or iterate through all in `config/niches.json`).
3. For the active niche, load keywords from `config/niches.json`.
4. Call YouTube Data API v3:
   - Endpoint: `GET https://www.googleapis.com/youtube/v3/search`
   - Params: `part=snippet&type=channel&q={keyword}&maxResults=50&key={API_KEY}`
5. For each returned channel:
   - Call `GET https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet&id={channel_id}&key={API_KEY}`
   - Filter based on criteria:
     - `statistics.subscriberCount` between 50,000 and 1,000,000
     - `statistics.viewCount` / `statistics.videoCount` (approximate avg views) > 50,000
   - Extract email from `snippet.description` using regex `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}`. If no email, flag `email = MANUAL_NEEDED`.
   - Score using "Dinner Table Test" (Simulated/Prompted).
6. Group results. If 5+ influencers in a niche have a combined subscriber count > 3,000,000, mark niche cluster as viable.
7. Write valid results to Airtable:
   - Table: `Influencers`
   - Status: `INFLUENCER_DISCOVERED`

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data. No local file tracking.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id` (or influencer_id), `action`, `previous_state`, `new_state`.
