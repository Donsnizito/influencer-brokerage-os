import dotenv from 'dotenv';
import path from 'path';
import { pathToFileURL } from 'url';
import { dealsTable, brandsTable, influencersTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';
import { logError, Tiers } from '../utils/errorHandler.js';
import { pandaDocClient } from '../utils/pandadoc_client.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const PANDADOC_API_KEY = process.env.PANDADOC_API_KEY;
const BRAND_TEMPLATE_ID = process.env.PANDADOC_BRAND_TEMPLATE_ID;
const INFLUENCER_TEMPLATE_ID = process.env.PANDADOC_INFLUENCER_TEMPLATE_ID;

export async function generateContracts() {
    if (!PANDADOC_API_KEY) {
        console.warn("PandaDoc API Key not found. Skipping contract generation.");
        return;
    }

    const deals = await fetchRecords(dealsTable, "status = 'DEAL_LOCKED'");

    for (const deal of deals) {
        console.log(`Generating contracts for Deal: ${deal.id}`);

        const brandId = Array.isArray(deal.brand_id) ? deal.brand_id[0] : deal.brand_id;
        const brands = await fetchRecords(brandsTable, `RECORD_ID() = '${brandId}'`);
        if (brands.length === 0) {
            logError(Tiers.HIGH, 'contract_generator', `Brand not found for Deal ${deal.id}`, { brand_id: brandId });
            continue;
        }
        const brand = brands[0];

        const infId = Array.isArray(deal.influencer_id) ? deal.influencer_id[0] : deal.influencer_id;
        const influencers = await fetchRecords(influencersTable, `RECORD_ID() = '${infId}'`);
        if (influencers.length === 0) {
            logError(Tiers.HIGH, 'contract_generator', `Influencer not found for Deal ${deal.id}`, { influencer_id: infId });
            continue;
        }
        const influencer = influencers[0];

        if (!brand.contact_email || !brand.contact_email.includes('@')) {
            logError(Tiers.HIGH, 'contract_generator', `Invalid brand email for Deal ${deal.id}`, { email: brand.contact_email });
            continue;
        }
        if (!influencer.email || !influencer.email.includes('@')) {
            logError(Tiers.HIGH, 'contract_generator', `Invalid influencer email for Deal ${deal.id}`, { email: influencer.email });
            continue;
        }

        let terms = {};
        try { if (deal.quote_terms) terms = JSON.parse(deal.quote_terms); } catch(e) {}
        
        const broker_fee = deal.agreed_rate ? Math.round(Number(deal.agreed_rate) * 0.15) : 0;

        const today = new Date().toISOString().split('T')[0];
        const variables = [
            { name: "Brand.Name", value: brand.company_name || "" },
            { name: "Brand.ContactEmail", value: brand.contact_email || "" },
            { name: "Creator.Name", value: influencer.name || "" },
            { name: "Creator.Email", value: influencer.email || "" },
            { name: "Creator.ChannelURL", value: influencer.channel_url || "" },
            { name: "Deal.AgreedRate", value: deal.agreed_rate != null ? String(deal.agreed_rate) : "" },
            { name: "Deal.Deliverables", value: terms.deliverable_type || deal.deliverables || "" },
            { name: "Deal.ID", value: deal.deal_id || "" },
            { name: "Agreement.Date", value: today }
        ];

        try {
            const documentIds = [];

            // Generate Brand Agreement
            if (BRAND_TEMPLATE_ID) {
                const brandRes = await pandaDocClient.post('/documents', {
                    name: `Brand Agreement - Deal ${deal.id}`,
                    template_uuid: BRAND_TEMPLATE_ID,
                    recipients: [{
                        email: brand.contact_email,
                        first_name: brand.contact_name?.split(' ')[0] || 'Brand',
                        last_name: brand.contact_name?.split(' ').slice(1).join(' ') || 'Contact',
                        role: process.env.PANDADOC_BRAND_ROLE || "Client"
                    }],
                    tokens: variables
                });
                documentIds.push(brandRes.data.id);
            }

            // Generate Influencer Agreement
            if (INFLUENCER_TEMPLATE_ID) {
                const infRes = await pandaDocClient.post('/documents', {
                    name: `Influencer Agreement - Deal ${deal.id}`,
                    template_uuid: INFLUENCER_TEMPLATE_ID,
                    recipients: [{
                        email: influencer.email,
                        first_name: influencer.name?.split(' ')[0] || 'Creator',
                        last_name: influencer.name?.split(' ').slice(1).join(' ') || '',
                        role: process.env.PANDADOC_INFLUENCER_ROLE || "Client"
                    }],
                    tokens: variables
                });
                documentIds.push(infRes.data.id);
            }

            // Update Deal
            await updateRecord(dealsTable, deal.id, {
                contract_state: 'DRAFTING',
                contract_drafted_date: new Date().toISOString().split('T')[0],
                pandadoc_doc_id: documentIds.join(',')
            });

            logActivity('contract_generator', deal.id, 'CONTRACTS_DRAFTED', 'DEAL_LOCKED', 'DRAFTING');
            console.log(`Contracts drafted for Deal ${deal.id}`);

        } catch (error) {
            console.error(`Failed to generate contracts for Deal ${deal.id}:`, error.response?.data || error.message);
        }
    }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    generateContracts().then(() => console.log('Contract generation run complete.'));
}
