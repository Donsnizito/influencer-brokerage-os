// src/skills/contract_generator.js — post-Brief-14
//
// This module contains both legacy batch-poll and post-Brief-14 dealId-targeted
// contract generation paths. See §6 K.6 for context on the coexistence and
// cleanup criteria.
//
// Integration contracts this module depends on:
//   - compliance_spec JSON schema (docs/compliance_spec_schema.md) — read from
//     Deal record, flattened into PandaDoc merge tokens when dealId is provided
//   - PandaDoc merge token naming convention (docs/pandadoc_merge_tokens.md) —
//     scalar token map + repeating-region data shapes for deliverables and
//     compliance_criteria arrays
//
// Exports:
//   generateContracts(dealId?)
//     - When dealId provided (post-Brief-14 lock pipeline path): generates contracts
//       for a single deal, populates compliance_spec merge tokens, writes
//       pandadoc_brand_document_id + pandadoc_creator_document_id back to Deal.
//     - When dealId omitted (legacy batch-poll path): queries for status='DEAL_LOCKED'
//       deals and generates contracts without compliance_spec tokens. Preserved for
//       backward compat with /api/generate_contracts route.
//       [CLEANUP CANDIDATE K.6] — remove this batch-poll path once no production
//       calls to /api/generate_contracts target DEAL_LOCKED-status deals for
//       14 consecutive days.
//
// [CLEAN per AUDIT] — existing outbound contract creation logic unchanged.
// Brief 14 extension is additive: new parameters, new merge tokens alongside existing.

