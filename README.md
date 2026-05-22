# Influencer Brokerage OS

Internal operating system for influencer-brand sponsorship brokerage.

## Architecture

- `src/server.js` — Express server (deployed to Render). Handles webhooks (Stripe, PandaDoc, SendGrid Inbound), dashboard, roster portal.
- `src/skills/` — Daemons and operator scripts. Run locally.
- `src/utils/` — Shared utilities (Airtable, logging, niche helpers).
- `config/niches.json` — Parent-child niche taxonomy.

## Local development

```bash
npm install
npm start
```

Requires `.env` with API keys for Airtable, SendGrid, Stripe, PandaDoc, and (post-Brief 2b) Anthropic.

## Deployment

`server.js` deploys to Render via GitHub. Daemons run locally on operator machine.
