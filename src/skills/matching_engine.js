// src/skills/matching_engine.js
//
// Matching engine — deterministic five-stage filter that produces the curated
// Creator set for a given Brand.
//
// This is the H1 layer of the §2.2 trust stack's curation-as-underwriting
// contract. When this engine returns a Creator in `matches`, the brokerage is
// implicitly committing to underwrite that Creator against the guarantee
// (Decision A). The filter makes that commitment economically survivable.
//
// Five-stage filter (applied per Creator, short-circuit on first failure):
//   Stage 1 — Roster eligibility (governance)  — missing-key guard included
//   Stage 2 — Niche match (category)           — missing-key guard included
//   Stage 3 — Rate range parse + band overlap  — missing-key guard included
//   Stage 4 — Delivery reliability evidence non-empty (trust, override-eligible)
//
// Per §0.3 doctrine: the Airtable JS SDK omits unwritten Long Text fields from
// wire payloads entirely — the field key is absent even when the column exists
// in the schema. delivery_reliability_evidence is a Long Text field that is
// written post-roster-injection (Brief 18), not at record creation. It is a
// populate-when-known field, not a creation-required field. Missing key and
// empty value are semantically identical here and both fail Stage 4 (or pass
// under the Stage 4 test-only override). The unified Stage 0 "creator_record_
// malformed" block has been removed to reflect this distinction correctly.
//
// Brief 10-supplement (2026-06-04): per-stage missing-field guards (option ii).
// Brief 11 ranks; Brief 12 wires into production.
//
// Public API: matchCreatorsForBrand(brandId, roster = null, options = {})
// No other exports from this file.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { brandsTable, influencersTable, fetchRecords } from '../utils/airtable.js';

// ── Module-level path resolution ──────────────────────────────────────────────
// Absolute path anchored to this file's location, not process.cwd(), so the
// taxonomy resolves correctly regardless of where Node is launched from.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const NICHES_PATH = resolve(__dirname, '..', '..', 'config', 'niches.json');

// ── Niche taxonomy loader ─────────────────────────────────────────────────────

/**
 * Load and parse config/niches.json at module init.
 * Throws loud if the file is missing or unparseable — fail fast before any
 * matching call. Brief 10 doesn't enforce internal schema on the taxonomy
 * beyond JSON parseability (Stage 2 uses strict string equality, not taxonomy
 * walk). Brief 11 will use the taxonomy for scoring and may layer on schema
 * validation at that time.
 *
 * @returns {Object} Parsed niche taxonomy
 * @throws {Error} If the file is missing or malformed
 */
function loadNicheTaxonomy() {
    let raw;
    try {
        raw = readFileSync(NICHES_PATH, 'utf8');
    } catch (err) {
        throw new Error(`matching_engine: niches.json not found at ${NICHES_PATH}: ${err.message}`);
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new Error(`matching_engine: niches.json failed to parse: ${err.message}`);
    }
    // Brief 10 doesn't enforce schema on the file beyond JSON parseability —
    // exact niche string matching at Stage 2 means we only need the file
    // to exist and parse. Future schema validation (Brief 11 scoring, etc.)
    // can layer on. Stage 0 check just confirms loadability.
    return parsed;
}

// Load once at module init. Throws here if malformed — fail fast before any
// matching call reaches the route layer.
const NICHE_TAXONOMY = loadNicheTaxonomy(); // eslint-disable-line no-unused-vars
// Note: NICHE_TAXONOMY is loaded but not actively consumed by Brief 10's filter
// logic (Stage 2 uses strict string equality, not taxonomy walk). The load is
// the verification: if the file is missing or broken, module init fails before
// any matching call is made. Brief 11 will consume this for scoring.

// ── Rate range parser ─────────────────────────────────────────────────────────

