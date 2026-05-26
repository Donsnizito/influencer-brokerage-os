import dotenv from 'dotenv';
dotenv.config();

import { influencersTable, brandsTable, dealsTable, webhookEventsTable } from '../src/utils/airtable.js';

const PUBLIC_SERVER_URL = process.env.PUBLIC_SERVER_URL || 'https://influencer-brokerage-os.onrender.com';

const checks = [];

function addCheck(id, name, logic) {
    checks.push({ id, name, logic });
}

// [1] Stripe webhook endpoint URL
addCheck(1, 'Stripe webhook endpoint URL', async () => {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return { status: 'FAIL', detail: 'STRIPE_SECRET_KEY missing', remediation: 'Add to .env' };
    
    const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check Stripe key' };
    const data = await res.json();
    const endpoint = data.data.find(e => e.url === `${PUBLIC_SERVER_URL}/webhooks/stripe`);
    if (!endpoint) return { status: 'FAIL', detail: 'Webhook endpoint not found', remediation: 'Add endpoint in Stripe Dashboard' };
    if (endpoint.status !== 'enabled') return { status: 'FAIL', detail: 'Endpoint is disabled', remediation: 'Enable in Stripe Dashboard' };
    
    const hasRequiredEvent = endpoint.enabled_events.includes('invoice.paid') || endpoint.enabled_events.includes('invoice_payment.paid') || endpoint.enabled_events.includes('*');
    if (!hasRequiredEvent) return { status: 'FAIL', detail: 'Missing required events', remediation: 'Add invoice.paid to subscription' };
    return { status: 'PASS' };
});

