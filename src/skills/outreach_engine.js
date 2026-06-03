// src/skills/outreach_engine.js
//
// Outreach engine — the LLM-backed first-touch outreach drafter.
//
// Consumes the canonical prompt artifact at src/prompts/outreach_system.md
// (Brief 9a + 9a-supplement). Loads the artifact at module init, parses
// out the four consumed sections (system prompt, few-shot bank, user-message
// template, and the implicit Section 2 output contract which is also defined
// in code below as the tool schema). Exposes generateOutreachDraft() as
// the single function callers use to produce a structured outreach draft
// from a Brand record + Creator record pair.
//
// Brief 12 (production outreach engine) consumes this. Nothing else does
// in the Brief 9b commit.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { chatCompletion } from '../utils/llm.js';
import { influencersTable, brandsTable, fetchRecords } from '../utils/airtable.js';

// ── Module-level path resolution ─────────────────────────────────────────────
// Absolute path anchored to this file's location, not process.cwd().
// This ensures the prompt resolves correctly regardless of where Node is launched.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROMPT_PATH = resolve(__dirname, '..', 'prompts', 'outreach_system.md');

// ── Tool schema (Section 2 output contract) ───────────────────────────────────
// Mirrors the output contract defined in outreach_system.md Section 2.
// This is what the model must populate; chatCompletion() enforces it via tool-use.
const OUTREACH_DRAFT_TOOL = {
    name: 'outreach_draft',
    description: 'Submit the first-touch outreach draft as a structured object. The brokerage operator will review before sending.',
    input_schema: {
        type: 'object',
        properties: {
            subject: {
                type: 'string',
                description: 'The email subject line. 6–12 words, fit-led, sentence case, no emojis.'
            },
            body: {
                type: 'string',
                description: 'The full email body, plain text, ≤130 words, ending with "— [Wells+ Daily]".'
            },
            fit_assessment: {
                type: 'string',
                enum: ['Strong', 'Moderate — with caveats', 'Weak — suggest different angle'],
                description: 'Honest fit verdict. Default is "Moderate — with caveats". "Strong" requires three or more specific points of evidence-backed alignment.'
            },
            fit_rationale: {
                type: 'string',
                description: '1–2 sentences explaining the fit verdict in operator-facing language.'
            },
            proposed_rate_band: {
                type: ['string', 'null'],
                description: 'Rate band string like "$7K–$9K". Must be inside $5K–$15K. Null if fit_assessment is "Weak — suggest different angle".'
            },
            evidence_used: {
                type: 'array',
                items: { type: 'string' },
                description: 'Specific facts from web search or record used in the body, for operator audit.'
            },
            search_queries: {
                type: 'array',
                items: { type: 'string' },
                description: 'Web search queries actually run, for cost auditing.'
            },
            flags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Operator flags before shipping. Standard vocabulary: "weak_fit_do_not_ship_without_review", "rate_outside_default_band", "thin_web_search_results", "creator_record_context_thin", "category_mismatch_suspected", "record_incomplete", "creator_record_eligibility_concern".'
            }
        },
        required: ['subject', 'body', 'fit_assessment', 'fit_rationale', 'proposed_rate_band', 'evidence_used', 'search_queries', 'flags']
    }
};

// ── Prompt artifact loader ────────────────────────────────────────────────────

/**
 * Load and parse src/prompts/outreach_system.md.
 *
 * Returns:
 *   {
 *     systemPrompt: <content between <<< and >>>>,
 *     fewShots: [{ inputContext: <string>, output: <object> }, ...],
 *     userMessageTemplate: <content between [[[ and ]]]>
 *   }
 *
 * Throws if the artifact is malformed (markers missing, JSON unparseable, etc.)
 * — the artifact-on-disk has drifted from its specification and must be fixed
 * before drafts can ship (per Section 5 failure modes).
 */
