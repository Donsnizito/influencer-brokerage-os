import { EventWebhook } from '@sendgrid/eventwebhook';
import { logError, Tiers } from './errorHandler.js';

// Header names per SendGrid Inbound Parse documentation
const SIGNATURE_HEADER = 'x-twilio-email-event-webhook-signature';
const TIMESTAMP_HEADER = 'x-twilio-email-event-webhook-timestamp';

/**
 * Verifies the SendGrid Inbound Parse webhook signature using ECDSA.
 * 
 * Behavior matrix:
 *   - No public key configured: log warning, return true (soft-fail bootstrap mode)
 *   - Public key configured, SENDGRID_VERIFY_STRICT not 'true': verify, log warnings on mismatch, return true (log-only mode)
 *   - Public key configured, SENDGRID_VERIFY_STRICT === 'true': verify, return false on mismatch (strict mode)
 * 
 * @param {Buffer|string} rawBody - The raw request body, exactly as received
 * @param {string} signatureHeader - Value of x-twilio-email-event-webhook-signature header
 * @param {string} timestampHeader - Value of x-twilio-email-event-webhook-timestamp header
 * @returns {boolean} true if the request should be processed, false to reject
 */
export function verifyInboundSignature(rawBody, signatureHeader, timestampHeader) {
    const publicKey = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    const strictMode = process.env.SENDGRID_VERIFY_STRICT === 'true';
    
    // Bootstrap mode: no key configured
    if (!publicKey) {
        console.warn('WARNING: SENDGRID_WEBHOOK_PUBLIC_KEY is missing. Skipping signature verification (soft-fail mode enabled).');
        return true;
    }
    
    // Missing signature headers
    if (!signatureHeader || !timestampHeader) {
        const message = 'SendGrid signature headers missing from request';
        if (strictMode) {
            console.warn(`[STRICT MODE REJECT] ${message}`);
            return false;
        }
        console.warn(`[LOG-ONLY MODE] ${message} — would reject in strict mode`);
        return true;
    }
    
    // Verify using SendGrid SDK
    try {
        const eventWebhook = new EventWebhook();
        const ecPublicKey = eventWebhook.convertPublicKeyToECDSA(publicKey);
        const isValid = eventWebhook.verifySignature(ecPublicKey, rawBody, signatureHeader, timestampHeader);
        
        if (!isValid) {
            const message = 'SendGrid signature mismatch';
            if (strictMode) {
                console.warn(`[STRICT MODE REJECT] ${message}`);
                return false;
            }
            console.warn(`[LOG-ONLY MODE] ${message} — would reject in strict mode`);
            return true;
        }
        
        return true;
    } catch (err) {
        logError(Tiers.HIGH, 'sendgrid_signature', 'Verification threw exception', { error: err.message });
        // On exception, behavior depends on strict mode (defensive default: reject in strict)
        return !strictMode;
    }
}
