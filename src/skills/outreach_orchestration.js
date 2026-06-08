// src/skills/outreach_orchestration.js
//
// Production outreach orchestration — batch generation surface.
//
// Operator triggers a sweep for a brand. This module orchestrates:
//   matchCreatorsForBrand → scoreMatches → (for each top-N floor-passer) generateOutreachDraft → persist to OutreachDrafts
//
// Persists drafts to OutreachDrafts table with status=pending_review.
// Operator reviews/edits/sends via Brief 15 dashboard (and Brief 12's send route).
//
// **No cross-module import discipline:** this module does NOT import outreach_send.js.
// The two modules communicate only through the OutreachDrafts table. Generation writes;
// send reads. The table is the integration contract.
//
// Brief 12 owns this file. Brief 15 (dashboard rebuild) consumes its public API via
// the POST /api/outreach/batch route.

import { matchCreatorsForBrand } from './matching_engine.js';
import { scoreMatches } from './scoring_engine.js';
import { generateOutreachDraft } from './outreach_engine.js';
import { brandsTable, outreachDraftsTable, fetchRecords } from '../utils/airtable.js';

// ── Logging helpers ───────────────────────────────────────────────────────────
// Codebase uses console.* directly (no dedicated logger.info/error/warn pattern
// per logger.js inspection). Matches the prevailing pattern across all existing
// skills and utils.
const log = {
    info:  (msg) => console.log(`[INFO]  ${msg}`),
    warn:  (msg) => console.warn(`[WARN]  ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run a full outreach batch for a brand.
 *
 * Orchestrates: match → score → (for each top-N floor-passer) generate draft → persist to OutreachDrafts.
 *
 * @param {string} brandId - Airtable record ID for the Brand.
 * @param {Object} [options]
 * @param {number} [options.topN=20] - Override Brief 11's default topN cap.
 * @param {boolean} [options.ignoreEmptyDeliveryEvidence=false] - Pass-through to matchCreatorsForBrand.
 *        Test-only; production paths must NOT set this.
 *
 * @returns {Promise<{
 *   brandId: string,
 *   draftsCreated: Array<{ draftId: string, creatorId: string, creatorName: string, fitAssessment: string }>,
 *   matchResult: { totalMatches: number, totalRejected: number, matchingFlags: string[] },
 *   scoringResult: { floorPassed: number, floorRejected: number, scoringFlags: string[] },
 *   errors: Array<{ creatorId: string, stage: string, message: string }>,
 *   batchStartedAt: string,
 *   batchCompletedAt: string,
 *   batchDurationMs: number
 * }>}
 *
 * Throws on:
 *   - Brand record not found.
 *   - Catastrophic Airtable failure during the orchestration setup (brand fetch).
 *
 * Does NOT throw on:
 *   - Per-creator generation failures (LLM timeout, draft generation error). Errors are
 *     accumulated in the `errors` array and the batch continues for remaining creators.
 *   - Per-creator persistence failures (Airtable rate limit, transient write failure).
 *     Error logged; creator skipped; batch continues.
 *   - Empty match set (all creators filtered out at matching). Returns with empty
 *     draftsCreated array and detailed matchResult.
 *   - All matches falling below curation floor. Returns with empty draftsCreated array
 *     and detailed scoringResult.
 */
export async function runOutreachBatchForBrand(brandId, options = {}) {
    const batchStartedAt = new Date();
    const errors = [];

    // 1. Fetch the brand record (required for scoring's Layer 2 + draft generation)
    const brandRecords = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
    if (brandRecords.length === 0) {
        throw new Error(`runOutreachBatchForBrand: brand record not found for brandId=${brandId}`);
    }
    const brand = brandRecords[0];

    log.info(`[outreach_orchestration] batch started for brandId=${brandId} (${brand.company_name ?? 'unnamed'})`);

    // 2. Match
    // Pass-through contract: ignoreEmptyDeliveryEvidence defaults to false; only
    // === true activates the Stage 4 override (matching_engine.js guards strictly).
    const matchResult = await matchCreatorsForBrand(brandId, null, {
        ignoreEmptyDeliveryEvidence: options.ignoreEmptyDeliveryEvidence === true
    });
    log.info(`[outreach_orchestration] matches: ${matchResult.matches.length}; rejected: ${matchResult.rejected.length}`);

    // 3. Score
    const scoringResult = scoreMatches(matchResult, brand, { topN: options.topN ?? 20 });
    log.info(`[outreach_orchestration] floor passed: ${scoringResult.scoringMetadata.floorPassed}; topN returned: ${scoringResult.scoredMatches.length}`);

    // 4. For each scored match, generate draft and persist to OutreachDrafts
    const draftsCreated = [];
    for (const scoredCreator of scoringResult.scoredMatches) {
        const creator = scoredCreator.creator;
        try {
            // Generate draft via Brief 9b
            const draftResult = await generateOutreachDraft(brandId, creator.id);

            // Persist to OutreachDrafts
            // Brand and creator linked record fields expect an array of record IDs
            // per Airtable SDK convention for Link-to-Record fields.
            const created = await outreachDraftsTable.create([{
                fields: {
                    brand_id: [brandId],
                    creator_id: [creator.id],
                    status: 'pending_review',
                    subject: draftResult.draft.subject,
                    body: draftResult.draft.body,
                    fit_assessment: draftResult.draft.fit_assessment,
                    fit_rationale: draftResult.draft.fit_rationale,
                    proposed_rate_band: draftResult.draft.proposed_rate_band ?? '',
                    evidence_used: JSON.stringify(draftResult.draft.evidence_used ?? []),
                    search_queries: JSON.stringify(draftResult.draft.search_queries ?? []),
                    flags: JSON.stringify(draftResult.draft.flags ?? []),
                    scoring_metadata: JSON.stringify({
                        finalScore: scoredCreator.finalScore,
                        layer1Score: scoredCreator.layer1Score,
                        layer2Multiplier: scoredCreator.layer2Multiplier,
                        scoreBreakdown: scoredCreator.scoreBreakdown
                    }),
                    // Edit-tracking snapshots — set once at creation, never modified.
                    // Brief 19+ learning loop reads these to extract operator-edit patterns.
                    original_subject: draftResult.draft.subject,
                    original_body: draftResult.draft.body,
                    original_proposed_rate_band: draftResult.draft.proposed_rate_band ?? ''
                }
            }]);

            const draftId = created[0].id;
            draftsCreated.push({
                draftId,
                creatorId: creator.id,
                creatorName: creator.name ?? '(unnamed)',
                fitAssessment: draftResult.draft.fit_assessment
            });
            log.info(`[outreach_orchestration] draft persisted: ${draftId} for creator=${creator.name ?? creator.id}`);

        } catch (err) {
            // Classify the error stage for the accumulation record.
            // Heuristic: generateOutreachDraft errors mention the function name;
            // Airtable SDK errors come from outreachDraftsTable.create.
            let stage;
            if (err.message?.includes('generateOutreachDraft') || err.message?.includes('outreach_engine')) {
                stage = 'generation';
            } else if (err.message?.includes('Airtable') || err.message?.includes('NOT_FOUND') || err.message?.includes('INVALID_FIELD')) {
                stage = 'persistence';
            } else {
                stage = 'unknown';
            }

            log.error(`[outreach_orchestration] failed for creator=${creator.id}: stage=${stage}, error=${err.message}`);
            errors.push({
                creatorId: creator.id,
                stage,
                message: err.message
            });
            // Continue with remaining creators — per-creator errors do NOT halt the batch.
        }
    }

    const batchCompletedAt = new Date();
    const batchDurationMs = batchCompletedAt - batchStartedAt;

    log.info(`[outreach_orchestration] batch completed: ${draftsCreated.length} drafts created, ${errors.length} errors, ${batchDurationMs}ms`);

    return {
        brandId,
        draftsCreated,
        matchResult: {
            totalMatches: matchResult.matches.length,
            totalRejected: matchResult.rejected.length,
            matchingFlags: matchResult.flags
        },
        scoringResult: {
            floorPassed: scoringResult.scoringMetadata.floorPassed,
            floorRejected: scoringResult.scoringMetadata.floorRejected,
            scoringFlags: scoringResult.flags
        },
        errors,
        batchStartedAt: batchStartedAt.toISOString(),
        batchCompletedAt: batchCompletedAt.toISOString(),
        batchDurationMs
    };
}
