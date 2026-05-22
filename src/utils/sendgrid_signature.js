import crypto from 'crypto';

export function verifyInboundSignature(rawBody, signatureHeader, timestampHeader, publicKey) {
    if (!publicKey) {
        console.warn('WARNING: SENDGRID_WEBHOOK_PUBLIC_KEY is missing. Skipping signature verification (soft-fail mode enabled).');
        return true;
    }

    if (!signatureHeader || !timestampHeader || !rawBody) {
        return false;
    }

    try {
        const payload = timestampHeader + rawBody;
        const decodedSignature = Buffer.from(signatureHeader, 'base64');
        const decodedPublicKey = crypto.createPublicKey({
            key: Buffer.from(publicKey, 'base64'),
            format: 'der',
            type: 'spki'
        });

        return crypto.verify(
            null,
            Buffer.from(payload),
            decodedPublicKey,
            decodedSignature
        );
    } catch (err) {
        console.error('SendGrid Signature Verification Error:', err.message);
        return false;
    }
}
