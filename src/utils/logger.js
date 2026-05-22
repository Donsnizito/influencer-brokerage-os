import fs from 'fs';
import path from 'path';

const LOG_DIR = path.resolve('logs');
const LOG_FILE = path.join(LOG_DIR, 'activity_log.jsonl');

// Ensure log directory exists
try {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
} catch (error) {
    // Cloud environment (e.g., Render) read-only filesystem handling
}

/**
 * Logs an activity to the activity_log.jsonl file.
 * @param {string} skillName 
 * @param {string|number} dealId 
 * @param {string} action 
 * @param {string} previousState 
 * @param {string} newState 
 */
export function logActivity(skillName, dealId, action, previousState, newState) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        skill_name: skillName,
        deal_id: dealId,
        action: action,
        previous_state: previousState,
        new_state: newState
    };

    try {
        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
    } catch (error) {
        // Cloud environment (e.g., Render) read-only filesystem handling
    }
    console.log(`[${logEntry.timestamp}] [${skillName}] Action: ${action} | Deal ID: ${dealId} | State: ${previousState} -> ${newState}`);
}
