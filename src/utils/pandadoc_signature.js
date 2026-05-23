import crypto from 'crypto';

// Verifies a PandaDoc webhook signature using HMAC-SHA256.
// Returns true if signature is valid, false otherwise.
export function verifyPandaDocSignature(rawBody, signatureHeader, secret) {
    if (!rawBody || !signatureHeader || !secret) {
        return false;
    }

    try {
        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

        // Prevent timing attacks using timingSafeEqual
        const expectedBuffer = Buffer.from(expectedSignature, 'ascii');
        const actualBuffer = Buffer.from(signatureHeader, 'ascii');

        if (expectedBuffer.length !== actualBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
    } catch (err) {
        console.error('PandaDoc Signature Verification Error:', err.message);
        return false;
    }
}
