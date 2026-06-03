import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
import Anthropic from '@anthropic-ai/sdk';
import { logError, Tiers } from './errorHandler.js';

export async function classifyAndExtract({ systemPrompt, userMessage, expectedSchema }) {
    if (!process.env.ANTHROPIC_API_KEY) {
        logError(Tiers.CRITICAL, 'llm', 'ANTHROPIC_API_KEY is missing');
        throw new Error('ANTHROPIC_API_KEY is missing');
    }

    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
    });

    try {
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            temperature: 0,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage }
            ]
        });

        const textResponse = response.content[0].text;
        
        try {
            return JSON.parse(textResponse);
        } catch (parseError) {
            logError(Tiers.HIGH, 'llm', 'Failed to parse JSON from LLM response', { rawResponse: textResponse });
            throw new Error(`Invalid JSON from LLM: ${parseError.message}`);
        }
    } catch (apiError) {
        logError(Tiers.HIGH, 'llm', 'Anthropic API call failed', { error: apiError.message });
        throw apiError;
    }
}

/**
 * Call Anthropic's Messages API with enforced structured output via tool-use.
 *
 * @param {Object} params
 * @param {string} params.systemMessage - The system prompt content (no markers, plain text).
 * @param {Array<{role: 'user'|'assistant', content: string|Array}>} params.messages - The conversation
 *   messages in API format. The caller is responsible for assembling few-shot turns if needed.
 * @param {Object} params.tool - The single tool the model must call.
 *   Shape: `{ name: string, description: string, input_schema: object }`.
 * @param {Object} [params.webSearch] - Optional web search config: `{ enabled: boolean, maxUses: number }`.
 *   Default: disabled.
 * @param {string} [params.model] - Override model. Default: `'claude-sonnet-4-6'`.
 * @param {number} [params.maxTokens] - Override max output tokens. Default: 4096.
 * @param {number} [params.maxRetries] - Retries on transient errors. Default: 2 (3 total attempts).
 *
 * @returns {Promise<{
 *   toolInput: object,
 *   usage: { inputTokens: number, outputTokens: number },
 *   searchQueriesRun: string[],
 *   stopReason: string
 * }>}
 *
 * @throws {Error} if the model fails to call the required tool, retries exhaust,
 *   or any non-retriable error occurs.
 */
