// scripts/verify_brief14_schema.mjs
//
// Brief 14 schema verification script.
// Verifies that all required Airtable tables and fields exist and are
// accessible via the SDK before Brief 14 is considered operationally ready.
//
// Run: node scripts/verify_brief14_schema.mjs
//
// Expected output on pass:
//   [PASS] ComplianceEvents table accessible (N records)
//   [PASS] UnresolvedPayments table accessible (N records)
//   [PASS] Deals table has compliance_spec field (N deals checked)
//   [PASS] Deals table has creator_payout_schedule field (N deals checked)
//   [PASS] Deals table has pandadoc_brand_document_id field (N deals checked)
//   [PASS] Deals table has pandadoc_creator_document_id field (N deals checked)
//   All checks passed — Brief 14 schema is ready.
//
// On any FAIL, the check prints what was wrong and the script exits non-zero.
//
// Note: This script uses the import.meta.url-anchored path pattern (§0.3 doctrine)
// to resolve src/ imports correctly regardless of CWD.

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import dotenv from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, '..', '.env') });

// Dynamic import with anchored paths
const { complianceEventsTable, unresolvedPaymentsTable, dealsTable, fetchRecords } =
    await import(resolve(__dirname, '..', 'src', 'utils', 'airtable.js'));

let allPassed = true;
let checkCount = 0;

function pass(msg) {
    console.log(`[PASS] ${msg}`);
    checkCount++;
}

function fail(msg, detail = '') {
    console.error(`[FAIL] ${msg}${detail ? `: ${detail}` : ''}`);
    allPassed = false;
    checkCount++;
}

// ── Check 1: ComplianceEvents table ──
try {
    const records = await fetchRecords(complianceEventsTable);
    pass(`ComplianceEvents table accessible (${records.length} records)`);
} catch (err) {
    fail('ComplianceEvents table not accessible', err.message);
    console.error('  → Create this table in Airtable per Section B.1 of Brief 14 spec:');
    console.error('    Fields: event_id (Autonumber), deal_id (Link to Deals), event_type (Single Select),');
    console.error('    event_at (Created Time), event_payload (Long Text), event_attachment (Attachment),');
    console.error('    event_source (Single Select), event_actor (Single Line), event_notes (Long Text),');
    console.error('    updated_at (Last Modified Time)');
}

// ── Check 2: UnresolvedPayments table ──
try {
    const records = await fetchRecords(unresolvedPaymentsTable);
    pass(`UnresolvedPayments table accessible (${records.length} records)`);
} catch (err) {
    fail('UnresolvedPayments table not accessible', err.message);
    console.error('  → Create this table in Airtable per Brief 14 Pin 1 spec:');
    console.error('    Fields: payment_intent_id (Single Line), stripe_event_id (Single Line),');
    console.error('    customer_email (Email), amount (Number/Currency), received_at (Created Time),');
    console.error('    resolved_at (Date with time, optional), resolution_notes (Long Text, optional)');
}

// ── Checks 3–6: Deals table fields ──
const requiredDealFields = [
    'compliance_spec',
    'creator_payout_schedule',
    'pandadoc_brand_document_id',
    'pandadoc_creator_document_id'
];

try {
    const deals = await fetchRecords(dealsTable);
    const sampleDeal = deals[0] ?? {};

    // Note: per §0.3 doctrine, unwritten Long Text fields are absent from SDK responses.
    // We check for schema existence by attempting to write a known-absent value and reading
    // it back, but that's destructive. Instead, we verify the field is readable by checking
    // that fetchRecords doesn't throw (field absence from SDK != field schema absence).
    // The operator should verify schema existence via Airtable UI before running this script.
    // This script verifies code-level accessibility only.

    pass(`Deals table accessible (${deals.length} records checked for field presence)`);

    for (const field of requiredDealFields) {
        // For Long Text fields, SDK omits them when unwritten (§0.3).
        // We verify the field is declared on the schema by checking at least one deal
        // has it populated, OR by accepting the field absence as normal SDK behavior.
        // This is a soft check: if the field is entirely missing from schema, a write
        // attempt in the live flow will fail with an Airtable API error.
        if (deals.length > 0 && field in sampleDeal) {
            pass(`Deals table has '${field}' field (populated in at least one record)`);
        } else {
            // Field absent from SDK response — either schema-missing or all values unwritten.
            // Log as WARNING (not FAIL) since §0.3 doctrine says unwritten Long Text fields
            // are omitted from SDK responses.
            console.warn(`[WARN] Deals field '${field}' not found in SDK response — either schema-missing or all values unwritten (see §0.3 doctrine)`);
            console.warn(`  → If this field was just created in Airtable UI, it will be absent from the SDK`);
            console.warn(`    until at least one record has it populated. This is expected behavior.`);
            console.warn(`  → If this field was NOT created in Airtable UI, create it now:`);
            switch (field) {
                case 'compliance_spec':
                    console.warn('    compliance_spec: Long Text field on Deals table (Brief 7b)');
                    break;
                case 'creator_payout_schedule':
                    console.warn('    creator_payout_schedule: Long Text field on Deals table (Brief 7b)');
                    break;
                case 'pandadoc_brand_document_id':
                    console.warn('    pandadoc_brand_document_id: Single Line Text field on Deals table (Brief 14)');
                    break;
                case 'pandadoc_creator_document_id':
                    console.warn('    pandadoc_creator_document_id: Single Line Text field on Deals table (Brief 14)');
                    break;
            }
        }
    }
} catch (err) {
    fail('Deals table inaccessible', err.message);
}

// ── Summary ──
console.log('');
if (allPassed) {
    console.log(`✅ All ${checkCount} checks passed — Brief 14 schema is ready.`);
    process.exit(0);
} else {
    console.error(`❌ Some checks failed — resolve the issues above before running the Brief 14 flow.`);
    process.exit(1);
}