// [2] PandaDoc webhook subscription URL
addCheck(2, 'PandaDoc webhook subscription URL', async () => {
    const key = process.env.PANDADOC_API_KEY;
    if (!key) return { status: 'FAIL', detail: 'PANDADOC_API_KEY missing', remediation: 'Add to .env' };
    const res = await fetch('https://api.pandadoc.com/public/v1/webhook-subscriptions', {
        headers: { 'Authorization': `API-Key ${key}` },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check PandaDoc API key' };
    const data = await res.json();
    const subs = Array.isArray(data) ? data : (data.items || data.results || data.data || data['webhook-subscriptions'] || []);
    const sub = subs.find(s => s.url === `${PUBLIC_SERVER_URL}/webhooks/pandadoc`);
    if (!sub) return { status: 'FAIL', detail: 'Webhook subscription not found', remediation: 'Configure in PandaDoc Dev Center' };
    if (!sub.active && sub.status !== 'active') return { status: 'FAIL', detail: 'Subscription is not active', remediation: 'Enable in PandaDoc' };
    return { status: 'PASS' };
});

// [3] SendGrid Inbound Parse destination URL
addCheck(3, 'SendGrid Inbound Parse destination URL', async () => {
    const key = process.env.SENDGRID_API_KEY;
    if (!key) return { status: 'FAIL', detail: 'SENDGRID_API_KEY missing', remediation: 'Add to .env' };
    
    const res = await fetch('https://api.sendgrid.com/v3/user/webhooks/parse/settings', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check SendGrid key and permissions' };
    const data = await res.json();
    const settings = data.result || (Array.isArray(data) ? data : []);
    
    const setting = settings.find(s => s.url === `${PUBLIC_SERVER_URL}/webhooks/sendgrid/inbound`);
    if (!setting) return { status: 'FAIL', detail: 'Destination URL not found', remediation: 'Configure Inbound Parse in SendGrid Dashboard' };
    return { status: 'PASS' };
});

// [4] Render service responds
addCheck(4, 'Render service responds', async () => {
    try {
        const res = await fetch(PUBLIC_SERVER_URL, {
            method: 'HEAD',
            signal: AbortSignal.timeout(30000)
        });
        if (res.ok || res.status < 500) {
            return { status: 'PASS' };
        }
        return { status: 'FAIL', detail: `Service returned ${res.status}`, remediation: 'Check Render deployment status' };
    } catch (error) {
        return { status: 'FAIL', detail: `Request failed: ${error.message}`, remediation: 'Check Render deployment status or PUBLIC_SERVER_URL' };
    }
});

// Helpers for Airtable
async function getOneRecord(table) {
    try {
        const records = await table.select({ maxRecords: 1 }).firstPage();
        return records[0] || null;
    } catch (e) {
        if (e.statusCode === 429) throw e;
        return null;
    }
}

async function checkSchema(table, tableStr, expectedFields) {
    const rec = await getOneRecord(table);
    if (!rec) return { status: 'N/A', detail: 'Table empty', remediation: 'Will check on next non-empty state' };
    
    const existingFields = Object.keys(rec.fields);
    const actualMissing = [];
    for (const f of expectedFields) {
        if (!existingFields.includes(f)) {
            try {
                await table.update(rec.id, { [f]: null });
            } catch (err) {
                if (err.message && err.message.includes('UNKNOWN_FIELD_NAME')) {
                    actualMissing.push(f);
                }
            }
        }
    }
    
    if (actualMissing.length > 0) {
        return { status: 'FAIL', detail: `Missing field: ${actualMissing.join(', ')}`, remediation: `Add field(s) '${actualMissing.join(', ')}' to ${tableStr} table` };
    }
    return { status: 'PASS' };
}

const requiredFields = {
    'Influencers': ['name', 'email', 'niche', 'subscriber_count', 'avg_views', 'status', 'quote_terms', 'channel_url'],
    'Brands': ['company_name', 'contact_name', 'contact_email', 'niche', 'status'],
    'Deals': ['deal_id', 'brand_id', 'influencer_id', 'status', 'agreed_rate', 'deliverables', 'quote_terms', 'pandadoc_doc_id', 'stripe_invoice_id', 'contract_state', 'contract_drafted_date', 'contract_sent_date', 'contract_signed_date', 'contract_docs_sent', 'payment_collected_date', 'payment_released_date', 'payout_status', 'payout_amount', 'payout_to_influencer_email', 'payout_to_influencer_name', 'payout_flagged_date'],
    'WebhookEvents': ['event_id', 'provider', 'event_type', 'verified', 'processed', 'received_at', 'raw_payload', 'notes']
};

// [5] Airtable schema (Influencers)
addCheck(5, 'Airtable schema (Influencers)', () => checkSchema(influencersTable, 'Influencers', requiredFields['Influencers']));
// [6] Airtable schema (Brands)
addCheck(6, 'Airtable schema (Brands)', () => checkSchema(brandsTable, 'Brands', requiredFields['Brands']));
// [7] Airtable schema (Deals)
addCheck(7, 'Airtable schema (Deals)', () => checkSchema(dealsTable, 'Deals', requiredFields['Deals']));
// [8] Airtable schema (WebhookEvents)
addCheck(8, 'Airtable schema (WebhookEvents)', () => checkSchema(webhookEventsTable, 'WebhookEvents', requiredFields['WebhookEvents']));

// [9] Critical field types
addCheck(9, 'Critical field types', async () => {
    const rec = await getOneRecord(dealsTable);
    if (!rec) return { status: 'N/A', detail: 'Deals table empty', remediation: 'Will check on next non-empty state' };
    
    const bId = rec.fields['brand_id'];
    const iId = rec.fields['influencer_id'];
    const ps = rec.fields['payout_status'];
    const pa = rec.fields['payout_amount'];
    
    const errors = [];
    if (bId !== undefined && typeof bId !== 'string') errors.push('brand_id is not string');
    if (iId !== undefined && typeof iId !== 'string') errors.push('influencer_id is not string');
    if (ps !== undefined && typeof ps !== 'string') errors.push('payout_status is not string');
    if (pa !== undefined && typeof pa !== 'number') errors.push('payout_amount is not number');
    
    if (errors.length > 0) return { status: 'FAIL', detail: errors.join(', '), remediation: 'Change field types in Airtable UI' };
    return { status: 'PASS' };
});

// [10] Field options on Single Select fields
addCheck(10, 'Field options on Single Select fields', async () => {
    const rec = await getOneRecord(dealsTable);
    if (!rec) return { status: 'N/A', detail: 'Deals table empty', remediation: 'Will check on next non-empty state' };
    
    const testString = `test_diag_${Date.now()}`;
    let failedFields = [];
    
    const testField = async (field) => {
        const origValue = rec.fields[field] || null;
        try {
            await dealsTable.update(rec.id, { [field]: testString });
            await dealsTable.update(rec.id, { [field]: origValue });
        } catch (e) {
            if (e.message && (e.message.includes('Insufficient permissions to create new select option') || e.message.includes('INVALID_VALUE_FOR_COLUMN') || e.message.includes('value is not an array of record IDs'))) {
                failedFields.push(field);
            }
        }
    };
    
    await testField('status');
    await testField('contract_state');
    await testField('payout_status');
    
    if (failedFields.length > 0) return { status: 'FAIL', detail: `Constraints on: ${failedFields.join(', ')}`, remediation: 'Convert field to Single line text' };
    return { status: 'PASS' };
});

// [11] Required env vars in local .env
addCheck(11, 'Required env vars in local .env', async () => {
    const required = [
        'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PANDADOC_API_KEY',
        'PANDADOC_WEBHOOK_SECRET', 'PANDADOC_BRAND_TEMPLATE_ID', 'PANDADOC_INFLUENCER_TEMPLATE_ID',
        'SENDGRID_API_KEY', 'SENDGRID_WEBHOOK_PUBLIC_KEY', 'ANTHROPIC_API_KEY',
        'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'OWNER_EMAIL',
        'OPERATOR_NOTIFICATION_EMAIL', 'PUBLIC_SERVER_URL'
    ];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) return { status: 'FAIL', detail: `Missing: ${missing.join(', ')}`, remediation: 'Add to .env' };
    return { status: 'PASS' };
});

// [12] PandaDoc template accessibility
addCheck(12, 'PandaDoc template accessibility', async () => {
    const key = process.env.PANDADOC_API_KEY;
    const brandId = process.env.PANDADOC_BRAND_TEMPLATE_ID;
    const infId = process.env.PANDADOC_INFLUENCER_TEMPLATE_ID;
    if (!key || !brandId || !infId) return { status: 'FAIL', detail: 'Missing env vars', remediation: 'Add keys to .env' };
    
    const checkTpl = async (id) => {
        const res = await fetch(`https://api.pandadoc.com/public/v1/templates/${id}/details`, {
            headers: { 'Authorization': `API-Key ${key}` },
            signal: AbortSignal.timeout(10000)
        });
        return res.ok;
    };
    
    const [brandOk, infOk] = await Promise.all([checkTpl(brandId), checkTpl(infId)]);
    if (!brandOk || !infOk) return { status: 'FAIL', detail: `Brand: ${brandOk}, Influencer: ${infOk}`, remediation: 'Verify template IDs' };
    return { status: 'PASS' };
});

// [13] PandaDoc role names
addCheck(13, 'PandaDoc role names', async () => {
    const key = process.env.PANDADOC_API_KEY;
    const brandId = process.env.PANDADOC_BRAND_TEMPLATE_ID;
    const infId = process.env.PANDADOC_INFLUENCER_TEMPLATE_ID;
    if (!key || !brandId || !infId) return { status: 'FAIL', detail: 'Missing env vars', remediation: 'Add keys to .env' };
    
    const getRoles = async (id) => {
        const res = await fetch(`https://api.pandadoc.com/public/v1/templates/${id}/details`, {
            headers: { 'Authorization': `API-Key ${key}` },
            signal: AbortSignal.timeout(10000)
        });
        if (!res.ok) throw new Error(`Template ${id} fetch failed`);
        const data = await res.json();
        return data.roles || [];
    };
    
    try {
        const [brandRoles, infRoles] = await Promise.all([getRoles(brandId), getRoles(infId)]);
        const expBrand = process.env.PANDADOC_BRAND_ROLE || 'Client';
        const expInf = process.env.PANDADOC_INFLUENCER_ROLE || 'Client';
        
        const actBrand = brandRoles[0]?.name;
        const actInf = infRoles[0]?.name;
        
        if (actBrand !== expBrand || actInf !== expInf) {
            return { status: 'FAIL', detail: `Brand: ${actBrand} (exp ${expBrand}), Inf: ${actInf} (exp ${expInf})`, remediation: 'Align role names' };
        }
        return { status: 'PASS' };
    } catch (e) {
        return { status: 'FAIL', detail: e.message, remediation: 'Verify templates exist' };
    }
});

// [14] Stripe mode coherence
addCheck(14, 'Stripe mode coherence', async () => {
    const key = process.env.STRIPE_SECRET_KEY || '';
    if (!key) return { status: 'FAIL', detail: 'STRIPE_SECRET_KEY missing', remediation: 'Add to .env' };
    
    const isLiveKey = key.startsWith('sk_live_');
    const isTestKey = key.startsWith('sk_test_');
    if (!isLiveKey && !isTestKey) return { status: 'FAIL', detail: 'Invalid key format', remediation: 'Verify STRIPE_SECRET_KEY' };
    
    const res = await fetch('https://api.stripe.com/v1/webhook_endpoints', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check Stripe key' };
    const data = await res.json();
    const endpoint = data.data.find(e => e.url === `${PUBLIC_SERVER_URL}/webhooks/stripe`);
    if (!endpoint) return { status: 'FAIL', detail: 'Endpoint not found', remediation: 'Add endpoint in Stripe Dashboard' };
    
    if (endpoint.livemode !== isLiveKey) {
        return { status: 'FAIL', detail: `Key is ${isLiveKey ? 'live' : 'test'} but webhook is ${endpoint.livemode ? 'live' : 'test'}`, remediation: 'Align key mode and webhook mode' };
    }
    return { status: 'PASS' };
});

// [15] SendGrid public key is set
addCheck(15, 'SendGrid public key is set', async () => {
    const pub = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    if (!pub) return { status: 'FAIL', detail: 'SENDGRID_WEBHOOK_PUBLIC_KEY missing', remediation: 'Run node scripts/setup_sendgrid_inbound_signing.js' };
    return { status: 'PASS' };
});

// [16] Outbound sender address is verified in SendGrid
addCheck(16, 'Outbound sender address is verified in SendGrid', async () => {
    const key = process.env.SENDGRID_API_KEY;
    if (!key) return { status: 'FAIL', detail: 'SENDGRID_API_KEY missing', remediation: 'Add to .env' };
    
    const sender = process.env.NEOMAIL_USER || process.env.OWNER_EMAIL || 'founder@influencer-brokerage.com';
    
    const res = await fetch('https://api.sendgrid.com/v3/verified_senders', {
        headers: { 'Authorization': `Bearer ${key}` },
        signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) {
        if (res.status === 403) return { status: 'FAIL', detail: 'Insufficient scope', remediation: 'Ensure API key has Mail Settings scope' };
        return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check SendGrid key' };
    }
    
    const data = await res.json();
    const verified = (data.results || []).find(s => s.from_email === sender);
    if (!verified) return { status: 'FAIL', detail: `Sender ${sender} not found`, remediation: 'Add in SendGrid Sender Authentication' };
    if (!verified.verified) return { status: 'FAIL', detail: `Sender ${sender} not verified`, remediation: 'Complete verification in SendGrid' };
    
    return { status: 'PASS' };
});

// [17] Anthropic API connectivity
addCheck(17, 'Anthropic API connectivity', async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { status: 'FAIL', detail: 'ANTHROPIC_API_KEY missing', remediation: 'Add to .env' };
    
    const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 10,
            messages: [{ role: 'user', content: 'ping' }]
        }),
        signal: AbortSignal.timeout(10000)
    });
    
    if (!res.ok) {
        if (res.status === 401) return { status: 'FAIL', detail: 'Invalid key', remediation: 'Rotate ANTHROPIC_API_KEY' };
        if (res.status === 404) return { status: 'FAIL', detail: 'Invalid model', remediation: 'Update model string in src/utils/llm.js' };
        if (res.status === 429) return { status: 'FAIL', detail: 'Rate limited', remediation: 'Wait 60s and re-run' };
        return { status: 'FAIL', detail: `API returned ${res.status}`, remediation: 'Check Anthropic status' };
    }
    
    return { status: 'PASS' };
});

