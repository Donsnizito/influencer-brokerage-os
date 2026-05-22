import fs from 'fs';
import path from 'path';

const ERROR_LOG_FILE = path.resolve(process.cwd(), 'logs', 'error_log.jsonl');

export const Tiers = {
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL'
};

export function logError(tier, source, message, context = {}) {
    const entry = {
        timestamp: new Date().toISOString(),
        tier,
        source,
        message,
        context
    };

    // Ensure logs directory exists
    const logDir = path.dirname(ERROR_LOG_FILE);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    fs.appendFileSync(ERROR_LOG_FILE, JSON.stringify(entry) + '\n');

    switch (tier) {
        case Tiers.LOW:
            // Ignore / debug noise
            break;
        case Tiers.MEDIUM:
            // Track, no alerts
            console.log(`[MEDIUM] ${source}: ${message}`);
            break;
        case Tiers.HIGH:
            // Alert required (Operational risk affecting deals)
            console.error(`🚨 [HIGH ALERT] ${source}: ${message}`, context);
            // In a real system, trigger Slack/Discord webhook here
            break;
        case Tiers.CRITICAL:
            // System-breaking failures (Stop process)
            console.error(`💥 [CRITICAL FAILURE] ${source}: ${message}`, context);
            console.error("Halting process to protect revenue flow.");
            process.exit(1);
    }
}
