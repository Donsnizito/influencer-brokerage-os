// src/skills/negotiation_handler.js
//
// Inbound email classification and reply-correlation pipeline.
//
// Brief 13 (2026-06-10) — Extended from original 144-line handler:
//   - System prompt extracted to src/prompts/negotiation_system.md (5-label taxonomy)
//   - classifyNegotiation migrated from classifyAndExtract (text-output) to chatCompletion
//     (tool-use, structured output via classify_reply tool). Q5 = migrate; rationale:
//     classifyAndExtract uses JSON.parse on raw text output — text-output-based, no
//     tool-use enforcement. Migration aligns classifier with Brief 9b's chatCompletion
//     architecture and eliminates JSON parse fragility.
//   - Two new RED triggers: guarantee_scope_expansion, payout_structure_pushback
//   - Deal-range injection: getDealRangeContext fetches target_budget, rate_range,
//     proposed_rate_band from draft → brand and draft → creator links
//   - Three-tier reply-to-draft matching: In-Reply-To → References → most-recent-sender
//   - OutreachDrafts reply-write coupling: writeReplyCorrelationToDraft (named helper,
//     single write path for Brief 19+ learning loop)
//   - processInboundEmail signature changed to object-parameter:
//     { record, emailText, senderType, senderEmail, inReplyToHeader, referencesHeader }
//
// Prior behaviors fully preserved: roster link generation, brand GREEN dispatch
// (send roster email), influencer GREEN dispatch (quote_terms update), YELLOW/RED
// flag writes, generateRosterLink.

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import {
    dealsTable,
    brandsTable,
    influencersTable,
    outreachDraftsTable,
    fetchRecords,
    updateRecord
} from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { chatCompletion } from '../utils/llm.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { normalizeMessageId, parseReferencesHeader, extractHeaders } from '../lib/email_headers.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'negotiation_system.md');

// ── Prompt artifact loader ────────────────────────────────────────────────────
// Runs at module init. Fails loud if artifact is missing or malformed.

function loadNegotiationPromptArtifact() {
    let content;
    try {
        content = readFileSync(PROMPT_PATH, 'utf8');
    } catch (err) {
        throw new Error(`negotiation_handler: prompt artifact not found at ${PROMPT_PATH}: ${err.message}`);
    }

    const systemMatch = content.match(/^<<<\s*\n([\s\S]*?)\n>>>\s*$/m);
    if (!systemMatch) {
        throw new Error('negotiation_handler: <<< / >>> markers missing or unbalanced in negotiation_system.md');
    }
    const systemPrompt = systemMatch[1].trim();

    // Extract JSON blocks — each Example's Input and Output are separate blocks.
    // We parse them as pairs: odd-indexed = input, even-indexed = output.
    const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
    const allBlocks = [];
    let match;
    while ((match = jsonBlockRegex.exec(content)) !== null) {
        try {
            allBlocks.push(JSON.parse(match[1]));
        } catch (err) {
            throw new Error(`negotiation_handler: few-shot JSON parse failed for block ${allBlocks.length + 1}: ${err.message}`);
        }
    }
    // Blocks come in input/output pairs: [input0, output0, input1, output1, ...]
    if (allBlocks.length < 6) {
        throw new Error(`negotiation_handler: expected at least 6 JSON blocks (3 input/output pairs) in negotiation_system.md, found ${allBlocks.length}`);
    }

    const fewShots = [];
    for (let i = 0; i < allBlocks.length - 1; i += 2) {
        // Input blocks have reply_text; output blocks have classification.
        if (allBlocks[i].reply_text !== undefined && allBlocks[i + 1].classification !== undefined) {
            fewShots.push({ input: allBlocks[i], output: allBlocks[i + 1] });
        }
    }
    if (fewShots.length < 3) {
        throw new Error(`negotiation_handler: expected at least 3 few-shot pairs in negotiation_system.md, parsed ${fewShots.length}`);
    }

    return { systemPrompt, fewShots };
}

