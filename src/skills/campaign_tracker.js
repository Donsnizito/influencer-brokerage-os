import { google } from 'googleapis';
import nodemailer from 'nodemailer';
import { pathToFileURL } from 'url';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { dealsTable, fetchRecords, updateRecord } from '../utils/airtable.js';
import { logActivity } from '../utils/logger.js';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const youtube = google.youtube({ version: 'v3', auth: YOUTUBE_API_KEY });

const transporter = nodemailer.createTransport({
    host: process.env.NEOMAIL_SMTP_HOST || 'mail.neomail.com',
    port: process.env.NEOMAIL_SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.NEOMAIL_USER,
        pass: process.env.NEOMAIL_PASS
    }
});

function extractVideoId(url) {
    if (!url) return null;
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([^&]{11})/);
    return match ? match[1] : null;
}

export async function runCampaignTracker() {
    if (!YOUTUBE_API_KEY) {
        console.warn("YouTube API Key not found. Skipping tracker.");
        return;
    }

    const deals = await fetchRecords(dealsTable, "status = 'CAMPAIGN_LIVE'");

    for (const deal of deals) {
        console.log(`Checking views for Deal ${deal.id}`);

        if (!deal.youtube_video_url) {
            // Check deadline
            if (deal.post_deadline) {
                const deadline = new Date(deal.post_deadline);
                const today = new Date();
                if (today > deadline && deal.escalation_flag !== 'YELLOW') {
                    await updateRecord(dealsTable, deal.id, { escalation_flag: 'YELLOW' });
                    logActivity('campaign_tracker', deal.id, 'MISSING_URL_ESCALATION', 'CAMPAIGN_LIVE', 'CAMPAIGN_LIVE');
                    console.log(`Flagged Deal ${deal.id} YELLOW due to missing video URL past deadline.`);
                }
            }
            continue;
        }

        const videoId = extractVideoId(deal.youtube_video_url);
        if (!videoId) continue;

        try {
            const res = await youtube.videos.list({
                part: 'statistics',
                id: videoId
            });

            if (!res.data.items || res.data.items.length === 0) continue;

            const viewCount = parseInt(res.data.items[0].statistics.viewCount) || 0;
            const targetViews = parseInt(deal.view_guarantee) || 100000;

            await updateRecord(dealsTable, deal.id, { views_last_checked: viewCount });

            if (viewCount >= targetViews && !deal.campaign_complete) {
                // Goal met!
                await updateRecord(dealsTable, deal.id, {
                    status: 'CAMPAIGN_COMPLETE',
                    campaign_complete: true
                });

                logActivity('campaign_tracker', deal.id, 'GOAL_MET', 'CAMPAIGN_LIVE', 'CAMPAIGN_COMPLETE');
                console.log(`Deal ${deal.id} hit target views! (${viewCount} / ${targetViews})`);

                // Optional: Email Brand
                // if (deal.brand_contact_email) {
                //     await transporter.sendMail({...});
                // }
            } else {
                console.log(`Deal ${deal.id} views: ${viewCount} / ${targetViews}`);
            }

        } catch (error) {
            console.error(`Error checking views for Deal ${deal.id}:`, error.message);
        }
    }
}

// Run if called directly
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    runCampaignTracker().then(() => console.log('Campaign tracker run complete.'));
}
