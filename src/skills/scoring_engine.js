// src/skills/scoring_engine.js
//
// Scoring engine — deterministic hybrid scorer that takes Brief 10's matchResult
// and ranks the matched creators for a given Brand.
//
// Two-layer design:
//   Layer 1 — Curation floor. Brand-agnostic curation quality from placement_history
//              completions/breaches/recency + delivery_reliability_evidence content+recency.
//              Normalized 0-100 against the eligible roster. Floor at CURATION_FLOOR (50):
//              creators below are excluded with reason 'curation_floor'.
//
//   Layer 2 — Brand-fit multiplier. Among floor-passers, brand-specific signals
//              determine sort order: audience-scale bucket fit, target-budget rate-band
//              overlap, platform match. All three Brand fields are optional per §0.3
//              doctrine — brands without them fall back to pure Layer 1 ordering (1.0
//              neutral multiplier).
//
// finalScore = layer1Score × layer2Multiplier.
// Curation is the underwriting gate; brand-fit is the sort.
//
// Per §0.3 doctrine: Airtable SDK omits unwritten Long Text fields from wire payloads.
// All reads of placement_history, delivery_reliability_evidence, and brand optional
// fields use defensive ?? coercion.
//
// Public API: scoreMatches(matchResult, brand, options) → { scoredMatches, rejected, flags, scoringMetadata }
// No other exports from this file.
//
// Brief 12 wires this into the production outreach orchestration.

// ─────────────────────────────────────────────────────────────────────────────
// Tuning constants — operator tunes from observation; Brief 15 dashboard
// may surface a tuning panel later. All constants are tunable WITHOUT
// touching formula logic.
// ─────────────────────────────────────────────────────────────────────────────

// Layer 1 — Curation formula weights (raw score multipliers)
const COMPLETION_WEIGHT = 10;       // per placement_history completion entry
const DELIVERY_EVIDENCE_WEIGHT = 5; // multiplier on delivery_evidence_score (0-3)
const RECENCY_BONUS_WEIGHT = 3;     // per completion in trailing 12 months
const BREACH_PENALTY = 25;          // per breach (any breach type)

// Layer 1 — delivery_evidence_score tier thresholds
const EVIDENCE_RICH_THRESHOLD_CHARS = 200;    // length to qualify for tier 2+
const EVIDENCE_RECENT_THRESHOLD_DAYS = 90;    // recency to qualify for tier 3

// Layer 1 — Curation floor (records below excluded)
const CURATION_FLOOR = 50;

// Layer 2 — Brand-fit multiplier component weights (sum to 1.0)
const AUDIENCE_SCALE_WEIGHT = 0.4;
const BUDGET_OVERLAP_WEIGHT = 0.4;
const PLATFORM_MATCH_WEIGHT = 0.2;

// Layer 2 — Multiplier range
const LAYER2_MIN_MULTIPLIER = 0.6;    // bad brand-fit floor (still surfaces if curation is strong)
const LAYER2_MAX_MULTIPLIER = 1.4;    // good brand-fit ceiling (rewards alignment)
// (Mid is 1.0 = neutral. Brand with no Layer 2 fields populated gets exactly 1.0.)

// Brokerage deal-range band (for target_budget validation)
const DEAL_BAND_LOW = 5000;
const DEAL_BAND_HIGH = 15000;

// Default cap on returned scoredMatches
const DEFAULT_TOP_N = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — NOT exported
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a rate_range string into a numeric interval.
 * Duplicated from matching_engine.js (intentional per Brief 11 spec — keeps
 * scoring_engine.js self-contained without touching matching_engine.js).
 *
 * @param {string} rateString
 * @returns {{ parsed: boolean, low: number|null, high: number|null, loose: boolean }}
 */