const PROMPT_ARTIFACT = loadNegotiationPromptArtifact();

// ── Email transporter (preserved from original) ───────────────────────────────

const transporter = process.env.SENDGRID_API_KEY
    ? nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: {
            user: 'apikey',
            pass: process.env.SENDGRID_API_KEY
        }
      })
    : nodemailer.createTransport({
        host: process.env.NEOMAIL_SMTP_HOST || 'mail.neomail.com',
        port: process.env.NEOMAIL_SMTP_PORT || 587,
        secure: false,
        auth: {
            user: process.env.NEOMAIL_USER,
            pass: process.env.NEOMAIL_PASS
        }
      });

function loadTemplate(templateName) {
    const p = path.resolve(process.cwd(), 'email_templates', templateName);
    return fs.readFileSync(p, 'utf8');
}

// ── Negotiation classifier tool schema ───────────────────────────────────────

const NEGOTIATION_CLASSIFIER_TOOL = {
    name: 'classify_reply',
    description: 'Classify an inbound email reply and return structured output with classification label, rationale, rate mentioned (if any), and trigger detected (for RED labels).',
    input_schema: {
        type: 'object',
        properties: {
            classification: {
                type: 'string',
                enum: ['green_yes', 'green_pricing_q', 'yellow_general_q', 'red_pushback', 'red_escalation'],
                description: 'The single classification label for this reply.'
            },
            rationale: {
                type: 'string',
                description: '1–2 sentences, operator-facing, explaining the classification verdict.'
            },
            rate_mentioned: {
                type: ['integer', 'null'],
                description: 'Dollar amount as integer if the reply mentions a specific rate; null otherwise.'
            },
            trigger_detected: {
                type: ['string', 'null'],
                description: 'For RED labels only: the specific trigger that fired. Null for non-RED labels. Valid values: guarantee_scope_expansion | payout_structure_pushback | legal_complexity | out_of_band_rate | complaint | legal_threat | circumvention_attempt | reputational_threat'
            }
        },
        required: ['classification', 'rationale', 'rate_mentioned', 'trigger_detected']
    }
};

// ── Deal-range context ────────────────────────────────────────────────────────

/**
 * Format the deal-range context block injected into the classifier's user message.
 */
function formatDealContext(dealContext) {
    if (!dealContext) {
        return 'Deal context:\n- (no draft matched; standard deal band $5K-$15K applies)';
    }
    return [
        'Deal context:',
        `- target_budget: ${dealContext.brandTargetBudget ?? 'null'}`,
        `- creator_rate_range: ${dealContext.creatorRateRange ?? 'null'}`,
        `- proposed_rate_band: ${dealContext.proposedRateBand ?? 'null'}`,
        `- deal_band_low: ${dealContext.dealBandLow}`,
        `- deal_band_high: ${dealContext.dealBandHigh}`
    ].join('\n');
}

/**
 * Fetch deal-range context for a given OutreachDraft ID.
 * Returns a standard context object with nulls if draft not found.
 * Never returns null itself — the context block is always formed.
 *
 * @param {string|null} draftId - Airtable record ID of the OutreachDraft, or null.
 * @returns {Promise<{ brandTargetBudget: number|null, creatorRateRange: string|null,
 *   proposedRateBand: string|null, dealBandLow: number, dealBandHigh: number }>}
 */
