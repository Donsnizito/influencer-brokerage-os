// src/skills/outreach_send.js
//
// Production outreach send pipeline — operator-triggered SendGrid send.
//
// Operator clicks "Send" in the dashboard for a specific draft. This module:
//   reads the draft from OutreachDrafts
//   verifies status is pending_review (load-bearing double-send protection)
//   fetches the brand record to get the contact email
//   fires the email via SendGrid (via notifications.js sendOutreachEmail)
//   on success: updates status=sent, sent_at, sendgrid_message_id
//   on failure: leaves status=pending_review, increments send_failure_count,
//               populates last_send_failure_reason
//
// **No cross-module import discipline:** this module does NOT import
// outreach_orchestration.js. Communication with that module is solely through
// the OutreachDrafts table. Generation writes; send reads.
//
// Brief 12 owns this file. The POST /api/outreach/send/:draftId route consumes
// its public API. Brief 13 (negotiation extension) will write reply correlation
// data (reply_received / reply_received_at / reply_classification) back to the
// same OutreachDrafts rows using the sendgrid_message_id for In-Reply-To matching.

import { outreachDraftsTable, brandsTable, fetchRecords } from '../utils/airtable.js';
import { sendOutreachEmail } from '../utils/notifications.js';

// ── Logging helpers ───────────────────────────────────────────────────────────
// Codebase uses console.* directly. Matches the prevailing pattern.
const log = {
    info:  (msg) => console.log(`[INFO]  ${msg}`),
    warn:  (msg) => console.warn(`[WARN]  ${msg}`),
    error: (msg) => console.error(`[ERROR] ${msg}`)
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send a specific OutreachDraft via SendGrid.
 *
 * @param {string} draftId - The Airtable record ID of the OutreachDraft.
 *
 * @returns {Promise<{
 *   success: boolean,
 *   draftId: string,
 *   sentTo: string,            // recipient email (populated on both success and failure)
 *   sendgridMessageId: string | null, // populated on success; null on failure
 *   error: string | null,      // populated on failure; null on success
 *   sendFailureCount: number   // updated count post-failure (or 0 on success)
 * }>}
 *
 * Throws on:
 *   - Draft record not found.
 *   - Draft status is not 'pending_review' (cannot send from 'sent', 'rejected',
 *     or 'archived'). This is the ONLY guard against double-sends.
 *   - Brand record linked from draft cannot be fetched.
 *   - Brand has no valid contact email.
 *
 * Does NOT throw on:
 *   - SendGrid API failure. Updates draft with failure state and returns
 *     { success: false, ... } so the dashboard can render the failure state cleanly.
 */
export async function sendOutreachDraft(draftId) {
    // 1. Fetch the draft
    const drafts = await fetchRecords(outreachDraftsTable, `RECORD_ID() = '${draftId}'`);
    if (drafts.length === 0) {
        throw new Error(`sendOutreachDraft: draft not found for draftId=${draftId}`);
    }
    const draft = drafts[0];

    // 2. Verify status is pending_review — load-bearing double-send protection.
    //
    //    This check prevents:
    //      - Double-sends: a 'sent' draft cannot be re-sent accidentally.
    //      - Sending a rejected or archived draft without operator intent.
    //
    //    If a future brief (e.g., Brief 19 learning loop, re-send mechanism) needs
    //    to resend an already-sent draft, it must explicitly transition the draft
    //    to 'pending_review' first (with appropriate audit trail) before calling
    //    sendOutreachDraft again. This function is NOT the place to handle that
    //    transition — callers own the state machine outside this gate.
    if (draft.status !== 'pending_review') {
        throw new Error(
            `sendOutreachDraft: cannot send from status='${draft.status}' — only 'pending_review' is sendable. draftId=${draftId}`
        );
    }

    // 3. Fetch the brand record to get the contact email.
    //    brand_id is a Link-to-Record field — Airtable SDK returns it as an array
    //    of record IDs. Read defensively per §0.3 doctrine.
    const brandIdRaw = draft.brand_id;
    if (!Array.isArray(brandIdRaw) || brandIdRaw.length === 0) {
        throw new Error(`sendOutreachDraft: draft has no brand_id link. draftId=${draftId}`);
    }
    const brandId = brandIdRaw[0];

    const brands = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
    if (brands.length === 0) {
        throw new Error(
            `sendOutreachDraft: brand record not found for brandId=${brandId} (linked from draftId=${draftId})`
        );
    }
    const brand = brands[0];

    // contact_email is the canonical field per §4.1 and server.js line 319.
    const toEmail = brand.contact_email;
    if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
        throw new Error(
            `sendOutreachDraft: brand has no valid contact email. brandId=${brandId}, draftId=${draftId}`
        );
    }

    // 4. Fire the send via notifications.js
    log.info(`[outreach_send] attempting send for draftId=${draftId} to=${toEmail}`);

    let sendResult;
    try {
        sendResult = await sendOutreachEmail({
            to: toEmail,
            subject: draft.subject,
            body: draft.body
        });
    } catch (err) {
        // SendGrid failure — update draft with failure state, do NOT throw.
        // The dashboard renders { success: false } cleanly; operator retries manually.
        const currentFailureCount = typeof draft.send_failure_count === 'number'
            ? draft.send_failure_count
            : 0;
        const newFailureCount = currentFailureCount + 1;

        try {
            await outreachDraftsTable.update([{
                id: draftId,
                fields: {
                    send_failure_count: newFailureCount,
                    last_send_failure_reason: `${err.message ?? '(no message)'} (attempt ${newFailureCount})`
                }
            }]);
        } catch (updateErr) {
            // If even the failure-state update fails, log and continue — returning
            // the failure result is more important than crashing the route handler.
            log.error(`[outreach_send] ALSO FAILED to update failure state for draftId=${draftId}: ${updateErr.message}`);
        }

        log.error(`[outreach_send] SEND FAILED for draftId=${draftId}: ${err.message} (failure count: ${newFailureCount})`);

        return {
            success: false,
            draftId,
            sentTo: toEmail,
            sendgridMessageId: null,
            error: err.message,
            sendFailureCount: newFailureCount
        };
    }

    // 5. Success — update draft status to sent.
    const sendgridMessageId = sendResult.messageId ?? null;
    if (!sendgridMessageId) {
        log.warn(
            `[outreach_send] SendGrid returned success but no x-message-id header for draftId=${draftId}. ` +
            `Persisting send with empty sendgrid_message_id. Brief 13 reply matching may be impaired.`
        );
    }

    await outreachDraftsTable.update([{
        id: draftId,
        fields: {
            status: 'sent',
            sent_at: new Date().toISOString(),
            sendgrid_message_id: sendgridMessageId ?? ''
        }
    }]);

    log.info(`[outreach_send] SENT draftId=${draftId} to=${toEmail}, sendgridMessageId=${sendgridMessageId ?? '(none)'}`);

    return {
        success: true,
        draftId,
        sentTo: toEmail,
        sendgridMessageId: sendgridMessageId ?? '',
        error: null,
        sendFailureCount: 0
    };
}
