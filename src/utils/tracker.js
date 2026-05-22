import fs from 'fs';
import path from 'path';

const TRACKER_FILE = path.resolve(process.cwd(), 'data', 'outreach_tracker.json');

// Ensure data directory exists
const dir = path.dirname(TRACKER_FILE);
if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
}

function loadTracker() {
    if (!fs.existsSync(TRACKER_FILE)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
    } catch (e) {
        console.error("Error reading tracker file, resetting:", e.message);
        return {};
    }
}

function saveTracker(data) {
    try {
        fs.writeFileSync(TRACKER_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
        console.error("Failed to save tracker file:", e.message);
    }
}

export function getTrackingInfo(id) {
    const tracker = loadTracker();
    return tracker[id] || { last_contacted: null, follow_up_count: 0 };
}

export function updateTrackingInfo(id, info) {
    const tracker = loadTracker();
    tracker[id] = {
        ...(tracker[id] || { last_contacted: null, follow_up_count: 0 }),
        ...info
    };
    saveTracker(tracker);
}
