# Negotiation Handler Skill
## Overview
Parses inbound email replies, classifies negotiation signals using `negotiation_policy.json`, auto-responds within GREEN policy, drafts YELLOW items, and escalates RED items.

## Execution Flow
1. Poll NeoMail IMAP inbox for unread messages (or via webhook if configured).
2. For each message:
   - Identify corresponding deal record in Airtable (match by email thread/address).
   - Parse email text using LLM to extract: `rate`, `deliverables`, `timeline`, `exclusivity_mentions`, `revision_mentions`, `legal_mentions`.
3. Load `config/negotiation_policy.json` and `config/pricing.json`.
4. Classify the negotiation state into one of 3 execution modes. System MUST default to HUMAN_APPROVAL_REQUIRED if unsure:
   - **HARD_STOP** (never auto-send, immediately escalate):
     - Exclusivity terms
     - Usage rights / licensing
     - Legal clauses
     - Payment structure changes
     - Contract modifications
   - **HUMAN_APPROVAL_REQUIRED** (draft response, wait for owner):
     - ANY mention of price, discount, or fees
     - Deliverable changes
     - Timeline changes
     - Negotiation counters
     - Default classification if unsure
   - **AUTO_SEND_ALLOWED** (auto-send immediately):
     - Non-financial messages only
     - Greetings, clarifications, scheduling
5. Action based on classification:
   - **HARD_STOP**: 
     - Set Airtable Deal `escalation_flag` = 'RED'.
     - DO NOT RESPOND.
     - Add to owner's dashboard Escalation Queue.
   - **HUMAN_APPROVAL_REQUIRED**:
     - Set Airtable Deal `escalation_flag` = 'YELLOW'.
     - Draft response using `email_templates/negotiation_counter_templates.txt`.
     - DO NOT RESPOND. Save draft to Airtable for owner approval.
   - **AUTO_SEND_ALLOWED**:
     - Draft and SEND response.
     - Update Airtable Deal notes/details if applicable.
6. Log full email exchange to `negotiation_history` field in Airtable Deal record (append to JSON array).
7. If both parties agree (no pending items, rates within target), update Deal `status` = 'DEAL_LOCKED'.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data. No local file tracking.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id`, `action`, `previous_state`, `new_state`.
