// src/lib/email_headers.js
//
// Generic header extraction from SendGrid Inbound Parse payloads.
// SendGrid Inbound Parse delivers all email headers concatenated into a single
// 'headers' form field — multi-line string with one header per line in the
// format "Header-Name: value". This helper parses any requested headers from
// that field.
//
// Used by Brief 13's negotiation_handler.js for In-Reply-To and References
// extraction. Future briefs that need other headers (e.g., Brief 14 for
// contract reply correlation) import this same helper.
//
// No negotiation-specific logic. No Airtable lookups. No LLM calls.
// Pure string parsing utility.

/**
 * Extract specified email headers from a concatenated headers field.
 *
 * SendGrid Inbound Parse posts all email headers as a single multi-line
 * string in the `headers` form field, one header per line in the format:
 *   "Header-Name: value"
 *
 * @param {string|null|undefined} headersFieldText - Raw multi-line headers string
 *   from SendGrid Inbound Parse. May be null/undefined/empty.
 * @param {string[]} headerNames - Array of header names to extract. Case-insensitive.
 *
 * @returns {Object} Map of lowercase headerName → value (string) | null.
 *   Keys are always the lowercased input headerNames. Values are the first
 *   occurrence of that header in the field, or null if not found.
 *
 * @example
 *   extractHeaders('In-Reply-To: <abc@xyz.com>\nSubject: test',
 *                  ['In-Reply-To', 'Subject', 'X-Missing'])
 *   // → { 'in-reply-to': '<abc@xyz.com>', 'subject': 'test', 'x-missing': null }
 */
export function extractHeaders(headersFieldText, headerNames) {
    const result = {};
    const normalizedNames = headerNames.map(n => n.toLowerCase());
    for (const name of normalizedNames) result[name] = null;

    if (!headersFieldText || typeof headersFieldText !== 'string') return result;

    const lines = headersFieldText.split(/\r?\n/);
    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const lineHeaderName = line.substring(0, colonIdx).trim().toLowerCase();
        const lineHeaderValue = line.substring(colonIdx + 1).trim();
        // Only capture the first occurrence of each requested header
        if (normalizedNames.includes(lineHeaderName) && result[lineHeaderName] === null) {
            result[lineHeaderName] = lineHeaderValue;
        }
    }
    return result;
}

/**
 * Normalize a Message-ID value: strip angle brackets, lowercase, trim.
 * Used for comparison between received In-Reply-To headers and stored
 * sendgrid_message_id values.
 *
 * @param {string|null|undefined} messageId - e.g. "<ABC.123@sendgrid.net>"
 * @returns {string} - e.g. "abc.123@sendgrid.net". Empty string if input is falsy.
 */
export function normalizeMessageId(messageId) {
    if (!messageId || typeof messageId !== 'string') return '';
    return messageId.trim().replace(/^</, '').replace(/>$/, '').toLowerCase();
}

/**
 * Parse a References header into individual normalized message IDs.
 * References headers contain a chain of Message-IDs separated by whitespace,
 * each wrapped in angle brackets.
 *
 * @param {string|null|undefined} referencesHeader - e.g. "<id1@x.com> <id2@y.com>"
 * @returns {string[]} - Array of normalized message IDs (without angle brackets,
 *   lowercased). Empty array if input is falsy or contains no valid IDs.
 */
export function parseReferencesHeader(referencesHeader) {
    if (!referencesHeader || typeof referencesHeader !== 'string') return [];
    const matches = referencesHeader.match(/<[^>]+>/g) || [];
    return matches.map(m => normalizeMessageId(m));
}
