# Brand Outreach Skill
## Overview
Pitches clustered creators to brands via NeoMail SMTP.

## Execution Flow
1. Fetch Airtable records from `Influencers` where `status` >= 'QUOTE_RECEIVED'.
2. Group by `niche`.
3. For each `niche`, check if there are >= 5 influencers with a combined `subscriber_count` >= 3,000,000.
4. If a cluster is valid, fetch Airtable records from `Brands` where `niche` matches and `status` = 'BRAND_COLD' (or no status).
5. For each brand:
   - Read `email_templates/brand_pitch_email1.txt`.
   - Populate template variables:
     - `{contact_name}`: From brand record.
     - `{niche}`: Niche label.
     - `{company_name}`: From brand record.
     - `{combined_followers}`: Sum of clustered influencer subscribers.
     - `{avg_engagement}`: Average of clustered influencer engagement rates.
     - `{adjacent_verticals}`: Dynamically determined based on niche (e.g., if Tech, use Productivity/Gaming).
     - `{owner_name}`, `{agency_name}`: From environment variables (`process.env.OWNER_NAME`, `process.env.AGENCY_NAME`).
   - Send Email via NeoMail SMTP or SendGrid (credentials from environment variables).
6. Update Airtable Brand record:
   - `status` = 'BRAND_PITCHED'
   - `last_contacted` = Current Timestamp
   - `follow_up_count` = 0

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data. No local file tracking.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id` (or brand_id), `action`, `previous_state`, `new_state`.