async function getDealRangeContext(draftId) {
    const defaultContext = {
        brandTargetBudget: null,
        creatorRateRange: null,
        proposedRateBand: null,
        dealBandLow: 5000,
        dealBandHigh: 15000
    };

    if (!draftId) return defaultContext;

    const drafts = await fetchRecords(outreachDraftsTable, `RECORD_ID() = '${draftId}'`);
    if (drafts.length === 0) return defaultContext;
    const draft = drafts[0];

    const brandId = Array.isArray(draft.brand_id) ? draft.brand_id[0] : null;
    const creatorId = Array.isArray(draft.creator_id) ? draft.creator_id[0] : null;

    let brandTargetBudget = null;
    let creatorRateRange = null;

    if (brandId) {
        const brands = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
        if (brands.length > 0) brandTargetBudget = brands[0].target_budget ?? null;
    }
    if (creatorId) {
        const creators = await fetchRecords(influencersTable, `RECORD_ID() = '${creatorId}'`);
        if (creators.length > 0) creatorRateRange = creators[0].rate_range ?? null;
    }

    return {
        brandTargetBudget,
        creatorRateRange,
        proposedRateBand: draft.proposed_rate_band ?? null,
        dealBandLow: 5000,
        dealBandHigh: 15000
    };
}

// ── Classifier ────────────────────────────────────────────────────────────────

/**
 * Classify an inbound email reply using the prompt artifact and chatCompletion tool-use.
 *
 * @param {string} emailText - The full text of the inbound reply.
 * @param {string} senderType - 'brand_contact' or 'creator'.
 * @param {Object|null} dealContext - Output of getDealRangeContext, or null.
 *
 * @returns {Promise<{
 *   classification: string,
 *   rationale: string,
 *   rate_mentioned: number|null,
 *   trigger_detected: string|null
 * }>}
 */
async function classifyNegotiation(emailText, senderType, dealContext = null) {
    const contextBlock = formatDealContext(dealContext);
    const userMessage = `${contextBlock}\n\nSender type: ${senderType}\n\nReply text:\n${emailText}`;

    // Assemble few-shots as synthetic turn pairs (tool-use format)
    const messages = [];
    for (let i = 0; i < PROMPT_ARTIFACT.fewShots.length; i++) {
        const shot = PROMPT_ARTIFACT.fewShots[i];
        const shotContextBlock = formatDealContext(shot.input.deal_context || null);
        const shotUserMessage = `${shotContextBlock}\n\nSender type: ${shot.input.sender_type}\n\nReply text:\n${shot.input.reply_text}`;
        const toolUseId = `toolu_fewshot_${i + 1}`;

        messages.push({ role: 'user', content: shotUserMessage });
        messages.push({
            role: 'assistant',
            content: [{
                type: 'tool_use',
                id: toolUseId,
                name: NEGOTIATION_CLASSIFIER_TOOL.name,
                input: shot.output
            }]
        });
        messages.push({
            role: 'user',
            content: [{
                type: 'tool_result',
                tool_use_id: toolUseId,
                content: 'Acknowledged.'
            }]
        });
    }
    messages.push({ role: 'user', content: userMessage });

    const result = await chatCompletion({
        systemMessage: PROMPT_ARTIFACT.systemPrompt,
        messages,
        tool: NEGOTIATION_CLASSIFIER_TOOL
    });

    return result.toolInput;
}

// ── Three-tier reply-to-draft matching ────────────────────────────────────────

/**
 * Find which OutreachDraft an inbound reply is replying to.
 *
 * Three-tier strategy:
 *   Tier 1a: In-Reply-To header match against sendgrid_message_id (bulletproof)
 *   Tier 1b: References header chain match (fallback for stripped In-Reply-To)
 *   Tier 2:  Most-recent-sent-to-this-sender-email (heuristic)
 *   Tier 3:  No match — returns { draftId: null, matchTier: 'no_match' }
 *
 * @param {Object} params
 * @param {string|null} params.inReplyToHeader - Value of the In-Reply-To header, or null.
 * @param {string|null} params.referencesHeader - Value of the References header, or null.
 * @param {string|null} params.senderEmail - The sender's email address, or null.
 *
 * @returns {Promise<{ draftId: string|null, matchTier: 'in_reply_to'|'references'|'most_recent_sender'|'no_match' }>}
 */
