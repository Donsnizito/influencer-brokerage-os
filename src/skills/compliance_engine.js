// src/skills/compliance_engine.js
//
// Pure derivation of deal state from a Deal record and its ComplianceEvents history.
// No side effects: reads inputs, returns derived state. Callers act on the output.
//
// Same architectural discipline as Brief 11 scoring_engine.js:
//   - All tuning constants at file head
//   - Pure function: deriveDealState(deal, events) → { status, payout_status, conditionsMet, evidence, flags }
//   - No Airtable writes
//   - No LLM calls
//   - Deterministic given the same inputs
//
// Consumers:
//   - payment_handler.js reads compliance_status before releasing 80%
//   - 20%-release endpoint reads it as the additional gate beyond day-30 math
//   - GET /api/deals/:dealId/compliance-status (server.js read endpoint)
//   - Brief 15 operator dashboard renders status per deal
//   - Brief 15b brand dashboard renders status per deal
//   - Brief 15c creator dashboard renders payout_status per deal
//   - Brief 15d Lara queries via GET /api/deals/:dealId/compliance-status
//   - Future Campaign Creation Interface (Mode 2 LLM) reads for contextual queries
//
// Integration contracts this module depends on:
//   - compliance_spec JSON schema (docs/compliance_spec_schema.md) — parsed from
//     Deal record's compliance_spec Long Text field
//   - ComplianceEvents table (Section B.1 of Brief 14 spec) — event_type, event_at,
//     event_payload, event_notes fields read to derive state

// ─────────────────────────────────────────────────────────────────────────────
// Tuning constants — operator tunes from observation
// ─────────────────────────────────────────────────────────────────────────────

// Compliance status values (ordered by severity for priority selection)
const COMPLIANCE_STATUS_SEVERITY = [
    'flag_spec_breach',
    'flag_timeline_breach',
    'flag_quality_breach',
    'compliant',
    'pending'
];

// Payout status values
const PAYOUT_STATUS_VALUES = ['none', '20_held', 'complete'];

// Day-30 window for 20% release (in milliseconds)
const DAY_30_MS = 30 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Spec validation — called by lock pipeline BEFORE freezing compliance_spec
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that a compliance_spec object has all required-at-lock fields.
 * Called by the Stripe payment_intent.succeeded handler before writing
 * status=LOCKED to the Deal record.
 *
 * @param {Object} spec - Parsed compliance_spec object (not stringified)
 * @returns {{ valid: boolean, errors: string[] }}
 *
 * Caller responsibility: if valid=false, do NOT transition to LOCKED.
 * The spec must be corrected before the lock pipeline retries.
 */
