# Campaign Tracker Skill
## Overview
Monitors YouTube view counts to verify the 100K view guarantee and triggers deal closure.

## Execution Flow
1. Run as a daily scheduled job.
2. Fetch `Deals` from Airtable where `status` = 'CAMPAIGN_LIVE'.
3. For each deal:
   - Extract `youtube_video_url` from the deal record.
   - If missing, check if `post_deadline` has passed. If yes, flag 'YELLOW' for owner follow-up to get the URL.
   - Parse `video_id` from the URL.
   - Call YouTube Data API v3:
     - `GET https://www.googleapis.com/youtube/v3/videos?part=statistics&id={video_id}&key=${process.env.YOUTUBE_API_KEY}`
   - Extract `statistics.viewCount`.
   - Update Airtable Deal record:
     - `views_last_checked` = `statistics.viewCount`
   - Check against `view_guarantee` (from `config/negotiation_policy.json` / Deal record).
     - If `viewCount` >= target (e.g., 100,000):
       - Generate simple markdown/text performance report (Total Views, Estimated Reach, Goal Met).
       - Email report to `brand_contact_email` via SMTP (credentials from environment variables).
       - Update Deal `status` = 'CAMPAIGN_COMPLETE'.
       - `campaign_complete` = TRUE.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data. No local file tracking.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id`, `action`, `previous_state`, `new_state`.