function loadPromptArtifact() {
    let content;
    try {
        content = readFileSync(PROMPT_PATH, 'utf8');
    } catch (err) {
        throw new Error(`outreach_engine: prompt artifact not found at ${PROMPT_PATH}: ${err.message}`);
    }

    // ── Extract system prompt between <<< and >>> ──────────────────────────────
    const systemMatch = content.match(/^<<<\s*\n([\s\S]*?)\n>>>\s*$/m);
    if (!systemMatch) {
        throw new Error('outreach_engine: <<< / >>> markers missing or unbalanced in outreach_system.md (Section 1)');
    }
    const systemPrompt = systemMatch[1].trim();

    // ── Extract user-message template between [[[ and ]]] ─────────────────────
    const userMatch = content.match(/^\[\[\[\s*\n([\s\S]*?)\n\]\]\]\s*$/m);
    if (!userMatch) {
        throw new Error('outreach_engine: [[[ / ]]] markers missing or unbalanced in outreach_system.md (Section 5)');
    }
    const userMessageTemplate = userMatch[1].trim();

    // ── Extract all JSON code blocks (the few-shot outputs in Section 3) ───────
    const jsonBlockRegex = /```json\n([\s\S]*?)\n```/g;
    const fewShotOutputs = [];
    let match;
    while ((match = jsonBlockRegex.exec(content)) !== null) {
        try {
            fewShotOutputs.push(JSON.parse(match[1]));
        } catch (err) {
            throw new Error(`outreach_engine: few-shot JSON block ${fewShotOutputs.length + 1} failed to parse: ${err.message}`);
        }
    }
    if (fewShotOutputs.length !== 3) {
        throw new Error(`outreach_engine: expected 3 few-shot JSON blocks in outreach_system.md Section 3, found ${fewShotOutputs.length}`);
    }

    // ── Extract the input contexts that precede each JSON block ───────────────
    // The contract: each few-shot has a "### Input context" header, then
    // brand record + creator record + web search summary, then "### Output"
    // header, then the JSON block.
    const inputContextRegex = /### Input context\s*\n([\s\S]*?)\n### Output/g;
    const fewShotInputs = [];
    while ((match = inputContextRegex.exec(content)) !== null) {
        fewShotInputs.push(match[1].trim());
    }
    if (fewShotInputs.length !== fewShotOutputs.length) {
        throw new Error(`outreach_engine: few-shot input/output count mismatch — ${fewShotInputs.length} inputs vs ${fewShotOutputs.length} outputs`);
    }

    const fewShots = fewShotInputs.map((input, i) => ({
        inputContext: input,
        output: fewShotOutputs[i]
    }));

    return { systemPrompt, fewShots, userMessageTemplate };
}

// Load once at module init. Throws here if artifact is malformed —
// fail fast, before any caller tries to use the engine.
const PROMPT_ARTIFACT = loadPromptArtifact();

// ── Module-init sanity checks ─────────────────────────────────────────────────
// PROMPT_ARTIFACT was already loaded above — this just confirms it's well-formed
// before any caller invokes the engine. If this throws, the deploy should fail
// rather than serve broken drafts.
if (!PROMPT_ARTIFACT.systemPrompt || PROMPT_ARTIFACT.systemPrompt.length < 100) {
    throw new Error('outreach_engine: system prompt extracted from outreach_system.md is suspiciously short');
}
if (!PROMPT_ARTIFACT.userMessageTemplate || PROMPT_ARTIFACT.userMessageTemplate.length < 50) {
    throw new Error('outreach_engine: user-message template extracted from outreach_system.md is suspiciously short');
}
if (PROMPT_ARTIFACT.fewShots.length !== 3) {
    throw new Error(`outreach_engine: expected exactly 3 few-shots, got ${PROMPT_ARTIFACT.fewShots.length}`);
}

// ── Payload formatters ────────────────────────────────────────────────────────

/**
 * Format a Brand Airtable record into the {{BRAND_PAYLOAD}} substitution value.
 * Per Section 5 contract — emits only outreach-shaping fields.
 * If a field is missing or empty, emits '(missing)'.
 */
function formatBrandPayload(brand) {
    const field = (name) => (brand[name] != null && brand[name] !== '') ? brand[name] : '(missing)';
    return [
        `Company: ${field('company_name')}`,
        `Contact: ${field('contact_name')}`,
        `Niche: ${field('niche')}`,
        `Status: ${field('status')}`,
        `Context notes: ${field('context_notes')}`
    ].join('\n');
}