export function validateLockedSpec(spec) {
    const errors = [];

    if (!Array.isArray(spec?.deliverables) || spec.deliverables.length === 0) {
        errors.push('deliverables array must be non-empty');
    }
    if (!spec?.timeline?.delivery_due_date) {
        errors.push('timeline.delivery_due_date required');
    }
    if (typeof spec?.timeline?.live_content_window_days !== 'number') {
        errors.push('timeline.live_content_window_days required (number)');
    }
    if (!spec?.scope?.usage_rights) {
        errors.push('scope.usage_rights required');
    }
    if (!Array.isArray(spec?.compliance_criteria) || spec.compliance_criteria.length === 0) {
        errors.push('compliance_criteria array must be non-empty');
    }
    if (typeof spec?.payout_terms?.total_creator_payout_amount !== 'number') {
        errors.push('payout_terms.total_creator_payout_amount required (number)');
    }
    if (
        typeof spec?.payout_terms?.split_80_amount !== 'number' ||
        typeof spec?.payout_terms?.split_20_amount !== 'number'
    ) {
        errors.push('payout_terms split amounts required (numbers)');
    }

    // Verify split amounts add up to total (within rounding tolerance of $0.01)
    if (
        typeof spec?.payout_terms?.split_80_amount === 'number' &&
        typeof spec?.payout_terms?.split_20_amount === 'number' &&
        typeof spec?.payout_terms?.total_creator_payout_amount === 'number'
    ) {
        const sum = spec.payout_terms.split_80_amount + spec.payout_terms.split_20_amount;
        const total = spec.payout_terms.total_creator_payout_amount;
        if (Math.abs(sum - total) > 0.01) {
            errors.push(
                `split_80 (${spec.payout_terms.split_80_amount}) + split_20 (${spec.payout_terms.split_20_amount}) = ${sum} must equal total (${total})`
            );
        }
    }

    return { valid: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Primary derivation — no side effects
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive the full compliance and payout state for a deal from its record
 * and its ComplianceEvents history.
 *
 * Pure function. No Airtable writes, no LLM calls, no side effects.
 * Same call with same inputs always produces the same output.
 *
 * @param {Object} deal - Deal record (from fetchRecords). compliance_spec must
 *   be a JSON-stringified string (or empty). Uses ?? '' defensive read per §0.3.
 * @param {Array}  events - Array of ComplianceEvent records for this deal
 *   (from fetchRecords). Expected fields: event_type, event_at, event_payload,
 *   event_notes, event_id.
 *
 * @returns {{
 *   status: string,       — one of COMPLIANCE_STATUS_SEVERITY values
 *   payout_status: string, — one of PAYOUT_STATUS_VALUES
 *   conditionsMet: Object, — { [criterion_id]: boolean }
 *   evidence: Object,      — { [criterion_id]: string (human-readable) }
 *   flags: Array           — array of { flag_type, message, source_event_id?, timestamp? }
 * }}
 */
export function deriveDealState(deal, events) {
    // ── Parse compliance_spec — defensive per §0.3 ──
    let complianceSpec;
    try {
        complianceSpec = JSON.parse(deal.compliance_spec ?? '{}');
    } catch (err) {
        return {
            status: 'pending',
            payout_status: 'none',
            conditionsMet: {},
            evidence: {},
            flags: [{ flag_type: 'spec_unparseable', message: err.message }]
        };
    }

    // ── Derive payout_status from payment_released events ──
    const has80 = events.some(e => e.event_type === 'payment_released_80');
    const has20 = events.some(e => e.event_type === 'payment_released_20');
    let payout_status = 'none';
    if (has80 && has20) payout_status = 'complete';
    else if (has80) payout_status = '20_held';
    // 'none' covers both pre-80% and the pre-lock state

    // ── Collect breach and rejection events ──
    const breachReports = events.filter(e => e.event_type === 'breach_report');
    const deliveryRejections = events.filter(e => e.event_type === 'delivery_rejected');
    const flags = [];

    for (const breach of breachReports) {
        const payload = safeParse(breach.event_payload);
        flags.push({
            flag_type: payload?.breach_type ?? 'flag_spec_breach',
            message: payload?.reason ?? breach.event_notes ?? 'Breach reported',
            source_event_id: breach.event_id,
            timestamp: breach.event_at
        });
    }

    for (const rejection of deliveryRejections) {
        const payload = safeParse(rejection.event_payload);
        flags.push({
            flag_type: 'flag_quality_breach',
            message: payload?.reason ?? rejection.event_notes ?? 'Delivery rejected by brand',
            source_event_id: rejection.event_id,
            timestamp: rejection.event_at
        });
    }

    // ── Derive status: breach flags override everything ──
    let status = 'pending';
    if (flags.length > 0) {
        // Pick the most severe flag for the primary status
        // Ordered by COMPLIANCE_STATUS_SEVERITY: spec > timeline > quality
        if (flags.some(f => f.flag_type === 'flag_spec_breach')) status = 'flag_spec_breach';
        else if (flags.some(f => f.flag_type === 'flag_timeline_breach')) status = 'flag_timeline_breach';
        else if (flags.some(f => f.flag_type === 'flag_quality_breach')) status = 'flag_quality_breach';
        else status = 'flag_spec_breach'; // unknown breach type → most conservative
    }

    // ── Derive conditionsMet and evidence from compliance_criteria + events ──
    const conditionsMet = {};
    const evidence = {};

    for (const criterion of (complianceSpec.compliance_criteria ?? [])) {
        const result = evaluateCriterion(criterion, events);
        conditionsMet[criterion.criterion_id] = result.met;
        evidence[criterion.criterion_id] = result.evidence;
    }

    // ── If no flags AND all criteria met AND at least one criterion defined → compliant ──
    const criteriaCount = Object.keys(conditionsMet).length;
    if (
        flags.length === 0 &&
        criteriaCount > 0 &&
        Object.values(conditionsMet).every(v => v)
    ) {
        status = 'compliant';
    }

    return { status, payout_status, conditionsMet, evidence, flags };
}

// ─────────────────────────────────────────────────────────────────────────────
// Day-30 eligibility check — called by release-20-percent endpoint
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determines whether the 20% payout hold can be released based on:
 *   1. A brand_approval ComplianceEvent exists (the day-30 clock starts at approval)
 *   2. 30 calendar days have elapsed since brand_approval event_at
 *   3. deriveDealState reports no active breach flags
 *
 * @param {Object} deal   - Deal record
 * @param {Array}  events - ComplianceEvents array for this deal
 * @returns {{
 *   eligible: boolean,
 *   reason: string,           — human-readable eligibility or block reason
 *   daysRemaining: number,    — days until eligible (0 if already eligible)
 *   approvalEvent: Object|null — the brand_approval event used as clock start, or null
 * }}
 */
export function checkDay30Eligibility(deal, events) {
    const approvalEvent = events.find(e => e.event_type === 'brand_approval');
    if (!approvalEvent) {
        return {
            eligible: false,
            reason: 'No brand_approval event found — 30-day clock has not started',
            daysRemaining: null,
            approvalEvent: null
        };
    }

    const approvalAt = new Date(approvalEvent.event_at);
    const now = new Date();
    const elapsedMs = now - approvalAt;
    const daysElapsed = elapsedMs / (24 * 60 * 60 * 1000);
    const daysRemaining = Math.max(0, 30 - daysElapsed);

    if (elapsedMs < DAY_30_MS) {
        return {
            eligible: false,
            reason: `Day-30 not reached (${Math.floor(daysElapsed)} days elapsed since brand approval; ${Math.ceil(daysRemaining)} days remaining)`,
            daysRemaining: Math.ceil(daysRemaining),
            approvalEvent
        };
    }

    // Day-30 reached — check for active compliance flags
    const { flags } = deriveDealState(deal, events);
    const hasActiveBreach = flags.length > 0;

    if (hasActiveBreach) {
        const flagSummary = flags.map(f => f.flag_type).join(', ');
        return {
            eligible: false,
            reason: `Active compliance flags block 20% release: ${flagSummary}`,
            daysRemaining: 0,
            approvalEvent
        };
    }

    // Check that 80% was already released
    const has80 = events.some(e => e.event_type === 'payment_released_80');
    if (!has80) {
        return {
            eligible: false,
            reason: '80% payout has not been released — 20% release requires prior 80% release',
            daysRemaining: 0,
            approvalEvent
        };
    }

    // Check 20% not already released
    const has20 = events.some(e => e.event_type === 'payment_released_20');
    if (has20) {
        return {
            eligible: false,
            reason: '20% payout has already been released',
            daysRemaining: 0,
            approvalEvent
        };
    }

    return {
        eligible: true,
        reason: `Day-30 reached (${Math.floor(daysElapsed)} days since brand approval); no active compliance flags`,
        daysRemaining: 0,
        approvalEvent
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluate a single compliance criterion against the events array.
 * Returns { met: boolean, evidence: string }.
 *
 * Dispatch by verification_method:
 *   'brand_approval'    — satisfied by a brand_approval ComplianceEvent
 *   'system_link_check' — placeholder: treated as manual_review until Brief 16 implements link checking
 *   'manual_review'     — satisfied by a compliance_event_manual event whose payload references this criterion_id
 *   (unknown)           — conservative: not met, pending label
 */
function evaluateCriterion(criterion, events) {
    switch (criterion.verification_method) {
        case 'brand_approval': {
            const approval = events.find(e => e.event_type === 'brand_approval');
            return {
                met: !!approval,
                evidence: approval
                    ? `Brand approved on ${approval.event_at}`
                    : 'Awaiting brand approval'
            };
        }

        case 'system_link_check': {
            // Placeholder: future briefs may add link-check events.
            // Treating as manual_review until Brief 16 implements link checking.
            const manual = events.find(e => {
                if (e.event_type !== 'compliance_event_manual') return false;
                const payload = safeParse(e.event_payload);
                return payload?.criterion_id === criterion.criterion_id;
            });
            return {
                met: !!manual,
                evidence: manual
                    ? `Manual review confirmed on ${manual.event_at}: ${manual.event_notes ?? '(no notes)'}`
                    : 'Awaiting system link check (treated as manual review — Brief 16 will automate)'
            };
        }

        case 'manual_review': {
            const manual = events.find(e => {
                if (e.event_type !== 'compliance_event_manual') return false;
                const payload = safeParse(e.event_payload);
                return payload?.criterion_id === criterion.criterion_id;
            });
            return {
                met: !!manual,
                evidence: manual
                    ? `Manual review confirmed on ${manual.event_at}: ${manual.event_notes ?? '(no notes)'}`
                    : 'Awaiting operator manual review'
            };
        }

        default:
            return {
                met: false,
                evidence: `Unknown verification_method '${criterion.verification_method}' — cannot evaluate`
            };
    }
}

/**
 * Safe JSON.parse — returns null on any failure.
 * Used for event_payload parsing where malformed JSON should not throw.
 */
function safeParse(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') return null;
    try {
        return JSON.parse(jsonString);
    } catch {
        return null;
    }
}
