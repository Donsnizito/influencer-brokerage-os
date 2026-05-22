import fs from 'fs';
import path from 'path';

const nichesData = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'config', 'niches.json'), 'utf8'));

/**
 * Returns the parent niche key for a given sub-niche, or null if not found
 */
export function getParentNiche(subNiche) {
    for (const [parentKey, parentObj] of Object.entries(nichesData)) {
        if (parentObj.children && parentObj.children.includes(subNiche)) {
            return parentKey;
        }
    }
    return null;
}

/**
 * Returns the label for a parent niche key
 */
export function getParentLabel(parentKey) {
    if (nichesData[parentKey]) return nichesData[parentKey].label;
    return null;
}

/**
 * Returns array of all sub-niches under a parent, or empty array if invalid
 */
export function getChildNiches(parentNiche) {
    if (nichesData[parentNiche] && nichesData[parentNiche].children) {
        return nichesData[parentNiche].children;
    }
    return [];
}

/**
 * Returns flat array of all valid sub-niches
 */
export function getAllSubNiches() {
    let all = [];
    for (const parentObj of Object.values(nichesData)) {
        if (parentObj.children) {
            all = all.concat(parentObj.children);
        }
    }
    return all;
}

/**
 * Normalizes a raw niche string: lowercase + trim + collapse internal whitespace and hyphens to underscore
 */
export function normalizeNicheString(raw) {
    if (!raw) return '';
    return raw.toLowerCase()
              .trim()
              .replace(/[\s-]+/g, '_');
}

/**
 * Validates a normalized niche against the taxonomy.
 * Returns { valid: boolean, niche: string|null, reason: string|null }
 */
export function validateNiche(normalized) {
    const validNiches = getAllSubNiches();
    if (validNiches.includes(normalized)) {
        return { valid: true, niche: normalized, reason: null };
    }
    return { valid: false, niche: null, reason: `Niche '${normalized}' is not in the valid sub-niche set.` };
}