async function findMatchingDraftForReply({ inReplyToHeader, referencesHeader, senderEmail }) {
    // Tier 1a: In-Reply-To header match
    if (inReplyToHeader) {
        const normalized = normalizeMessageId(inReplyToHeader);
        if (normalized) {
            const sentDrafts = await fetchRecords(outreachDraftsTable, `{status} = 'sent'`);
            for (const draft of sentDrafts) {
                const storedId = normalizeMessageId(draft.sendgrid_message_id ?? '');
                if (storedId && storedId === normalized) {
                    return { draftId: draft.id, matchTier: 'in_reply_to' };
                }
            }
        }
    }

    // Tier 1b: References header chain match
    if (referencesHeader) {
        const references = parseReferencesHeader(referencesHeader);
        if (references.length > 0) {
            const sentDrafts = await fetchRecords(outreachDraftsTable, `{status} = 'sent'`);
            for (const ref of references) {
                for (const draft of sentDrafts) {
                    const storedId = normalizeMessageId(draft.sendgrid_message_id ?? '');
                    if (storedId && storedId === ref) {
                        return { draftId: draft.id, matchTier: 'references' };
                    }
                }
            }
        }
    }

    // Tier 2: Most-recent-sent-to-this-sender
    if (senderEmail && typeof senderEmail === 'string') {
        const senderLower = senderEmail.toLowerCase().trim();
        const brands = await fetchRecords(brandsTable, `LOWER({contact_email}) = '${senderLower}'`);
        if (brands.length > 0) {
            const brandIdSet = new Set(brands.map(b => b.id));
            const sentDrafts = await fetchRecords(outreachDraftsTable, `{status} = 'sent'`);
            const matching = sentDrafts.filter(d => {
                if (!Array.isArray(d.brand_id) || d.brand_id.length === 0) return false;
                return brandIdSet.has(d.brand_id[0]);
            });
            if (matching.length > 0) {
                matching.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
                return { draftId: matching[0].id, matchTier: 'most_recent_sender' };
            }
        }
    }

    // Tier 3: No match — operator manual association required
    return { draftId: null, matchTier: 'no_match' };
}

// ── OutreachDrafts reply-write coupling ───────────────────────────────────────

/**
 * Write reply correlation data to the matched OutreachDraft row.
 * Called after classification completes and a draft has been matched.
 * No-op if draftId is null (Tier 3 no-match case).
 *
 * Single named function so Brief 19+'s learning loop can read the reply
 * correlation data cleanly — one write path, no scattered field updates.
 *
 * @param {Object} params
 * @param {string|null} params.draftId - Airtable record ID of the OutreachDraft.
 * @param {string} params.classification - One of the 5-label enum values.
 * @param {string} params.receivedAt - ISO 8601 timestamp of when the reply arrived.
 */
