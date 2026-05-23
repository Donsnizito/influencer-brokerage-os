import crypto from 'crypto';

export function verifyInboundSignature(rawBody, signatureHeader, timestampHeader, publicKey) {
    if (!publicKey) {
        console.warn('WARNING: SENDGRID_WEBHOOK_PUBLIC_KEY is missing. Skipping signature verification (soft-fail mode enabled).');
        return true;
    }

    let verified = false;

    if (signatureHeader && timestampHeader && rawBody) {
        try {
            const payload = timestampHeader + rawBody;
            const decodedSignature = Buffer.from(signatureHeader, 'base64');
            const decodedPublicKey = crypto.createPublicKey({
                key: Buffer.from(publicKey, 'base64'),
                format: 'der',
                type: 'spki'
            });

            verified = crypto.verify(
                null,
                Buffer.from(payload),
                decodedPublicKey,
                decodedSignature
            );
        } catch (err) {
            console.error('SendGrid Signature Verification Error:', err.message);
        }
    }

    if (!verified) {
        if (process.env.SENDGRID_VERIFY_STRICT === 'true') {
            return false;
        } else {
            console.warn('WARNING: Invalid SendGrid signature, but SENDGRID_VERIFY_STRICT is not true. Accepting (log-only mode).');
            return true;
        }
    }

    return true;
}
