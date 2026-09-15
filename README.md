# Influencer Brokerage OS

Internal operating system for influencer-brand sponsorship brokerage.

1. SYSTEM IDENTITY & CURRENT STATE
What it is: An AI-native enforcement and execution platform for creator deals and marketing campaigns (§0.5). The operator (alamir / GitHub: Donsnizito) runs the system. The platform discovers brands and curates a creator roster, runs intelligence-led outreach, classifies inbound replies via LLM, presents a deal-framework-first portal where the brand self-selects from curated creators or imports their own (BYOC), generates contracts, collects payment ($2K/mo subscription + 3.6% campaign fee), disburses creator payouts under brand-configured enforcement rules, and surfaces compliance and escalation state to both sides during the campaign lifecycle.

Repo: github.com/Donsnizito/influencer-brokerage-os (private) Local path: C:\Users\Shadow\.gemini\antigravity\scratch\influencer-agency Deployment: Render Web Service (free tier) at https://influencer-brokerage-os.onrender.com Stack: Node.js v18+ (ESM only), Express, Airtable (primary DB), SendGrid (outbound + Inbound Parse), Anthropic Claude Sonnet 4.6 (claude-sonnet-4-6), PandaDoc (contracts), Stripe (LIVE mode, invoicing/payments + payment_intent.succeeded lock pipeline), Apify (lead discovery — superseded; see §6).

Verified-and-running [VERBATIM]: Transactional spine end-to-end — contract generation → signing → invoice → payment → operator payout alert → confirm → CAMPAIGN_LIVE — tested over 14 hours with real PandaDoc contracts, a real Stripe test payment, and a real operator alert email. Committed, deployed, live. The 2026-05-29 threat audit confirms: "the spine is solid: Stripe / PandaDoc / Airtable / SendGrid webhook plumbing, idempotency, contract generation, and payment flow are all correct and commercial-grade."

Where the threats cluster [AUDIT]:

The /api/deals FK-read bug hiding all deal data (Brief 6 — FIXED 2026-05-29).
The outreach layer has no LLM / draft / operator-gate integration yet (Brief 12 builds).
The dashboard is a read-only Kanban with stub action handlers (Brief 15 rebuilds).
Where the strategic gaps cluster (post-2026-05-30): 4. The compliance object replacing view_guarantee does not yet exist in the schema (Brief 7b adds). 5. The brand- and creator-facing surfaces required by Decisions B, C, D, and E do not exist beyond the scaffolded views/roster.html (Briefs 15b/15c/15d build). 6. The AI support + structured escalation interface (Decision C) is net-new and unscoped in the original build sequence (Brief 15d builds).

Current data state: Clean zero baseline (Brief 4 wiped all Influencer/Brand/Deal records; WebhookEvents preserved). Stripe in LIVE mode. [DECISION/history]

## Local development

```bash
npm install
npm start
```

Requires `.env` with API keys for Airtable, SendGrid, Stripe, PandaDoc, and (post-Brief 2b) Anthropic.

## Deployment

`server.js` deploys to Render via GitHub. Daemons run locally on operator machine.

2. ARCHITECTURE MAP
Source: an architecture report that PASSED 5-point verification [REPORT], cross-checked against verbatim server.js, payment_handler.js, pre_launch_diagnostic.js [VERBATIM], refined by the 2026-05-29 senior-engineer threat audit [AUDIT], and extended by the 2026-05-30 strategic decisions (which add net-new components, marked [NEW 2026-05-30]). File bodies tagged [REPORT] should be read verbatim before being modified.