function parseCreatorRateRange(rateString) {
    if (typeof rateString !== 'string') {
        return { parsed: false, low: null, high: null, loose: false };
    }

    // Strict match: $5K-$15K, $5000-$15000, $5K-$15000, $5000-$15K
    const strictMatch = rateString.match(/^\$(\d+)(K)?-\$(\d+)(K)?$/);
    if (strictMatch) {
        const low  = parseInt(strictMatch[1], 10) * (strictMatch[2] ? 1000 : 1);
        const high = parseInt(strictMatch[3], 10) * (strictMatch[4] ? 1000 : 1);
        return { parsed: true, low, high, loose: false };
    }

    // Loose match: missing dollar signs, spaces around dash, en/em-dash, lowercase k
    const looseMatch = rateString.match(/^\s*\$?(\d+)\s*([Kk])?\s*[-–—]\s*\$?(\d+)\s*([Kk])?\s*$/);
    if (looseMatch) {
        const low  = parseInt(looseMatch[1], 10) * (looseMatch[2] ? 1000 : 1);
        const high = parseInt(looseMatch[3], 10) * (looseMatch[4] ? 1000 : 1);
        return { parsed: true, low, high, loose: true };
    }

    return { parsed: false, low: null, high: null, loose: false };
}

/**
 * Map a subscriber count to an audience-scale bucket.
 * Boundaries are inclusive-low, exclusive-high per Brief 7c spec.
 *
 * @param {number} subscriberCount
 * @returns {'micro'|'mid'|'macro'|'mega'}
 */
function getSubscriberBucket(subscriberCount) {
    if (subscriberCount < 100_000) return 'micro';
    if (subscriberCount < 500_000) return 'mid';
    if (subscriberCount < 1_000_000) return 'macro';
    return 'mega';
}

/**
 * Infer a creator's platform from their channel_url via substring heuristics.
 * Podcast hosts vary widely and default to 'unknown'.
 *
 * @param {Object} creator
 * @returns {'youtube'|'instagram'|'tiktok'|'unknown'}
 */
function inferCreatorPlatform(creator) {
    const url = (creator.channel_url ?? '').toLowerCase();
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('tiktok.com')) return 'tiktok';
    return 'unknown'; // includes podcast hosts that vary widely
}

/**
 * Compute the raw (pre-normalization) curation score for a single creator.
 * Pure arithmetic over placement_history entries and delivery_reliability_evidence.
 *
 * @param {Object} creator - Airtable creator record
 * @returns {{
 *   rawCurationScore: number,
 *   completions: number,
 *   breaches: number,
 *   withdrawnPreDelivery: number,
 *   deliveryEvidenceScore: number,
 *   recencyBonus: number
 * }}
 */
