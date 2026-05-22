# Contract Generator Skill
## Overview
Populates pre-approved legal templates and sends them via PandaDoc API to both parties.

## Execution Flow
1. Fetch Airtable records from `Deals` where `status` = 'DEAL_LOCKED'.
2. For each deal:
   - Calculate broker fee based on `agreed_rate` and `config/pricing.json`.
   - Prepare variables object:
     - `brand_company_name`, `brand_contact_name`, `brand_contact_email`
     - `influencer_name`, `influencer_channel_url`, `influencer_email`
     - `agreed_rate`, `deliverables_description`, `post_deadline`
     - `exclusivity_clause`, `usage_rights`, `revision_limit`
     - `broker_name`, `broker_fee`, `contract_date` (Current Date)
   - Read PandaDoc Template IDs from environment variables (`process.env.PANDADOC_BRAND_TEMPLATE_ID`, `process.env.PANDADOC_INFLUENCER_TEMPLATE_ID`).
   - **Send Brand Agreement**:
     - Call PandaDoc API `POST /documents` with `brand_agreement` template ID and variables.
     - Call `POST /documents/{id}/send`.
   - **Send Influencer Agreement**:
     - Call PandaDoc API `POST /documents` with `influencer_agreement` template ID and variables.
     - Call `POST /documents/{id}/send`.
   - Save PandaDoc Document IDs to Airtable Deal record `pandadoc_doc_id` (comma separated if two docs).
3. Update Airtable Deal `status` = 'CONTRACT_SENT'.
   - `contract_sent_date` = Current Timestamp.

## Webhook Handler (Separate Process/Endpoint)
- Listen for PandaDoc `document_state_changed` event.
- If status is `document.completed`:
  - Find Deal in Airtable via Document ID.
  - Check if both documents (if applicable) are completed.
  - Update Deal `status` = 'CONTRACT_SIGNED'.
  - `contract_signed_date` = Current Timestamp.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for initial seed data. No local file tracking.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id`, `action`, `previous_state`, `new_state`.