async function writeReplyCorrelationToDraft({ draftId, classification, receivedAt }) {
    if (!draftId) return;
    await outreachDraftsTable.update([{
        id: draftId,
        fields: {
            reply_received: true,
            reply_received_at: receivedAt,
            reply_classification: classification
        }
    }]);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Process an inbound email reply: match draft, classify, write correlation, dispatch.
 *
 * Replaces the original positional signature (record, emailText, senderType) with
 * an object-parameter signature to accommodate Brief 13's reply-matching inputs
 * without breaking the single call site in server.js.
 *
 * @param {Object} params
 * @param {Object} params.record - The Airtable record for the sender (influencer or brand).
 * @param {string} params.emailText - Full text of the inbound email.
 * @param {string} params.senderType - 'influencer' or 'brand'.
 * @param {string|null} params.senderEmail - Sender's email address (for Tier 2 matching).
 * @param {string|null} params.inReplyToHeader - In-Reply-To header value (for Tier 1a matching).
 * @param {string|null} params.referencesHeader - References header value (for Tier 1b matching).
 *
 * @returns {Promise<{
 *   classification: string,
 *   matchedDraftId: string|null,
 *   matchTier: string,
 *   rationale: string,
 *   triggerDetected: string|null,
 *   rateMentioned: number|null
 * }>}
 */
export async function processInboundEmail({
    record,
    emailText,
    senderType,
    senderEmail = null,
    inReplyToHeader = null,
    referencesHeader = null
}) {
    console.log(`Processing inbound email for ${senderType} ID: ${record.id}`);
    const receivedAt = new Date().toISOString();

    // 1. Find matching OutreachDraft (three-tier strategy)
    const matchResult = await findMatchingDraftForReply({ inReplyToHeader, referencesHeader, senderEmail });
    const matchedDraftId = matchResult.draftId;

    if (matchResult.matchTier === 'no_match') {
        logActivity('negotiation_handler', record.id, 'INBOUND_NO_DRAFT_MATCH', record.status || 'UNKNOWN', record.status || 'UNKNOWN');
    }

    // 2. Fetch deal-range context for the matched draft
    let dealContext = null;
    try {
        dealContext = await getDealRangeContext(matchedDraftId);
    } catch (ctxErr) {
        logError(Tiers.LOW, 'negotiation_handler', 'getDealRangeContext failed (non-fatal)', { error: ctxErr.message });
    }

    // 3. Classify the reply
    let classificationResult;
    try {
        classificationResult = await classifyNegotiation(emailText, senderType, dealContext);
    } catch (e) {
        console.error('LLM Classification Failed:', e.message);
        logActivity('negotiation_handler', record.id, 'LLM_CLASSIFICATION_FAILED', record.status || 'UNKNOWN', record.status || 'UNKNOWN');
        return {
            classification: null,
            matchedDraftId,
            matchTier: matchResult.matchTier,
            rationale: null,
            triggerDetected: null,
            rateMentioned: null
        };
    }

    const { classification, rationale, rate_mentioned, trigger_detected } = classificationResult;

    // 4. Write reply correlation to matched OutreachDraft (no-op if Tier 3)
    try {
        await writeReplyCorrelationToDraft({
            draftId: matchedDraftId,
            classification,
            receivedAt
        });
    } catch (writeErr) {
        // Non-fatal: the classification still happened; log and continue
        logError(Tiers.HIGH, 'negotiation_handler', 'writeReplyCorrelationToDraft failed', {
            draftId: matchedDraftId,
            error: writeErr.message
        });
    }

    // 5. Dispatch post-classification actions (preserved from original handler)
    if (senderType === 'influencer') {
        // Map the new 5-label taxonomy to dispatch actions.
        // green_yes / green_pricing_q with extractable quote → QUOTE_RECEIVED
        // Others → flag on record
        if (classification === 'green_yes' || classification === 'green_pricing_q') {
            // If the LLM detected a rate, try to write quote data (best-effort)
            if (rate_mentioned !== null) {
                const downstreamStatuses = ['QUOTE_RECEIVED', 'DEAL_INITIATED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PAYMENT_COLLECTED'];
                const currentStatus = record.status;
                const newStatus = downstreamStatuses.includes(currentStatus) ? currentStatus : 'QUOTE_RECEIVED';

                await updateRecord(influencersTable, record.id, {
                    status: newStatus,
                    // Store rate as JSON quote_terms for downstream compatibility
                    quote_terms: JSON.stringify({ rate: rate_mentioned })
                });
                logActivity('negotiation_handler', record.id, 'QUOTE_RECEIVED', currentStatus, newStatus);
            } else {
                logActivity('negotiation_handler', record.id, 'INBOUND_GREEN_NO_QUOTE', record.status, record.status);
            }
        } else if (classification === 'yellow_general_q' || classification === 'red_pushback' || classification === 'red_escalation') {
            // Map to legacy flag vocabulary for backward compat with dashboard / tracker
            const flagValue = classification.startsWith('red') ? 'RED' : 'YELLOW';
            await updateRecord(influencersTable, record.id, { inbound_flag: flagValue });
            logActivity('negotiation_handler', record.id, `INBOUND_${classification.toUpperCase()}`, record.status, record.status);
        }
    } else if (senderType === 'brand') {
        if (classification === 'green_yes') {
            const downstreamStatuses = ['INTERESTED', 'DEAL_INITIATED', 'CONTRACT_SENT', 'CONTRACT_SIGNED', 'PAYMENT_COLLECTED'];
            const currentStatus = record.status;
            const newStatus = downstreamStatuses.includes(currentStatus) ? currentStatus : 'INTERESTED';

            let rosterUrl;
            const token = record.roster_token;
            if (!token || (record.roster_token_expires && new Date() > new Date(record.roster_token_expires))) {
                rosterUrl = await generateRosterLink(record.id);
            } else {
                const baseUrl = process.env.PUBLIC_SERVER_URL || 'http://localhost:3000';
                rosterUrl = `${baseUrl}/roster?t=${token}`;
            }

            await updateRecord(brandsTable, record.id, { status: newStatus });
            logActivity('negotiation_handler', record.id, 'INBOUND_GREEN_BRAND', currentStatus, newStatus);

            const templateRaw = loadTemplate('brand_roster_link_email.txt');
            const subjectMatch = templateRaw.match(/SUBJECT:\s*(.+)/);
            let subject = subjectMatch ? subjectMatch[1] : `Your roster — creators ready to work with ${record.company_name}`;
            let body = templateRaw.replace(/SUBJECT:\s*.+\n+/, '');

            subject = subject.replace(/{company_name}/g, record.company_name || 'your company');
            body = body.replace(/{contact_name}/g, record.contact_name || 'there')
                       .replace(/{company_name}/g, record.company_name || 'your company')
                       .replace(/{roster_url}/g, rosterUrl)
                       .replace(/{owner_name}/g, process.env.OWNER_NAME || 'Owner')
                       .replace(/{agency_name}/g, process.env.AGENCY_NAME || 'Agency');

            const fromEmail = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'info@influencer-agency.com';
            try {
                await transporter.sendMail({
                    from: `"${process.env.OWNER_NAME}" <${fromEmail}>`,
                    to: record.contact_email,
                    subject,
                    text: body
                });
            } catch (err) {
                console.error(`Failed to send roster link email to ${record.contact_email}: ${err.message}`);
            }

        } else if (classification === 'green_pricing_q' || classification === 'yellow_general_q') {
            // No automated action; operator reviews and responds manually
            logActivity('negotiation_handler', record.id, `INBOUND_${classification.toUpperCase()}`, record.status, record.status);
        } else if (classification === 'red_pushback' || classification === 'red_escalation') {
            const flagValue = 'RED';
            await updateRecord(brandsTable, record.id, { inbound_flag: flagValue });
            logActivity('negotiation_handler', record.id, `INBOUND_${classification.toUpperCase()}`, record.status, record.status);
        }
    }

    return {
        classification,
        matchedDraftId,
        matchTier: matchResult.matchTier,
        rationale,
        triggerDetected: trigger_detected,
        rateMentioned: rate_mentioned
    };
}

/**
 * Generate a time-limited roster link for a brand and persist the token.
 * Preserved from original handler.
 *
 * @param {string} brandId - Airtable record ID of the brand.
 * @returns {Promise<string>} - The full roster URL.
 */
export async function generateRosterLink(brandId) {
    const token = crypto.randomBytes(16).toString('hex');
    const expires = new Date();
    expires.setDate(expires.getDate() + 14); // 14 days from now

    await updateRecord(brandsTable, brandId, {
        roster_token: token,
        roster_token_expires: expires.toISOString(),
        roster_view_count: 0
    });

    const baseUrl = process.env.PUBLIC_SERVER_URL || 'http://localhost:3000';
    return `${baseUrl}/roster?t=${token}`;
}
