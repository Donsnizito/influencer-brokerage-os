# Brand Scout Skill
## Overview
Discovers brands from CSV exports (Shopify Collabs, Meta Ad Library scrapers, etc) to feed the demand side of the brokerage.

## Execution Flow
1. Read all CSV files dropped into `data/ingest/brands/`.
2. Parse CSV columns (Name, Email, Niche, Budget, etc).
3. Map disparate column headers to standard formats.
4. Check Airtable `Brands` table for duplicate emails.
5. Push new unique records to Airtable.
   - `status` = 'BRAND_COLD'
6. Move processed CSV files to `data/ingest/brands/archive/`.

## Data Source Rule
- ALL live data must be read/written ONLY via Airtable API.
- Local CSVs are strictly for bulk ingestion.

## Logging Requirements
- Log every action to `logs/activity_log.jsonl` with fields: `timestamp`, `skill_name`, `brand_id`, `action`, `previous_state`, `new_state`.
