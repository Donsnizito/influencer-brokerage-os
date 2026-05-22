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
            model: 'claude-3-7-sonnet-20250219',
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

export async function chatCompletion({ systemPrompt, userMessage }) {
    if (!process.env.ANTHROPIC_API_KEY) {
        logError(Tiers.CRITICAL, 'llm', 'ANTHROPIC_API_KEY is missing');
        throw new Error('ANTHROPIC_API_KEY is missing');
    }

    const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
    });

    try {
        const response = await anthropic.messages.create({
            model: 'claude-3-7-sonnet-20250219',
            max_tokens: 2048,
            temperature: 0.3,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userMessage }
            ]
        });

        return response.content[0].text;
    } catch (apiError) {
        logError(Tiers.HIGH, 'llm', 'Anthropic API call failed', { error: apiError.message });
        throw apiError;
    }
}