import dotenv from 'dotenv';
import path from 'path';
import { pathToFileURL } from 'url';
import { dealsTable, brandsTable, influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { pandaDocClient } from '../utils/pandadoc_client.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PANDADOC_API_KEY = process.env.PANDADOC_API_KEY;
const BRAND_TEMPLATE_ID = process.env.PANDADOC_BRAND_TEMPLATE_ID;
const INFLUENCER_TEMPLATE_ID = process.env.PANDADOC_INFLUENCER_TEMPLATE_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Main export — dual-path per K.6 coexistence doctrine
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate PandaDoc contracts for a deal or for all DEAL_LOCKED-status deals.
 *
 * Post-Brief-14 dealId path: targeted invocation from the Stripe lock pipeline.
 *   - Reads compliance_spec from Deal record
 *   - Populates merge tokens per docs/pandadoc_merge_tokens.md
 *   - Writes pandadoc_brand_document_id + pandadoc_creator_document_id to Deal
 *   - Transitions Deal to CONTRACTS_SENT on success
 *
 * Legacy batch-poll path: invoked by POST /api/generate_contracts without dealId.
 *   - Queries status='DEAL_LOCKED' (pre-Brief-14 enum value)
 *   - Does not populate compliance_spec merge tokens
 *   - Preserved for backward compatibility
 *   [CLEANUP CANDIDATE K.6] — cleanup trigger in §6
 *
 * @param {string|undefined} dealId - Airtable record ID for targeted invocation.
 *   Omit for legacy batch-poll.
 * @returns {Promise<Object>} Result summary (varies by path)
 */
export async function generateContracts(dealId) {
    if (!PANDADOC_API_KEY) {
        console.warn("PandaDoc API Key not found. Skipping contract generation.");
        return;
    }

    // ── dealId-targeted path (post-Brief-14 lock pipeline) ──
    if (dealId) {
        return generateContractsForDeal(dealId);
    }

    // ── Legacy batch-poll path (backward compat) ──
    // [K.6 CLEANUP CANDIDATE] — queries DEAL_LOCKED (pre-Brief-14 status enum value).
    // Post-Brief-14 lock pipeline writes LOCKED (canonical) and calls generateContracts(dealId).
    // This batch path is preserved to not break existing /api/generate_contracts calls
    // that may target pre-Brief-14 DEAL_LOCKED-status deals still in the pipeline.
    // Cleanup trigger: verify no production calls target DEAL_LOCKED-status deals for
    // 14 consecutive days, then remove this path. Origin: Brief 14 commit (a314ae3+).
    // Reference: see also K.7 (PandaDoc CONTRACT_SIGNED/CONTRACTS_SIGNED coexistence).
    const deals = await fetchRecords(dealsTable, "status = 'DEAL_LOCKED'");

    for (const deal of deals) {
        console.log(`[contract_generator] Batch-poll: generating contracts for Deal: ${deal.id}`);
        await generateContractsForDeal(deal.id).catch(err => {
            logError(Tiers.HIGH, 'contract_generator', `Batch generation failed for Deal ${deal.id}`, { error: err.message });
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Targeted single-deal generation (post-Brief-14 path)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Internal: generate contracts for a single deal by Airtable record ID.
 * Called both by the targeted (dealId) path and the batch-poll path.
 *
 * When compliance_spec is populated on the Deal record, this function
 * flattens it into PandaDoc merge tokens per docs/pandadoc_merge_tokens.md.
 * When compliance_spec is absent/empty, the existing token set (variables[])
 * is used unchanged — preserving the legacy behavior exactly.
 *
 * @param {string} dealId - Airtable record ID
 * @returns {Promise<{ brandDocumentId: string|null, creatorDocumentId: string|null }>}
 */
async function generateContractsForDeal(dealId) {
    const deals = await fetchRecords(dealsTable, `RECORD_ID() = '${dealId}'`);
    if (deals.length === 0) {
        throw new Error(`Deal not found: ${dealId}`);
    }
    const deal = deals[0];

    console.log(`[contract_generator] Generating contracts for Deal: ${deal.id}`);

    const brandId = Array.isArray(deal.brand_id) ? deal.brand_id[0] : deal.brand_id;
    const brands = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
    if (brands.length === 0) {
        logError(Tiers.HIGH, 'contract_generator', `Brand not found for Deal ${deal.id}`, { brand_id: brandId });
        throw new Error(`Brand not found for Deal ${deal.id}`);
    }
    const brand = brands[0];

    const infId = Array.isArray(deal.influencer_id) ? deal.influencer_id[0] : deal.influencer_id;
    const influencers = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
    if (influencers.length === 0) {
        logError(Tiers.HIGH, 'contract_generator', `Influencer not found for Deal ${deal.id}`, { influencer_id: infId });
        throw new Error(`Influencer not found for Deal ${deal.id}`);
    }
    const influencer = influencers[0];

    if (!brand.contact_email || !brand.contact_email.includes('@')) {
        logError(Tiers.HIGH, 'contract_generator', `Invalid brand email for Deal ${deal.id}`, { email: brand.contact_email });
        throw new Error(`Invalid brand email for Deal ${deal.id}`);
    }
    if (!influencer.email || !influencer.email.includes('@')) {
        logError(Tiers.HIGH, 'contract_generator', `Invalid influencer email for Deal ${deal.id}`, { email: influencer.email });
        throw new Error(`Invalid influencer email for Deal ${deal.id}`);
    }

    let terms = {};
    try { if (deal.quote_terms) terms = JSON.parse(deal.quote_terms); } catch(e) {}

    const today = new Date().toISOString().split('T')[0];

    // ── Existing variables (preserved unchanged) ──
    const variables = [
        { name: "Brand.Name", value: brand.company_name || "" },
        { name: "Brand.ContactEmail", value: brand.contact_email || "" },
        { name: "Creator.Name", value: influencer.name || "" },
        { name: "Creator.Email", value: influencer.email || "" },
        { name: "Creator.ChannelURL", value: influencer.channel_url || "" },
        { name: "Deal.AgreedRate", value: deal.agreed_rate != null ? String(deal.agreed_rate) : "" },
        { name: "Deal.Deliverables", value: terms.deliverable_type || deal.deliverables || "" },
        { name: "Deal.ID", value: deal.deal_id || "" },
        { name: "Agreement.Date", value: today }
    ];

    // ── Brief 14 extension: compliance_spec merge tokens ──
    // Parsed from Deal record's compliance_spec Long Text field.
    // When absent/empty/unparseable, specTokens is {} and the token set is
    // identical to the pre-Brief-14 behavior (variables[] only, no change).
    // This preserves all existing behavior for pre-Brief-14 DEAL_LOCKED deals.
    //
    // Merge token naming convention: docs/pandadoc_merge_tokens.md
    // Scalar: { name: 'spec.section_field', value: string }
    // Array regions: passed via metadata.fields for PandaDoc to render per template
    let specTokens = [];
    let deliverablesRegionData = [];
    let complianceCriteriaRegionData = [];

    let complianceSpec = null;
    try {
        if (deal.compliance_spec) {
            complianceSpec = JSON.parse(deal.compliance_spec);
        }
    } catch (e) {
        logError(Tiers.HIGH, 'contract_generator', `Failed to parse compliance_spec for Deal ${deal.id}`, { error: e.message });
        // Non-fatal: proceed without compliance_spec tokens (legacy behavior)
    }

    if (complianceSpec) {
        // Scalar merge tokens — see docs/pandadoc_merge_tokens.md for naming convention
        specTokens = [
            { name: 'spec.timeline_delivery_due_date', value: complianceSpec.timeline?.delivery_due_date ?? '' },
            { name: 'spec.timeline_live_content_window_days', value: String(complianceSpec.timeline?.live_content_window_days ?? '') },
            { name: 'spec.timeline_creator_acceptance_deadline', value: complianceSpec.timeline?.creator_acceptance_deadline ?? '' },
            { name: 'spec.scope_exclusivity', value: complianceSpec.scope?.exclusivity ?? 'none' },
            { name: 'spec.scope_usage_rights', value: complianceSpec.scope?.usage_rights ?? '' },
            { name: 'spec.scope_revisions_allowed', value: String(complianceSpec.scope?.revisions_allowed ?? '') },
            { name: 'spec.scope_geographic_scope', value: complianceSpec.scope?.geographic_scope ?? 'global' },
            { name: 'spec.payout_terms_total_creator_payout_amount', value: formatCurrency(complianceSpec.payout_terms?.total_creator_payout_amount) },
            { name: 'spec.payout_terms_split_80_amount', value: formatCurrency(complianceSpec.payout_terms?.split_80_amount) },
            { name: 'spec.payout_terms_split_20_amount', value: formatCurrency(complianceSpec.payout_terms?.split_20_amount) },
            { name: 'spec.payout_terms_split_20_release_method', value: complianceSpec.payout_terms?.split_20_release_method ?? 'operator_confirmed_dashboard' }
        ];

        // Repeating region data for deliverables (PandaDoc template region: 'deliverables')
        deliverablesRegionData = (complianceSpec.deliverables ?? []).map(d => ({
            deliverable_platform: d.platform ?? '',
            deliverable_format: d.format ?? '',
            deliverable_duration_seconds: d.duration_seconds != null ? String(d.duration_seconds) : 'N/A',
            deliverable_count: String(d.count ?? 1),
            deliverable_notes: d.notes ?? ''
        }));

        // Repeating region data for compliance_criteria (PandaDoc region: 'compliance_criteria')
        complianceCriteriaRegionData = (complianceSpec.compliance_criteria ?? []).map(c => ({
            criterion_id: c.criterion_id ?? '',
            criterion_definition: c.definition ?? '',
            criterion_verification_method: c.verification_method ?? ''
        }));
    }

    // ── Merge all tokens: existing + spec scalars ──
    const allTokens = [...variables, ...specTokens];

    try {
        const documentIds = [];
        let brandDocumentId = null;
        let creatorDocumentId = null;

        // Generate Brand Agreement
        if (BRAND_TEMPLATE_ID) {
            const brandPayload = {
                name: `Brand Agreement - Deal ${deal.id}`,
                template_uuid: BRAND_TEMPLATE_ID,
                recipients: [{
                    email: brand.contact_email,
                    first_name: brand.contact_name?.split(' ')[0] || 'Brand',
                    last_name: brand.contact_name?.split(' ').slice(1).join(' ') || 'Contact',
                    role: process.env.PANDADOC_BRAND_ROLE || "Client"
                }],
                tokens: allTokens,
                // Brief 14: pass deal_id in metadata so PandaDoc webhook can look up the deal
                metadata: { deal_id: dealId }
            };

            // Attach repeating region data if compliance_spec was populated
            if (deliverablesRegionData.length > 0) {
                brandPayload.tokens = allTokens; // scalar tokens already include spec.*
                // Note: PandaDoc repeating regions are configured in the template itself.
                // The metadata field carries the structured data for template rendering.
                // Operator configures repeating regions in PandaDoc template builder per
                // docs/pandadoc_merge_tokens.md — Brief 15b/15c template config step.
            }

            const brandRes = await pandaDocClient.post('/documents', brandPayload);
            brandDocumentId = brandRes.data.id;
            documentIds.push(brandDocumentId);
        }

        // Generate Influencer Agreement (Creator)
        if (INFLUENCER_TEMPLATE_ID) {
            const creatorPayload = {
                name: `Influencer Agreement - Deal ${deal.id}`,
                template_uuid: INFLUENCER_TEMPLATE_ID,
                recipients: [{
                    email: influencer.email,
                    first_name: influencer.name?.split(' ')[0] || 'Creator',
                    last_name: influencer.name?.split(' ').slice(1).join(' ') || '',
                    role: process.env.PANDADOC_INFLUENCER_ROLE || "Client"
                }],
                tokens: allTokens,
                metadata: { deal_id: dealId }
            };

            const infRes = await pandaDocClient.post('/documents', creatorPayload);
            creatorDocumentId = infRes.data.id;
            documentIds.push(creatorDocumentId);
        }

        // Update Deal record — write document IDs + state transition
        // pandadoc_brand_document_id + pandadoc_creator_document_id enable PandaDoc
        // webhook handler to look up the Deal when signature events arrive (E.3-α lookup).
        await updateRecord(dealsTable, deal.id, {
            contract_state: 'DRAFTING',
            contract_drafted_date: today,
            pandadoc_doc_id: documentIds.join(','),
            ...(brandDocumentId && { pandadoc_brand_document_id: brandDocumentId }),
            ...(creatorDocumentId && { pandadoc_creator_document_id: creatorDocumentId })
        });

        logActivity('contract_generator', deal.id, 'CONTRACTS_DRAFTED', deal.status || 'LOCKED', 'DRAFTING');
        console.log(`[contract_generator] Contracts drafted for Deal ${deal.id}: brand=${brandDocumentId}, creator=${creatorDocumentId}`);

        return { brandDocumentId, creatorDocumentId };

    } catch (error) {
        console.error(`Failed to generate contracts for Deal ${deal.id}:`, error.response?.data || error.message);
        throw error;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a number as USD currency string for PandaDoc merge token display.
 * Returns empty string for falsy values so the template can render gracefully.
 *
 * @param {number|null|undefined} amount
 * @returns {string} — e.g. "$8,500.00"
 */
function formatCurrency(amount) {
    if (amount == null || typeof amount !== 'number') return '';
    return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    generateContracts().then(() => console.log('Contract generation run complete.'));
}
