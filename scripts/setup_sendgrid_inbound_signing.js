import https from 'https';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const apiKey = process.env.SENDGRID_API_KEY;

if (!apiKey) {
    console.error('ERROR: SENDGRID_API_KEY environment variable is not set.');
    process.exit(1);
}

const hostname = 'inbound.wellsplusdaily.com';

async function fetchSendGrid(method, endpoint, body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.sendgrid.com',
            path: endpoint,
            method: method,
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try {
                    if (data) parsed = JSON.parse(data);
                } catch (e) {}
                resolve({
                    status: res.statusCode,
                    body: parsed,
                    raw: data
                });
            });
        });

        req.on('error', reject);

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function main() {
    console.log('================================================================');
    console.log('SendGrid Inbound Parse Security Policy Setup');
    console.log('================================================================');

    try {
        console.log(`Listing existing security policies for Inbound Parse...`);
        let secPolRes = await fetchSendGrid('GET', '/v3/user/webhooks/parse/security_policies');
        
        if (secPolRes.status === 404 || secPolRes.status === 403) {
            console.error(`\n[ERROR] Failed to fetch security policies. Status: ${secPolRes.status}`);
            console.error('Response:', JSON.stringify(secPolRes.body, null, 2));
            console.error('\nNOTE: Your SendGrid plan may not support this feature, or the API endpoint used in this script (/v3/user/webhooks/parse/security_policies) may be incorrect. Please check current SendGrid documentation.');
            process.exit(1);
        }

        let publicKey = '';
        let policyId = '';

        if (secPolRes.status === 200 && secPolRes.body && secPolRes.body.result && secPolRes.body.result.length > 0) {
            console.log('Found existing security policy!');
            publicKey = secPolRes.body.result[0].public_key;
            policyId = secPolRes.body.result[0].id;
        } else {
            console.log('No existing policy found. Attempting to create one...');
            const createRes = await fetchSendGrid('POST', '/v3/user/webhooks/parse/security_policies', {});
            
            if (createRes.status >= 200 && createRes.status < 300) {
                console.log('Policy created successfully.');
                publicKey = createRes.body.public_key;
                policyId = createRes.body.id;
            } else {
                console.error(`\n[ERROR] Failed to create security policy. Status: ${createRes.status}`);
                console.error('Response:', JSON.stringify(createRes.body, null, 2));
                process.exit(1);
            }
        }

        if (publicKey && policyId) {
            console.log(`Attaching policy ${policyId} to inbound host: ${hostname}...`);
            const patchRes = await fetchSendGrid('PATCH', `/v3/user/webhooks/parse/settings/${hostname}`, {
                security_policy: policyId
            });
            
            if (patchRes.status >= 200 && patchRes.status < 300) {
                console.log('Policy attached successfully.');
            } else {
                console.error(`\n[WARNING] Failed to attach policy to settings. Status: ${patchRes.status}`);
                console.error('Response:', JSON.stringify(patchRes.body, null, 2));
                console.error('You may need to manually configure the inbound parse setting in SendGrid dashboard to use the generated security policy.');
            }

            console.log('\n================================================================');
            console.log('SendGrid Inbound Parse Security Policy: SETUP COMPLETE');
            console.log('================================================================');
            console.log(`Policy ID:    ${policyId}`);
            console.log('Algorithm:    ECDSA');
            console.log(`Inbound Host: ${hostname}`);
            console.log('Destination:  https://influencer-brokerage-os.onrender.com/webhooks/sendgrid/inbound');
            console.log('\nPUBLIC KEY (add to both .env and Render env vars as SENDGRID_WEBHOOK_PUBLIC_KEY):');
            console.log('----------------------------------------------------------------');
            console.log(publicKey);
            console.log('----------------------------------------------------------------');
            console.log('\nNext steps:');
            console.log('1. Copy the public key above (including BEGIN/END markers)');
            console.log('2. Add to local .env: SENDGRID_WEBHOOK_PUBLIC_KEY="<paste here as single line, replacing actual newlines with \\n>"');
            console.log('3. Add to Render env vars (Dashboard → Environment): SENDGRID_WEBHOOK_PUBLIC_KEY (same value)');
            console.log('4. After both env vars are set, proceed with Brief 3a code verification');
            console.log('================================================================');
        }

    } catch (e) {
        console.error('Unexpected error:', e);
        process.exit(1);
    }
}

main();