function computeRawCurationScore(creator) {
    // ── Step 1.1 — Parse placement_history ────────────────────────────────────
    // §0.3 doctrine: Long Text field may be absent from wire payload.
    const placementHistoryRaw = creator.placement_history ?? '';
    let placementHistory = [];
    if (placementHistoryRaw.trim().length > 0) {
        try {
            placementHistory = JSON.parse(placementHistoryRaw);
            if (!Array.isArray(placementHistory)) {
                placementHistory = [];
                // Soft-flag at per-creator level: malformed JSON, but recoverable
            }
        } catch (_err) {
            placementHistory = [];
            // Soft-flag: JSON parse failed, treat as empty history
        }
    }

    // ── Step 1.2 — Count outcomes by category ─────────────────────────────────
    const completionOutcomes = ['completed_on_spec', 'completed_with_remediation'];
    const breachOutcomes = ['breach_content_removed', 'breach_quality_failure', 'breach_timeline_missed'];
    // 'withdrawn_pre_delivery' counted for metadata but does NOT affect score
    // (Brief 11 spec lock: option i neutral — tunable when data exists)

    const completions = placementHistory.filter(p => completionOutcomes.includes(p?.outcome)).length;
    const breaches = placementHistory.filter(p => breachOutcomes.includes(p?.outcome)).length;
    const withdrawnPreDelivery = placementHistory.filter(p => p?.outcome === 'withdrawn_pre_delivery').length;

    // ── Step 1.3 — Compute delivery_evidence_score (0-3) ──────────────────────
    // §0.3 doctrine: delivery_reliability_evidence is Long Text, may be absent.
    const evidenceContent = (creator.delivery_reliability_evidence ?? '').trim();
    // delivery_reliability_evidence_last_modified is a Last Modified Time field
    // (Brief 7c) — may be absent if the evidence field was never written.
    const evidenceLastModified = creator.delivery_reliability_evidence_last_modified;

    let deliveryEvidenceScore = 0;
    if (evidenceContent.length === 0) {
        deliveryEvidenceScore = 0;  // absent or empty
    } else if (evidenceContent.length <= EVIDENCE_RICH_THRESHOLD_CHARS) {
        deliveryEvidenceScore = 1;  // any content, but thin
    } else {
        deliveryEvidenceScore = 2;  // rich content (>200 chars)
        // Promote to 3 if also recent
        if (evidenceLastModified) {
            const ageDays = (Date.now() - new Date(evidenceLastModified).getTime()) / (1000 * 60 * 60 * 24);
            if (ageDays <= EVIDENCE_RECENT_THRESHOLD_DAYS) {
                deliveryEvidenceScore = 3;
            }
        }
    }

    // ── Step 1.4 — Compute recency_bonus (completions in trailing 12 months) ──
    // Entries missing completed_at are not counted toward recency (partial data
    // doesn't lose the entry's contribution to the raw completions count above).
    const twelveMonthsAgoMs = Date.now() - (365 * 24 * 60 * 60 * 1000);
    const recencyBonus = placementHistory.filter(p => {
        if (!completionOutcomes.includes(p?.outcome)) return false;
        const completedAt = p?.completed_at ? new Date(p.completed_at).getTime() : NaN;
        return Number.isFinite(completedAt) && completedAt >= twelveMonthsAgoMs;
    }).length;

    // ── Step 1.5 — Compute raw curation score ─────────────────────────────────
    // Raw scores can be negative (e.g., a creator with only breaches and no
    // completions). Normalization handles the full real-number range.
    const rawCurationScore =
        (completions * COMPLETION_WEIGHT) +
        (deliveryEvidenceScore * DELIVERY_EVIDENCE_WEIGHT) +
        (recencyBonus * RECENCY_BONUS_WEIGHT) -
        (breaches * BREACH_PENALTY);

    return { rawCurationScore, completions, breaches, withdrawnPreDelivery, deliveryEvidenceScore, recencyBonus };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score and rank the matches from Brief 10's matchCreatorsForBrand result.
 * Pure ranking function — no side effects beyond logging.
 *
 * @param {Object} matchResult - The full result from matchCreatorsForBrand.
 *        Shape: { matches: Creator[], rejected: RejectionRecord[], flags: string[] }.
 *        Required. Throws if missing or malformed.
 * @param {Object} brand - The Brand Airtable record. Required (used for Layer 2
 *        brand-fit weighting). Brands without optional fields (target_budget,
 *        preferred_audience_scale, preferred_platform) fall back to pure Layer 1
 *        ordering per §0.3 doctrine — caller is responsible for fetching.
 * @param {Object} [options]
 * @param {number} [options.topN=20] - Maximum number of scored matches to return.
 *        If fewer matches pass the curation floor, all of them are returned (no
 *        padding). Configurable for testing and future tuning.
 * @param {Object} [options.eligibleRoster=null] - The full eligible-roster slice
 *        used for 0-100 normalization. If null, defaults to matchResult.matches
 *        (i.e., normalize relative to the brand's matched roster). Brief 12 may
 *        pass the full active roster for cross-brand consistency.
 *
 * @returns {{
 *   scoredMatches: ScoredCreator[],
 *   rejected: RejectionRecord[],           // passed through unchanged
 *   flags: string[],                       // passed through unchanged, plus scoring-specific additions
 *   scoringMetadata: {
 *     brandId: string,
 *     totalMatchesIn: number,
 *     floorPassed: number,
 *     floorRejected: number,
 *     withdrawnPreDeliveryCount: number,   // informational, does not affect score
 *     layer2Active: boolean,               // true if any brand field for Layer 2 was populated
 *     normalizationBase: 'matchResult' | 'eligibleRoster',
 *     scoredAt: string                     // ISO 8601 timestamp
 *   }
 * }}
 *
 * ScoredCreator shape:
 * {
 *   creator: Creator,
 *   finalScore: number,                    // 0-100 (can exceed 100 with multiplier > 1.0), used for descending sort
 *   layer1Score: number,                   // 0-100, the curation score
 *   layer2Multiplier: number,              // 0.0-1.5 typical; 1.0 = brand-fit neutral
 *   scoreBreakdown: {
 *     completions: number,
 *     breaches: number,
 *     deliveryEvidenceScore: 0|1|2|3,
 *     recencyBonus: number,
 *     rawCurationScore: number,
 *     layer1Normalized: number,
 *     layer2Components: {
 *       audienceScaleMatch: 'match' | 'mismatch' | 'brand_field_absent',
 *       audienceScaleWeight: number,
 *       budgetOverlap: 'overlap' | 'no_overlap' | 'brand_field_absent' | 'brand_field_out_of_band',
 *       budgetWeight: number,
 *       platformMatch: 'match' | 'mismatch' | 'multi' | 'brand_field_absent',
 *       platformWeight: number
 *     }
 *   }
 * }
 *
 * Throws ONLY on:
 *   - matchResult is malformed (missing matches/rejected/flags arrays).
 *   - brand is missing (null or undefined).
 *   - Internal arithmetic error (defensive — shouldn't happen).
 *
 * Does NOT throw on:
 *   - All matches falling below the curation floor (returns scoredMatches: []).
 *   - Brand missing all three Layer 2 fields (logs once, falls back to pure Layer 1).
 *   - Creator with empty placement_history (scores low, doesn't crash).
 *   - target_budget outside the $5K-$15K band (flag raised, score continues with capped value).
 */
export function scoreMatches(matchResult, brand, options = {}) {
    // ── Input validation — throw on hard errors ───────────────────────────────
    if (!matchResult || !Array.isArray(matchResult.matches) || !Array.isArray(matchResult.rejected) || !Array.isArray(matchResult.flags)) {
        throw new Error('scoring_engine: matchResult is malformed — missing matches/rejected/flags arrays');
    }
    if (!brand) {
        throw new Error('scoring_engine: brand is required (null or undefined)');
    }

    const topN = options.topN ?? DEFAULT_TOP_N;
    const normalizationBase = options.eligibleRoster ?? matchResult.matches;
    const normalizationBaseLabel = options.eligibleRoster ? 'eligibleRoster' : 'matchResult';

    // ── Call-level accumulators ───────────────────────────────────────────────
    const scoredMatches = [];
    // rejected array starts as a copy of Brief 10's rejected (passed through unchanged)
    const rejected = [...matchResult.rejected];
    // flags array starts as a copy of Brief 10's flags (passed through unchanged)
    const flags = [...matchResult.flags];

    let floorPassed = 0;
    let floorRejected = 0;
    let withdrawnPreDeliveryCount = 0;
    let targetBudgetOutOfBandFlagged = false;

    // ── Step 1.6 — Normalize 0-100 over the normalization base ───────────────
    // Compute raw scores for ALL records in the normalization base first, then
    // map each creator in matchResult.matches onto the 0-100 scale.
    const normRawResults = normalizationBase.map(c => computeRawCurationScore(c));
    const normRawScores = normRawResults.map(r => r.rawCurationScore);

    const minRaw = normRawScores.length > 0 ? Math.min(...normRawScores) : 0;
    const maxRaw = normRawScores.length > 0 ? Math.max(...normRawScores) : 0;
    const rawRange = maxRaw - minRaw;

    // Build a lookup from creator ID → normalized score so we can find each
    // matchResult creator's normalized score in O(1).
    const normLookup = new Map();
    normalizationBase.forEach((c, i) => {
        let layer1Normalized;
        if (rawRange === 0) {
            // All raw scores equal — no curation differentiation among these records.
            // Map to 50: exactly at the floor. The floor gate then decides uniformly
            // whether all pass or all fail.
            layer1Normalized = 50;
        } else {
            layer1Normalized = ((normRawScores[i] - minRaw) / rawRange) * 100;
        }
        normLookup.set(c.id, layer1Normalized);
    });

    // ── Small-roster normalization warning ────────────────────────────────────
    if (normalizationBase.length < 10) {
        flags.push(`small_roster_normalization_warning_${normalizationBase.length}`);
    }

    // ── Brand Layer 2 field presence check ───────────────────────────────────
    const hasBrandAudienceScale = brand.preferred_audience_scale !== undefined && brand.preferred_audience_scale !== null && brand.preferred_audience_scale !== '';
    const hasBrandBudget = brand.target_budget !== undefined && brand.target_budget !== null;
    const hasBrandPlatform = brand.preferred_platform !== undefined && brand.preferred_platform !== null && brand.preferred_platform !== '';
    const layer2Active = hasBrandAudienceScale || hasBrandBudget || hasBrandPlatform;

    if (!layer2Active) {
        flags.push('layer2_inactive');
    }

    // ── Per-creator scoring loop ──────────────────────────────────────────────
    for (const creator of matchResult.matches) {
        // Compute raw components for this creator
        const { rawCurationScore, completions, breaches, withdrawnPreDelivery, deliveryEvidenceScore, recencyBonus } =
            computeRawCurationScore(creator);

        // Aggregate withdrawn count (informational — does NOT affect score)
        withdrawnPreDeliveryCount += withdrawnPreDelivery;

        // ── Layer 1: Normalized score ─────────────────────────────────────────
        // Look up normalized score from the pre-computed normalization base.
        // If this creator is not in the normalization base (e.g., Brief 12 passes
        // a custom eligibleRoster that excludes some matchResult creators), compute
        // their score against the range but clamp to [0, 100].
        let layer1Score;
        if (normLookup.has(creator.id)) {
            layer1Score = normLookup.get(creator.id);
        } else {
            // Creator not in normalization base — compute and clamp
            if (rawRange === 0) {
                layer1Score = 50;
            } else {
                layer1Score = Math.min(100, Math.max(0, ((rawCurationScore - minRaw) / rawRange) * 100));
            }
        }

        // ── Step 1.7 — Apply curation floor ──────────────────────────────────
        if (layer1Score < CURATION_FLOOR) {
            rejected.push({
                creatorId: creator.id,
                creatorName: creator.name ?? creator.id,
                reason: 'curation_floor'
            });
            floorRejected++;
            continue; // no Layer 2 computation for this creator
        }

        floorPassed++;

        // ── Layer 2: Brand-fit multiplier ─────────────────────────────────────

        // Step 2.1 — Audience-scale bucket fit
        const creatorBucket = getSubscriberBucket(creator.subscriber_count ?? 0);
        const brandPreferredScale = brand.preferred_audience_scale;

        let audienceScaleMatch, audienceScaleWeight;
        if (!brandPreferredScale) {
            audienceScaleMatch = 'brand_field_absent';
            audienceScaleWeight = 0.5;  // neutral — no signal to act on
        } else if (creatorBucket === brandPreferredScale) {
            audienceScaleMatch = 'match';
            audienceScaleWeight = 1.0;
        } else {
            audienceScaleMatch = 'mismatch';
            audienceScaleWeight = 0.0;
        }

        // Step 2.2 — target_budget rate-band overlap
        const targetBudget = brand.target_budget;

        let budgetOverlap, budgetWeight;
        if (targetBudget === undefined || targetBudget === null) {
            budgetOverlap = 'brand_field_absent';
            budgetWeight = 0.5;
        } else if (targetBudget < DEAL_BAND_LOW || targetBudget > DEAL_BAND_HIGH) {
            budgetOverlap = 'brand_field_out_of_band';
            budgetWeight = 0.5;  // treat as if absent — operator should fix the brand record
            // Flag once at call level (not once per creator)
            if (!targetBudgetOutOfBandFlagged) {
                console.warn(
                    `[scoring_engine WARN] target_budget=${targetBudget} is outside deal band ` +
                    `[$${DEAL_BAND_LOW}-$${DEAL_BAND_HIGH}] for brandId=${brand.id ?? '(unknown)'}. ` +
                    `Budget overlap signal disabled — update brand record to fix.`
                );
                flags.push('target_budget_out_of_band');
                targetBudgetOutOfBandFlagged = true;
            }
        } else {
            // Budget is in-band — check rate-band overlap against creator's rate_range
            const parsed = parseCreatorRateRange(creator.rate_range);
            if (!parsed.parsed) {
                budgetOverlap = 'no_overlap';  // unparseable rate counts as miss
                budgetWeight = 0.0;
            } else if (targetBudget >= parsed.low && targetBudget <= parsed.high) {
                budgetOverlap = 'overlap';
                budgetWeight = 1.0;
            } else {
                budgetOverlap = 'no_overlap';
                budgetWeight = 0.0;
            }
        }

        // Step 2.3 — Platform match
        const creatorPlatform = inferCreatorPlatform(creator);
        const brandPreferredPlatform = brand.preferred_platform;

        let platformMatch, platformWeight;
        if (!brandPreferredPlatform) {
            platformMatch = 'brand_field_absent';
            platformWeight = 0.5;
        } else if (brandPreferredPlatform === 'multi') {
            platformMatch = 'multi';
            platformWeight = 1.0;  // multi is platform-agnostic; full credit
        } else if (creatorPlatform === 'unknown') {
            // Can't confirm match → conservative partial credit
            // 0.3: don't brutally penalize creators on platforms we can't detect (podcasts especially)
            platformMatch = 'mismatch';
            platformWeight = 0.3;
        } else if (creatorPlatform === brandPreferredPlatform) {
            platformMatch = 'match';
            platformWeight = 1.0;
        } else {
            platformMatch = 'mismatch';
            platformWeight = 0.0;
        }

        // Step 2.4 — Combine into multiplier
        const componentScore =
            (audienceScaleWeight * AUDIENCE_SCALE_WEIGHT) +
            (budgetWeight * BUDGET_OVERLAP_WEIGHT) +
            (platformWeight * PLATFORM_MATCH_WEIGHT);
        // componentScore is in [0.0, 1.0]

        // Map to [LAYER2_MIN_MULTIPLIER, LAYER2_MAX_MULTIPLIER]
        const layer2Multiplier = LAYER2_MIN_MULTIPLIER +
            (componentScore * (LAYER2_MAX_MULTIPLIER - LAYER2_MIN_MULTIPLIER));

        // ── Final score ───────────────────────────────────────────────────────
        // finalScore can exceed 100 when multiplier > 1.0. The floor gate was
        // applied on layer1Score only — Layer 2 is sort, not filter.
        const finalScore = layer1Score * layer2Multiplier;

        scoredMatches.push({
            creator,
            finalScore,
            layer1Score,
            layer2Multiplier,
            scoreBreakdown: {
                completions,
                breaches,
                deliveryEvidenceScore,
                recencyBonus,
                rawCurationScore,
                layer1Normalized: layer1Score,
                layer2Components: {
                    audienceScaleMatch,
                    audienceScaleWeight,
                    budgetOverlap,
                    budgetWeight,
                    platformMatch,
                    platformWeight
                }
            }
        });
    }

    // ── Sort: descending by finalScore, ties by record ID ────────────────────
    scoredMatches.sort((a, b) => {
        if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
        return a.creator.id.localeCompare(b.creator.id); // deterministic tiebreak
    });

    // ── Top-N cap ─────────────────────────────────────────────────────────────
    const cap = topN;
    const capped = scoredMatches.slice(0, cap);

    // ── Post-scoring flags ────────────────────────────────────────────────────
    if (floorPassed === 0) {
        flags.push('no_floor_passers');
    }
    // Note: 'layer2_inactive' and 'small_roster_normalization_warning_N' and
    // 'target_budget_out_of_band' are pushed earlier in the flow where appropriate.

    // ── Build scoringMetadata ─────────────────────────────────────────────────
    const scoringMetadata = {
        brandId: brand.id ?? '(unknown)',
        totalMatchesIn: matchResult.matches.length,
        floorPassed,
        floorRejected,
        withdrawnPreDeliveryCount,
        layer2Active,
        normalizationBase: normalizationBaseLabel,
        scoredAt: new Date().toISOString()
    };

    // ── Production observability log (INFO, one line per call) ───────────────
    console.info(
        `[scoring_engine] brandId=${scoringMetadata.brandId} ` +
        `matchesIn=${scoringMetadata.totalMatchesIn} ` +
        `floorPassed=${scoringMetadata.floorPassed} ` +
        `floorRejected=${scoringMetadata.floorRejected} ` +
        `layer2Active=${scoringMetadata.layer2Active} ` +
        `topN=${cap} returned=${capped.length}`
    );

    return {
        scoredMatches: capped,
        rejected,
        flags,
        scoringMetadata
    };
}
