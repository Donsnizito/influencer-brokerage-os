# Follow-Up Engine Skill
## Overview
Daily scheduled job that checks all CRM records for stale deal stages and sends follow-up emails.

## Execution Flow
1. Run as a daily Cron job.
2. Load configuration from `config/negotiation_policy.json` (specifically `stale_deal_escalation_days`).
3. **Influencer Follow-Ups:**
   - Fetch `Influencers` where `status` IN ('QUOTE_REQUESTED', 'QUOTE_RECEIVED').
   - Calculate days since `last_contacted`.
   - If days >= 4 and `follow_up_count` == 0:
     - Send `influencer_followup_day4.txt` via SMTP (credentials from environment variables).
     - Update `last_contacted`, set `follow_up_count` = 1.
   - If days >= 10 and `follow_up_count` == 1:
     - Send `influencer_followup_day10.txt` via SMTP (credentials from environment variables).
     - Update `last_contacted`, set `follow_up_count` = 2.
   - If `follow_up_count` >= 2 and days >= 14 (total):
     - Update `status` = 'COLD'.
4. **Brand Follow-Ups:**
   - Fetch `Brands` where `status` IN ('BRAND_PITCHED').
   - Calculate days since `last_contacted`.
   - If days >= 4 and `follow_up_count` == 0:
     - Send `brand_followup_day4.txt` via SMTP (credentials from environment variables).
     - Update `last_contacted`, set `follow_up_count` = 1.
   - If `follow_up_count` >= 1 and days >= 10:
     - Update `status` = 'BRAND_COLD'.
5. **Negotiation Stagnation:**
   - Fetch `Deals` where `status` = 'NEGOTIATING' or 'CONTRACT_SENT'.
   - Calculate days since last state change (or `last_contacted` on the parent Brand/Influencer records).
   - If days > `stale_deal_escalation_days`:
     - Flag Deal with `escalation_flag` = 'YELLOW'.
     - Add note: "Stalled in Negotiation/Contract for >5 days. Needs manual nudge."

## System Limits (Anti-Spam Protection)
- `max_daily_outreach = 70` (shared limit across initial outreach and follow-ups)
- `max_followups_per_contact = 5`
- `cooldown_after_reply = 24 hours`
- Prevent duplicate sends within 72 hours per contact.
- System must STOP sending immediately if limits are exceeded.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id` (or influencer_id/brand_id), `action`, `previous_state`, `new_state`.
