# Payment Handler Skill
## Overview
Creates Stripe invoices for brands, retains broker fee, and queues influencer payouts for manual release via Stripe Connect.

## Execution Flow
1. Fetch Airtable records from `Deals` where `status` = 'CONTRACT_SIGNED'.
2. For each deal:
   - Calculate fees: `broker_fee` and `influencer_payout` based on `agreed_rate` (using `config/pricing.json` math).
   - Update Airtable record with calculated `broker_fee` and `influencer_payout` if not already set.
   - **Create Stripe Customer** (if brand doesn't exist).
   - **Create Stripe Invoice**:
     - Call Stripe API `POST /v1/invoices`.
     - Add Invoice Item `POST /v1/invoiceitems` for the `agreed_rate` with description "Influencer Marketing Campaign — {deliverables}".
     - Finalize and send the invoice to the brand's email (`POST /v1/invoices/{id}/send`).
   - Save `stripe_invoice_id` to Airtable Deal record.
3. Update Deal `status` = 'INVOICE_SENT' (Implied intermediate step, wait for webhook).

## Webhook Handler: Invoice Paid
- Listen for Stripe `invoice.paid` event.
- Find Deal in Airtable via `stripe_invoice_id`.
- Update Deal `status` = 'PAYMENT_COLLECTED'.
- `payment_collected_date` = Current Timestamp.
- The deal now sits in the Dashboard's "Payment Queue" waiting for owner approval.

## Manual Action: Release Payout (Dashboard Triggered)
- MUST be triggered manually from Web Dashboard via `release_payout(deal_id)`.
- AUTOMATIC PAYOUT EXECUTION IS STRICTLY PROHIBITED. No exceptions.
- Initiates Stripe Transfer via Connect to Influencer account for the `influencer_payout` amount.
- Updates Deal `status` = 'PAYMENT_RELEASED'.
- `payment_released_date` = Current Timestamp.
- Update Deal `status` = 'CAMPAIGN_LIVE'.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `deal_id`, `action`, `previous_state`, `new_state`.
