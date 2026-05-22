import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';
import { dealsTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PANDADOC_API_KEY = process.env.PANDADOC_API_KEY;
const BRAND_TEMPLATE_ID = process.env.PANDADOC_BRAND_TEMPLATE_ID;
const INFLUENCER_TEMPLATE_ID = process.env.PANDADOC_INFLUENCER_TEMPLATE_ID;

const pandaDocClient = axios.create({
    baseURL: 'https://api.pandadoc.com/public/v1',
    headers: {
        'Authorization': `API-Key ${PANDADOC_API_KEY}`,
        'Content-Type': 'application/json'
    }
});

export async function generateContracts() {
    if (!PANDADOC_API_KEY) {
        console.warn("PandaDoc API Key not found. Skipping contract generation.");
        return;
    }

    const deals = await fetchRecords(dealsTable, "status = 'DEAL_LOCKED'");

    for (const deal of deals) {
        console.log(`Generating contracts for Deal: ${deal.id}`);

        let terms = {};
        try { if (deal.quote_terms) terms = JSON.parse(deal.quote_terms); } catch(e) {}
        
        const broker_fee = deal.agreed_rate ? Math.round(Number(deal.agreed_rate) * 0.15) : 0;

        const variables = [
            { name: "agreed_rate", value: deal.agreed_rate?.toString() || "" },
            { name: "deliverables_description", value: terms.deliverable_type || deal.deliverables || "" },
            { name: "post_deadline", value: terms.timeline || "" },
            { name: "exclusivity_clause", value: terms.exclusivity_window ? "Yes" : "No" },
            { name: "usage_rights", value: terms.usage_rights || "None" },
            { name: "revision_limit", value: terms.revision_allowance?.toString() || "1" },
            { name: "broker_fee", value: broker_fee.toString() },
            { name: "contract_date", value: new Date().toISOString().split('T')[0] }
        ];

        try {
            const documentIds = [];

            // Generate Brand Agreement
            if (BRAND_TEMPLATE_ID) {
                const brandRes = await pandaDocClient.post('/documents', {
                    name: `Brand Agreement - Deal ${deal.id}`,
                    template_uuid: BRAND_TEMPLATE_ID,
                    recipients: [{ email: "brand_contact@placeholder.com", first_name: "Brand", last_name: "Contact", role: "Signer" }],
                    tokens: variables
                });
                documentIds.push(brandRes.data.id);
                
                // Send immediately (in a real app, you wait for draft completion webhook first, but we simulate here)
                await new Promise(r => setTimeout(r, 3000));
                await pandaDocClient.post(`/documents/${brandRes.data.id}/send`, { silent: false });
            }

            // Generate Influencer Agreement
            if (INFLUENCER_TEMPLATE_ID) {
                const infRes = await pandaDocClient.post('/documents', {
                    name: `Influencer Agreement - Deal ${deal.id}`,
                    template_uuid: INFLUENCER_TEMPLATE_ID,
                    recipients: [{ email: "influencer@placeholder.com", first_name: "Influencer", last_name: "Creator", role: "Signer" }],
                    tokens: variables
                });
                documentIds.push(infRes.data.id);

                await new Promise(r => setTimeout(r, 3000));
                await pandaDocClient.post(`/documents/${infRes.data.id}/send`, { silent: false });
            }

            // Update Deal
            await updateRecord(dealsTable, deal.id, {
                status: 'CONTRACT_SENT',
                contract_sent_date: new Date().toISOString().split('T')[0],
                pandadoc_doc_id: documentIds.join(',')
            });

            logActivity('contract_generator', deal.id, 'CONTRACTS_SENT', 'DEAL_LOCKED', 'CONTRACT_SENT');
            console.log(`Contracts sent for Deal ${deal.id}`);

        } catch (error) {
            console.error(`Failed to generate contracts for Deal ${deal.id}:`, error.response?.data || error.message);
        }
    }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    generateContracts().then(() => console.log('Contract generation run complete.'));
}