export async function chatCompletion({
    systemMessage,
    messages,
    tool,
    webSearch,
    model,
    maxTokens,
    maxRetries
}) {
    // ── Input validation ───────────────────────────────────────────────────────
    if (!systemMessage || typeof systemMessage !== 'string' || systemMessage.trim() === '') {
        throw new Error('chatCompletion: systemMessage required');
    }
    if (!Array.isArray(messages) || messages.length === 0) {
        throw new Error('chatCompletion: messages array required');
    }
    if (
        !tool ||
        typeof tool.name !== 'string' ||
        typeof tool.description !== 'string' ||
        !tool.input_schema ||
        tool.input_schema.type !== 'object' ||
        !tool.input_schema.properties
    ) {
        throw new Error('chatCompletion: tool with name/description/input_schema required');
    }

    if (!process.env.ANTHROPIC_API_KEY) {
        logError(Tiers.CRITICAL, 'llm', 'ANTHROPIC_API_KEY is missing');
        throw new Error('ANTHROPIC_API_KEY is missing');
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── Resolved parameters ────────────────────────────────────────────────────
    const resolvedModel = model || 'claude-sonnet-4-6';
    const resolvedMaxTokens = maxTokens || 4096;
    const resolvedMaxRetries = (maxRetries !== undefined && maxRetries !== null) ? maxRetries : 2;
    const webSearchEnabled = webSearch && webSearch.enabled === true;
    const webSearchMaxUses = (webSearch && webSearch.maxUses != null) ? webSearch.maxUses : 2;

    // ── Build tools array ──────────────────────────────────────────────────────
    // The caller's tool always comes first. Web search appended if enabled.
    const tools = [tool];
    if (webSearchEnabled) {
        tools.push({
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: webSearchMaxUses
        });
    }

    // Force the model to call the caller's specific tool (enforces structured output).
    const tool_choice = { type: 'tool', name: tool.name };

    // ── Retry loop ─────────────────────────────────────────────────────────────
    const totalAttempts = resolvedMaxRetries + 1;
    let lastError = null;

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        try {
            logError(Tiers.LOW, 'llm', `chatCompletion attempt ${attempt}/${totalAttempts}`, {
                model: resolvedModel,
                tool: tool.name,
                webSearchEnabled,
                messageCount: messages.length
            });

            const response = await anthropic.messages.create({
                model: resolvedModel,
                max_tokens: resolvedMaxTokens,
                system: systemMessage,
                messages,
                tools,
                tool_choice
            });

            // ── Response handling ──────────────────────────────────────────────
            // Find the tool_use block for our caller's tool.
            const toolUseBlock = response.content.find(
                (block) => block.type === 'tool_use' && block.name === tool.name
            );

            if (!toolUseBlock) {
                // Model went off-contract — did not call the required tool.
                // Hard failure: do NOT attempt to parse text fallback.
                throw new Error(`chatCompletion: model did not call required tool ${tool.name}`);
            }

            // Collect web search queries run (for operator cost audit).
            const searchQueriesRun = [];
            if (webSearchEnabled) {
                for (const block of response.content) {
                    if (
                        block.type === 'server_tool_use' &&
                        block.name === 'web_search' &&
                        block.input &&
                        block.input.query
                    ) {
                        searchQueriesRun.push(block.input.query);
                    }
                }
            }

            // Extract usage for cost logging.
            const inputTokens = response.usage?.input_tokens ?? 0;
            const outputTokens = response.usage?.output_tokens ?? 0;

            logError(Tiers.LOW, 'llm', 'chatCompletion succeeded', {
                tool: tool.name,
                inputTokens,
                outputTokens,
                searchQueriesRun: searchQueriesRun.length,
                stopReason: response.stop_reason
            });

            return {
                toolInput: toolUseBlock.input,
                usage: { inputTokens, outputTokens },
                searchQueriesRun,
                stopReason: response.stop_reason
            };

        } catch (err) {
            // ── Error classification ───────────────────────────────────────────
            const status = err.status ?? (err.response?.status);
            const isRetriable =
                // Network-level errors
                !status ||
                err.code === 'ECONNRESET' ||
                err.code === 'ETIMEDOUT' ||
                err.code === 'ENOTFOUND' ||
                // HTTP 429 rate limit
                status === 429 ||
                // HTTP 5xx server errors
                (status >= 500 && status <= 599);

            const isNonRetriable =
                status === 400 || // bad request — programming bug
                status === 401 || // auth failure
                status === 403;   // forbidden

            if (isNonRetriable) {
                logError(Tiers.HIGH, 'llm', `chatCompletion non-retriable error (${status})`, { error: err.message });
                throw err;
            }

            // The "model did not call required tool" error is also non-retriable
            // (retrying won't change the model's behaviour without a different request).
            if (err.message && err.message.startsWith('chatCompletion: model did not call required tool')) {
                logError(Tiers.HIGH, 'llm', 'chatCompletion: model off-contract — tool not called', { tool: tool.name });
                throw err;
            }

            lastError = err;
            logError(Tiers.HIGH, 'llm', `chatCompletion retriable error on attempt ${attempt}`, { error: err.message, status });

            if (attempt < totalAttempts) {
                // Exponential backoff: 1s, 2s, 4s
                const delayMs = Math.pow(2, attempt - 1) * 1000;
                logError(Tiers.LOW, 'llm', `chatCompletion: backing off ${delayMs}ms before retry`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
        }
    }

    // Retries exhausted.
    logError(Tiers.CRITICAL, 'llm', `chatCompletion: all ${totalAttempts} attempts failed`, { error: lastError?.message });
    throw lastError ?? new Error(`chatCompletion: all ${totalAttempts} attempts failed`);
}
