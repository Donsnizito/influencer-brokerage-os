// src/utils/notifications.js
//
// Centralized notification utilities for the brokerage system.
//
// Exports:
//   sendOutreachEmail({ to, subject, body }) — fires a brand-facing outreach email
//     via SendGrid REST API v3. Used by outreach_send.js (Brief 12).
//
// Implementation notes:
//   - Reuses the fetch-based SendGrid REST v3 pattern established in
//     payment_handler.js's sendOperatorPayoutAlert (same pattern, different
//     purpose: outreach-to-brands vs internal operator alerts).
//   - From address comes from SENDGRID_OUTREACH_FROM_EMAIL env var, separate
//     from the operator-alert From (OWNER_EMAIL) — different sender identity
//     per Brief 9a's institutional posture frame.
//   - Returns { messageId } extracted from the x-message-id response header.
//     Brief 13 uses this for In-Reply-To / References header matching against
//     inbound replies.
//   - DOES NOT modify sendOperatorPayoutAlert behavior (that function lives in
//     payment_handler.js and is in production). This file is new; it adds net-new
//     capability without touching existing paths.
//
// Env vars consumed:
//   SENDGRID_API_KEY          — required; throws if missing at call time
//   SENDGRID_OUTREACH_FROM_EMAIL — required; the From address for brand outreach.
//     Set in Render env. See .env.example for canonical name. Must be a
//     SendGrid-verified sender or domain.
//   SENDGRID_OUTREACH_FROM_NAME  — optional; display name for outreach From.
//     Defaults to AGENCY_NAME env var, then 'Wells+ Daily'.
//
// Brief 12 owns this file. Brief 13 (negotiation extension) consumes the
// messageId return value for reply correlation.

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

/**
 * Send a brand-facing outreach email via SendGrid REST API v3.
 *
 * Separate from the operator-alert path in payment_handler.js:
 *   - Different From address (SENDGRID_OUTREACH_FROM_EMAIL, not OWNER_EMAIL)
 *   - Different From display name (brokerage name, not 'Brokerage Alerts')
 *   - Returns { messageId } for Brief 13 reply correlation
 *
 * @param {{ to: string, subject: string, body: string }} params
 *   to      — recipient email address (brand contact)
 *   subject — email subject line
 *   body    — plain-text email body
 *
 * @returns {Promise<{ messageId: string | null }>}
 *   messageId — the x-message-id header from SendGrid response.
 *   null if SendGrid doesn't return the header (should not happen in production,
 *   but outreach_send.js handles the null case gracefully).
 *
 * @throws {Error} on:
 *   - SENDGRID_API_KEY not set
 *   - SENDGRID_OUTREACH_FROM_EMAIL not set
 *   - SendGrid API returns non-2xx (e.g., 401 auth failure, 400 bad payload)
 *   - Network failure (fetch throws)
 *
 * Does NOT throw on:
 *   - x-message-id header absent from a 2xx response (returns { messageId: null })
 */
export async function sendOutreachEmail({ to, subject, body }) {
    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
        throw new Error('sendOutreachEmail: SENDGRID_API_KEY not set in env');
    }

    const fromEmail = process.env.SENDGRID_OUTREACH_FROM_EMAIL;
    if (!fromEmail) {
        throw new Error('sendOutreachEmail: SENDGRID_OUTREACH_FROM_EMAIL not set in env — set this to a SendGrid-verified sender address');
    }

    const fromName = process.env.SENDGRID_OUTREACH_FROM_NAME
        || process.env.AGENCY_NAME
        || 'Wells+ Daily';

    const payload = {
        personalizations: [{
            to: [{ email: to }]
        }],
        from: {
            email: fromEmail,
            name: fromName
        },
        subject: subject,
        content: [{
            type: 'text/plain',
            value: body
        }]
    };

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        let errText;
        try {
            errText = await response.text();
        } catch (_) {
            errText = '(could not read error body)';
        }
        throw new Error(
            `sendOutreachEmail: SendGrid returned ${response.status} — ${errText.slice(0, 500)}`
        );
    }

    // SendGrid returns 202 Accepted on success with x-message-id header.
    // This header is the Message-ID for In-Reply-To matching in Brief 13.
    const messageId = response.headers.get('x-message-id') ?? null;

    return { messageId };
}