/**
 * Format a Creator (Influencer) Airtable record into the {{CREATOR_PAYLOAD}}
 * substitution value. Per Section 5 contract — emits only outreach-shaping fields.
 * Excludes quote_terms, engagement_rate, email_invalid, discovery_source,
 * inbound_flag, placement_history — these are not outreach-shaping fields.
 */
function formatCreatorPayload(creator) {
    const field = (name) => (creator[name] != null && creator[name] !== '') ? creator[name] : '(missing)';
    return [
        `Name: ${field('name')}`,
        `Niche: ${field('niche')}`,
        `Subscriber count: ${field('subscriber_count')}`,
        `Avg views: ${field('avg_views')}`,
        `Channel URL: ${field('channel_url')}`,
        `Rate range: ${field('rate_range')}`,
        `Roster eligibility: ${field('roster_eligibility')}`,
        `Delivery reliability evidence: ${field('delivery_reliability_evidence')}`,
        `Context notes: ${field('context_notes')}`
    ].join('\n');
}

// ── Few-shot assembly ─────────────────────────────────────────────────────────

/**
 * Convert the parsed few-shots into a synthetic message history that primes
 * the model on correct tool-use behavior (voice, calibration, output shape).
 *
 * Each few-shot becomes a (user → assistant → user[tool_result]) triplet.
 * The assistant turn is a tool_use block calling outreach_draft with the
 * example output. The tool_result acknowledges it so the conversation is
 * well-formed per Anthropic's API contract.
 *
 * Note on the inputContext format: the few-shots in Section 3 of
 * outreach_system.md contain both the Brand and Creator records together with
 * a web search summary, in a single pre-formatted block. For the few-shot user
 * turns, we use the inputContext as the full content of the "Brand record"
 * section and strip the Creator-record section placeholder from the template.
 * This keeps the few-shots semantically aligned with real calls without
 * requiring Section 3 to be re-formatted.
 *
 * If this regex strip proves brittle in practice, the fallback is to revisit
 * Section 3's input-context format and split each few-shot input into separate
 * Brand record / Creator record blocks — flagged per B.5 note.
 */
function fewShotsAsMessages(fewShots, userMessageTemplate, taskInstruction) {
    const messages = [];

    for (const shot of fewShots) {
        // Synthetic user turn: the few-shot input context, rendered through the
        // user-message template so the model sees consistent structure across
        // few-shots and the real call.
        //
        // The few-shot inputContext already contains both Brand and Creator data
        // in a single merged block, so we:
        //   1. Replace {{BRAND_PAYLOAD}} with the inputContext block.
        //   2. Strip the "## Creator record\n\n{{CREATOR_PAYLOAD}}" section
        //      heading + placeholder (the content is already in the inputContext).
        //   3. Replace {{TASK_INSTRUCTION}} with the task instruction.
        const fewShotUserMessage = userMessageTemplate
            .replace('{{BRAND_PAYLOAD}}', shot.inputContext)
            .replace(/## Creator record\s*\n\n\{\{CREATOR_PAYLOAD\}\}/, '')
            .replace('{{TASK_INSTRUCTION}}', taskInstruction);

        // Compute a stable synthetic tool_use id for this few-shot position.
        // Using the message index at the point this turn is pushed.
        const toolUseId = `toolu_fewshot_${messages.length}`;

        messages.push({ role: 'user', content: fewShotUserMessage });

        // Synthetic assistant turn: a tool_use block with the example output.
        messages.push({
            role: 'assistant',
            content: [
                {
                    type: 'tool_use',
                    id: toolUseId,
                    name: OUTREACH_DRAFT_TOOL.name,
                    input: shot.output
                }
            ]
        });

        // Required: a tool_result for the synthetic tool_use, so the
        // conversation is well-formed per Anthropic's API contract.
        messages.push({
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: toolUseId,
                    content: 'Acknowledged.'
                }
            ]
        });
    }

    return messages;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a structured outreach draft for a brand–creator pair.
 *
 * Fetches the Brand and Creator records from Airtable, assembles the
 * few-shot priming turns + final user message from outreach_system.md,
 * fills in substitution tokens, and calls chatCompletion() with the
 * outreach_draft tool schema enforced. Returns the structured draft.
 *
 * @param {string} brandId - Airtable record ID for the Brand.
 * @param {string} creatorId - Airtable record ID for the Influencer (Creator).
 * @param {Object} [options]
 * @param {string} [options.taskInstruction] - Override the default task instruction.
 *   Default: the production-default string defined in Section 5 of outreach_system.md.
 *
 * @returns {Promise<{
 *   draft: object,                    // the outreach_draft tool input
 *   usage: { inputTokens: number, outputTokens: number },
 *   searchQueriesRun: string[],
 *   meta: { brandId, creatorId, modelUsed, generatedAt }
 * }>}
 *
 * Brief 12 consumes this. Nothing else does in the Brief 9b commit.
 */