influencer-agency/
├── diagnostic.js                 (root audit script — HAS LATENT BUG, see §6)
├── package.json                  ("type":"module", ESM-only)
├── config/
│   ├── deal_stages.json          [AUDIT: defined, DEAL_INITIATED missing for brands — non-blocking]
│   ├── negotiation_policy.json   (read by follow_up_engine.js; policy fields not yet consumed)
│   ├── niches.json               (THE taxonomy — verbatim in §4.3)
│   └── pricing.json              [AUDIT: tiered fees defined, NOT consumed by code — see §6/§7]
├── contracts/                    (.txt templates — NOT read by code; PandaDoc cloud templates used instead)
├── dashboard/
│   ├── app.js                    [AUDIT: stub action handlers — see §6]
│   ├── index.html                (Kanban shell)
│   └── index.css
├── data/                         (csv + ingest drop-zones + logs)
├── email_templates/              (8 .txt outreach/followup templates — superseded by Brief 12)
├── logs/                         (activity_log.jsonl, error_log.jsonl)
├── scripts/                      (one-shot operator utilities — see §3.4)
├── skills/                       (markdown SPEC files only — NOT code)
└── src/
    ├── server.js                 [VERBATIM] entry point, all webhooks, roster portal, dashboard API
    ├── views/
    │   ├── roster.html           (current scaffolding — superseded by full brand portal, Brief 15b)
    │   └── [planned: brand_portal/, creator_portal/, escalation/]   [NEW 2026-05-30]
    ├── utils/
    │   ├── airtable.js           [CLEAN — Brief 14 added complianceEventsTable + unresolvedPaymentsTable]
    │   ├── disposable_domains.js [CLEAN per AUDIT]
    │   ├── errorHandler.js       [CLEAN per AUDIT]
    │   ├── llm.js                [AUDIT: chatCompletion() dead, no JSON guard — see §6]
    │   ├── logger.js             [CLEAN per AUDIT]
    │   ├── niches.js             [CLEAN per AUDIT]
    │   ├── notifications.js      [VERBATIM — Brief 12; sendOutreachEmail — Brief 14 extends via import for unresolved-payment alerts]
    │   ├── pandadoc_client.js    [CLEAN per AUDIT]
    │   ├── pandadoc_signature.js [CLEAN per AUDIT] HMAC-SHA256 verify
    │   ├── sendgrid_signature.js [CLEAN per AUDIT] ECDSA via SDK
    │   ├── tracker.js            [AUDIT: in-file, ephemeral on Render — see §6]
    │   └── webhook_idempotency.js[CLEAN per AUDIT]
    └── skills/
        ├── brand_outreach.js     [DELETED — Brief 12]
        ├── brand_scout.js        [CLEAN per AUDIT]
        ├── campaign_tracker.js   [CLEAN per AUDIT]
        ├── compliance_engine.js  [VERBATIM — NEW Brief 14; pure derivation: validateLockedSpec + deriveDealState + checkDay30Eligibility]
        ├── contract_generator.js [VERBATIM — EXTENDED Brief 14; dual-path (dealId-targeted + legacy batch-poll); compliance_spec merge tokens; doc ID writes]
        ├── escalation_router.js  [PLANNED — Brief 15d — routes triggers, tracks SLA, surfaces in dashboard]   [NEW 2026-05-30]
        ├── follow_up_engine.js   [AUDIT: rec.name vs company_name bug — see §6]
        ├── influencer_outreach.js[DELETED — Brief 12]
        ├── ingest_sprint.js      [CLEAN per AUDIT]
        ├── micro_daemon.js       [AUDIT: retired]
        ├── negotiation_handler.js[VERBATIM — Brief 13 done; ~330 lines]
        ├── outreach_orchestration.js [VERBATIM — Brief 12]
        ├── outreach_send.js      [VERBATIM — Brief 12]
        ├── payment_handler.js    [VERBATIM — EXTENDED Brief 14; release80Percent + release20Percent + sendOperatorAlertForUnresolvedPayment added]
        ├── scoring_engine.js     [VERBATIM — Brief 11]
        ├── support_assistant.js  [PLANNED — Brief 15d — AI support, bounded read-only, handoff triggers]   [NEW 2026-05-30]
        ├── lead_discovery/       [REPORT] superseded; reusable utils noted in §5.2
    ├── lib/                      [NEW — Brief 13]
    │   └── email_headers.js      [VERBATIM — Brief 13; pure header parse utility, no negotiation logic]
    └── prompts/                  [NEW — Brief 9a]
        ├── outreach_system.md    [VERBATIM — Brief 9a]
        └── negotiation_system.md [VERBATIM — Brief 13]
├── docs/                         [NEW — Brief 14]
│   ├── compliance_spec_schema.md [NEW — Brief 14 — JSON schema integration contract for compliance_spec]
│   └── pandadoc_merge_tokens.md  [NEW — Brief 14 — PandaDoc token naming convention, Brief 15b/15c/16 contract]