async function run() {
    const results = [];
    
    for (const check of checks) {
        try {
            let res = await check.logic();
            results.push({ ...check, ...res });
        } catch (e) {
            if (e.name === 'TimeoutError') {
                results.push({ ...check, status: 'FAIL', detail: 'Timeout', remediation: 'Check network/API status' });
            } else if (e.statusCode === 429) {
                // Rate limit fallback (mainly for Airtable)
                await new Promise(r => setTimeout(r, 1000));
                try {
                    let res = await check.logic();
                    results.push({ ...check, ...res });
                } catch (retryErr) {
                    results.push({ ...check, status: 'FAIL', detail: 'Rate limited', remediation: 'Retry diagnostic' });
                }
            } else {
                results.push({ ...check, status: 'FAIL', detail: e.message, remediation: 'Check network error' });
            }
        }
    }
    
    const passed = results.filter(r => r.status === 'PASS').length;
    const failed = results.filter(r => r.status === 'FAIL').length;
    const na = results.filter(r => r.status === 'N/A').length;
    
    console.log("═══════════════════════════════════════════════════════");
    console.log("PRE-LAUNCH DIAGNOSTIC RESULTS");
    console.log("═══════════════════════════════════════════════════════\n");
    console.log(`SUMMARY: ${passed} passed, ${failed} failed, ${na} N/A (table empty)`);
    console.log(`Status: ${failed === 0 ? '[ALL CHECKS PASSED]' : '[ACTION REQUIRED]'}\n`);
    
    console.log("═══════════════════════════════════════════════════════");
    console.log("DETAILED REPORT");
    console.log("═══════════════════════════════════════════════════════\n");
    
    results.forEach(r => {
        let line = `[${r.id}] ${r.name} `;
        const dots = Math.max(2, 50 - line.length);
        line += '.'.repeat(dots) + ` ${r.status}`;
        console.log(line);
        if (r.status === 'FAIL') {
            if (r.detail) console.log(`    - Detail: ${r.detail}`);
            if (r.remediation) console.log(`    - Remediation: ${r.remediation}`);
            console.log("");
        } else if (r.status === 'N/A') {
            if (r.detail) console.log(`    - Note: ${r.detail}`);
            console.log("");
        }
    });
    
    console.log("═══════════════════════════════════════════════════════");
    
    process.exit(failed > 0 ? 1 : 0);
}

run();