export async function generateOutreachDraft(brandId, creatorId, options = {}) {
    // ── Fetch records ─────────────────────────────────────────────────────────
    const [brandRecords, creatorRecords] = await Promise.all([
        fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`),
        fetchRecords(influencersTable, `RECORD_ID() = '${creatorId}'`)
    ]);

    if (brandRecords.length === 0) {
        throw new Error(`generateOutreachDraft: brand ${brandId} not found`);
    }
    if (creatorRecords.length === 0) {
        throw new Error(`generateOutreachDraft: creator ${creatorId} not found`);
    }

    const brand = brandRecords[0];
    const creator = creatorRecords[0];

    // ── Eligibility soft-check ────────────────────────────────────────────────
    // Per Section 5 contract: if roster_eligibility is anything other than
    // 'active', soft-warn and flag the output. The call still proceeds;
    // the operator dashboard surfaces the concern.
    const eligibilityConcern =
        creator.roster_eligibility &&
        creator.roster_eligibility !== 'active';

    // ── Resolve task instruction ──────────────────────────────────────────────
    const defaultTaskInstruction =
        'Write the outreach email to the brand contact named in the Brand record above, proposing the creator above as the matched component of a deal framework. Follow all system prompt instructions. Return the structured object through the `outreach_draft` tool.';
    const taskInstruction = options.taskInstruction || defaultTaskInstruction;

    // ── Build the final user message ──────────────────────────────────────────
    const finalUserMessage = PROMPT_ARTIFACT.userMessageTemplate
        .replace('{{BRAND_PAYLOAD}}', formatBrandPayload(brand))
        .replace('{{CREATOR_PAYLOAD}}', formatCreatorPayload(creator))
        .replace('{{TASK_INSTRUCTION}}', taskInstruction);

    // Defensive check: fail loud if any substitution token survived.
    // Per Section 5 failure modes: a {{ or }} reaching the API is a
    // programming bug and should not silently degrade output quality.
    const leftoverToken = finalUserMessage.match(/\{\{[A-Z_]+\}\}/);
    if (leftoverToken) {
        throw new Error(`outreach_engine: unsubstituted token ${leftoverToken[0]} in final user message — this is a loader bug`);
    }

    // ── Assemble full messages array ──────────────────────────────────────────
    // Few-shot priming turns first, then the real user message.
    const messages = [
        ...fewShotsAsMessages(PROMPT_ARTIFACT.fewShots, PROMPT_ARTIFACT.userMessageTemplate, taskInstruction),
        { role: 'user', content: finalUserMessage }
    ];

    // ── Call the hardened wrapper ─────────────────────────────────────────────
    const result = await chatCompletion({
        systemMessage: PROMPT_ARTIFACT.systemPrompt,
        messages,
        tool: OUTREACH_DRAFT_TOOL,
        webSearch: { enabled: true, maxUses: 2 }
    });

    // ── Post-process: inject eligibility flag if applicable ───────────────────
    if (eligibilityConcern && !result.toolInput.flags.includes('creator_record_eligibility_concern')) {
        result.toolInput.flags.push('creator_record_eligibility_concern');
    }

    return {
        draft: result.toolInput,
        usage: result.usage,
        searchQueriesRun: result.searchQueriesRun,
        meta: {
            brandId,
            creatorId,
            modelUsed: 'claude-sonnet-4-6',
            generatedAt: new Date().toISOString()
        }
    };
}
