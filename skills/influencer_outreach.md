# Influencer Outreach Skill
## Overview
Sends personalized rate-request emails to discovered influencers via NeoMail SMTP.

## Execution Flow
1. Fetch Airtable records from `Influencers` where:
   - `status` = 'INFLUENCER_DISCOVERED'
   - `email` IS NOT NULL AND `email` != 'MANUAL_NEEDED'
2. For each record:
   - Read `email_templates/influencer_outreach_email1.txt`.
   - Populate template variables:
     - `{first_name}`: Extract from `name` (split by space, take first).
     - `{niche_reference}`: Use `label` from `config/niches.json` based on influencer's `niche`.
     - `{personal_touch}`: AI generated 1-liner based on channel URL/content, or generic fallback "your recent videos have been great".
     - `{owner_name}`, `{agency_name}`: From environment variables (`process.env.OWNER_NAME`, `process.env.AGENCY_NAME`).
   - Connect to NeoMail SMTP or SendGrid (credentials from environment variables).
   - Send Email.
3. Update Airtable record:
   - `status` = 'QUOTE_REQUESTED'
   - `last_contacted` = Current Timestamp
   - `follow_up_count` = 0

## System Limits (Anti-Spam Protection)
- `max_daily_outreach = 70`
- `max_followups_per_contact = 5`
- `cooldown_after_reply = 24 hours`
- Prevent duplicate sends within 72 hours per contact.
- System must STOP sending immediately if limits are exceeded.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id` (or influencer_id), `action`, `previous_state`, `new_state`.