/**
 * Parse a rate_range string into a numeric interval.
 *
 * Canonical format: $LOW-$HIGH (e.g., "$5K-$15K", "$5000-$15000")
 * K suffix (case-insensitive) multiplies the number by 1000.
 *
 * Returns a three-outcome result:
 *   - Strict pass: matches /^\$(\d+)(K)?-\$(\d+)(K)?$/  → loose: false
 *   - Loose pass:  matches the defensive fallback regex    → loose: true
 *   - Invalid:     neither regex matches                  → parsed: false
 *
 * Edge case: low > high after parsing (e.g., "$15K-$5K") is parse-valid.
 * The band overlap test at Stage 3b will naturally fail it, keeping reason
 * vocabulary stable (no separate 'rate_range_inverted' reason).
 *
 * Internal-only. NOT exported. If Brief 13 (negotiation) needs rate parsing,
 * that brief decides whether to import (re-export), copy, or extract.
 *
 * @param {string} rateString - The raw rate_range field value
 * @returns {{ parsed: boolean, low: number|null, high: number|null, loose: boolean }}
 */
function parseRateRange(rateString) {
    if (typeof rateString !== 'string') {
        return { parsed: false, low: null, high: null, loose: false };
    }

    // ── Strict match ─────────────────────────────────────────────────────────
    // Accepts: $5K-$15K, $5000-$15000, $5K-$15000, $5000-$15K
    // Does NOT accept: spaces, missing dollar signs, alternative dashes
    const strictMatch = rateString.match(/^\$(\d+)(K)?-\$(\d+)(K)?$/);
    if (strictMatch) {
        const low  = parseInt(strictMatch[1], 10) * (strictMatch[2] ? 1000 : 1);
        const high = parseInt(strictMatch[3], 10) * (strictMatch[4] ? 1000 : 1);
        return { parsed: true, low, high, loose: false };
    }

    // ── Loose match (defensive fallback) ─────────────────────────────────────
    // Accepts everything strict does, plus:
    //   - missing dollar signs (5000-15000)
    //   - spaces around the dash ($5K - $15K)
    //   - en-dash (–) or em-dash (—) as separator
    //   - lowercase k ($5k-$15k)
    //   - leading/trailing whitespace
    const looseMatch = rateString.match(/^\s*\$?(\d+)\s*([Kk])?\s*[-–—]\s*\$?(\d+)\s*([Kk])?\s*$/);
    if (looseMatch) {
        const low  = parseInt(looseMatch[1], 10) * (looseMatch[2] ? 1000 : 1);
        const high = parseInt(looseMatch[3], 10) * (looseMatch[4] ? 1000 : 1);
        return { parsed: true, low, high, loose: true };
    }

    // ── No match ─────────────────────────────────────────────────────────────
    return { parsed: false, low: null, high: null, loose: false };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Match creators to a brand by applying the four-filter underwriting rules.
 * Pure transformation over inputs — no side effects beyond logging.
 *
 * Filter stages (applied in order; first failure short-circuits later stages):
 *   Stage 1: Roster eligibility — missing-key guard + creator.roster_eligibility === 'active'
 *   Stage 2: Niche match        — missing-key guard + creator.niche === brand.niche (strict)
 *   Stage 3: Rate range         — missing-key guard + parse success + overlap with $5K–$15K band
 *   Stage 4: Delivery evidence  — non-empty string (override-eligible; absent key treated as empty)
 *
 * Per §0.3 doctrine: Airtable SDK omits unwritten Long Text fields from wire
 * payloads. delivery_reliability_evidence is populate-when-known — absent key
 * and empty value are semantically identical and both fail Stage 4 (or pass
 * under the test-only override). Per-stage missing-key guards (option ii)
 * replace the original unified Stage 0 block.
 *
 * @param {string} brandId - Airtable record ID for the Brand. Required.
 * @param {Array<Object>|null} [roster=null] - Pre-fetched Influencer records.
 *        If null, the function fetches via fetchRecords(influencersTable).
 *        If provided, trusted as-is (caller owns fetch correctness — pass-through
 *        contract).
 * @param {Object} [options]
 * @param {boolean} [options.ignoreEmptyDeliveryEvidence=false] - Test-only
 *        override. When strictly === true, allows creators with empty or absent
 *        delivery_reliability_evidence to pass Stage 4. Logs at WARN per
 *        creator. MUST NOT be set in production code paths. Default false.
 *
 * @returns {Promise<{
 *   matches: Array<Object>,
 *   rejected: Array<{ creatorId: string, creatorName: string, reason: string }>,
 *   flags: Array<string>
 * }>}
 *
 * Throws ONLY on:
 *   - Brand record not found.
 *   - Niche taxonomy file (config/niches.json) malformed at module init.
 *   - Catastrophic Airtable failure during the roster fetch.
 *
 * Does NOT throw on:
 *   - Empty matches (returns matches: [], flags: ['no_matches']).
 *   - Missing required fields per creator (per-stage rejection, continue).
 *   - Invalid rate_range strings (reject with 'rate_range_invalid', continue).
 */
export async function matchCreatorsForBrand(brandId, roster = null, options = { ignoreEmptyDeliveryEvidence: false }) {
    // ── Brand record fetch ────────────────────────────────────────────────────
    const brandRecords = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
    if (brandRecords.length === 0) {
        throw new Error(`matching_engine: brand record not found for brandId=${brandId}`);
    }
    const brand = brandRecords[0];

    // ── Roster fetch (conditional) ────────────────────────────────────────────
    // If the caller provides a roster, trust it as-is (pass-through contract).
    // If null, fetch the full influencer table — fresh every call, no caching.
    // Brief 12 can decide to cache at its own orchestration level.
    let creatorRoster = roster;
    if (creatorRoster === null) {
        creatorRoster = await fetchRecords(influencersTable);
    }

    // ── Call-level aggregation accumulators ───────────────────────────────────
    const matches  = [];
    const rejected = [];
    let looseParsedCount        = 0;
    let overrideFiredOnThisCall = false;

    // ── Per-creator filter loop ───────────────────────────────────────────────
    // Single pass; short-circuit on first stage failure per creator.
    // Matches are in roster-order — Brief 11 will rank.
    for (const creator of creatorRoster) {
        // Derive display name for rejection records and override logs.
        // Missing name is NOT a rejection — name is not an underwriting field.
        const creatorName = creator.name ?? creator.id ?? '(unnamed)';

        // ── Stage 1: Roster eligibility ───────────────────────────────────────
        // Missing-key guard first (§0.3 doctrine: absence and empty value
        // are semantically distinct failure modes, but both gate at the
        // purpose-appropriate stage). Then strict string equality against
        // 'active'. The override does NOT apply; governance cannot be bridged.
        if (!('roster_eligibility' in creator)) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'roster_eligibility_missing'
            });
            continue;
        }
        if (creator.roster_eligibility !== 'active') {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'roster_eligibility_not_active'
            });
            continue;
        }

        // ── Stage 2: Niche match ──────────────────────────────────────────────
        // Missing-key guard first. Then strict string equality — exact leaf
        // match only, no taxonomy walk. A brand with niche 'pets' does NOT
        // match a creator with niche 'pets_dogs'. The override does NOT apply.
        if (!('niche' in creator)) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'niche_missing'
            });
            continue;
        }
        if (creator.niche !== brand.niche) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'niche_mismatch'
            });
            continue;
        }

        // ── Stage 3: Rate range parse + band overlap ──────────────────────────

        // Stage 3a: Parse
        // Missing-key guard first — rate_range is a creation-required field
        // (Single Line Text; SDK always includes it when written). If absent,
        // reject with 'rate_range_missing'. Then three parse outcomes: strict
        // pass (no flag), loose pass (increment counter), invalid (reject with
        // 'rate_range_invalid'). Override does not apply.
        if (!('rate_range' in creator)) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'rate_range_missing'
            });
            continue;
        }
        const parseResult = parseRateRange(creator.rate_range);
        if (!parseResult.parsed) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'rate_range_invalid'
            });
            continue;
        }
        if (parseResult.loose) {
            looseParsedCount++;
        }

        // Stage 3b: Band overlap
        // Test whether [low, high] has any non-empty intersection with the
        // brokerage's deal-range band [5000, 15000]. The overlap condition is:
        //   low <= bandHigh && high >= bandLow
        // i.e., the creator's range doesn't end entirely below $5K or start
        // entirely above $15K. Override does not apply.
        const BAND_LOW  = 5000;
        const BAND_HIGH = 15000;
        if (!(parseResult.low <= BAND_HIGH && parseResult.high >= BAND_LOW)) {
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'rate_range_outside_band'
            });
            continue;
        }

        // ── Stage 4: Delivery reliability evidence non-empty ──────────────────
        // Per §0.3 doctrine: delivery_reliability_evidence is a Long Text field
        // that may be absent from the wire payload entirely (Airtable SDK omits
        // unwritten Long Text keys). Absent key, null, empty string, and
        // whitespace-only string are semantically identical here — all fail Stage 4.
        // This is the override-eligible stage. The field is read defensively:
        //   record.delivery_reliability_evidence ?? ''
        // rather than via 'in' check, treating absent-key and empty-value as one.
        //
        // This is the override-eligible stage. The override exists as a bridge
        // mechanism for the build sequence: delivery_reliability_evidence was
        // added in Brief 7b but the roster injection (Brief 18) hasn't run yet,
        // so the live roster may not have the field populated when downstream
        // briefs exercise matching for the first time. It is NOT a feature.
        // Coerce: absent key → undefined → '' via ??, then check for non-empty trimmed string.
        const evidenceValue = creator.delivery_reliability_evidence ?? '';
        const hasEvidence = (
            typeof evidenceValue === 'string' &&
            evidenceValue.trim().length > 0
        );

        if (!hasEvidence) {
            // Strict equality check on the override — only the literal boolean
            // `true` activates it. Truthy non-true values (1, 'yes', {value:true},
            // etc.) do NOT activate the override. This is intentional defense
            // against accidental activation.
            if (options?.ignoreEmptyDeliveryEvidence === true) {
                // Emit a structured WARN per affected creator so log-review can
                // surface all override-activated matches. The bracketed prefix
                // [matching_engine OVERRIDE] is the grep target.
                // Note: evidenceValue may be '' because the key was absent on
                // the wire (§0.3 Airtable SDK omission) OR because the field
                // was explicitly written as empty — both cases log identically.
                console.warn(
                    `[matching_engine OVERRIDE] ignoreEmptyDeliveryEvidence=true used for brandId=${brandId}, ` +
                    `included creatorId=${creator.id} (${creatorName}) despite empty delivery_reliability_evidence`,
                    {
                        brandId,
                        creatorId:   creator.id,
                        creatorName,
                        override:    'ignoreEmptyDeliveryEvidence',
                        callerStack: new Error().stack.split('\n').slice(2, 5).join('\n')
                    }
                );
                overrideFiredOnThisCall = true;
                matches.push(creator);
                continue;
            }

            // Override not set — normal rejection.
            rejected.push({
                creatorId:   creator.id,
                creatorName,
                reason: 'delivery_reliability_evidence_missing'
            });
            continue;
        }

        // ── All five stages passed — add to matches ───────────────────────────
        matches.push(creator);
    }

    // ── Aggregate call-level flags ────────────────────────────────────────────
    // Flags are call-level (not per-creator). Aggregated here after the filter
    // loop completes. The per-creator diagnostics live in the rejected array.
    const flags = [];

    if (matches.length === 0) {
        flags.push('no_matches');
    }
    if (overrideFiredOnThisCall) {
        // Single occurrence regardless of how many creators triggered the override
        // on this call. The per-creator detail is in the WARN logs.
        flags.push('override_used_ignore_empty_delivery_evidence');
    }
    if (looseParsedCount > 0) {
        // Surfaces operator action: tighten rate_range field discipline for the
        // N creators that needed loose-regex parsing. These are data-quality
        // issues that should be backfilled in Airtable.
        flags.push(`rate_range_parsed_loose_count_${looseParsedCount}`);
    }

    return { matches, rejected, flags };
}
