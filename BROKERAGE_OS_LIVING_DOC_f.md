# INFLUENCER BROKERAGE OS — LIVING SYSTEM DOCUMENT

> **What this is:** The single source of truth for this project. Paste this into any new conversation to transfer full context with zero loss. It is grounded in verbatim code, a verification-passed architecture report, a senior-engineer-grade threat audit, and the strategic decisions locked across the project's lifetime — not paraphrase.
>
> **How to maintain it:** Update the CHANGELOG (Section 10) after every brief, with discipline. When a file changes, update its entry and re-tag it. Never let it drift — maintain it like the repo itself: small, consistent commits of truth.
>
> **Source-tagging convention used throughout:**
> - `[VERBATIM]` — confirmed against the actual file contents (bedrock, trust fully)
> - `[REPORT]` — from a model report; cross-check before surgery
> - `[AUDIT]` — from the 2026-05-29 senior-engineer threat analysis with line numbers and evidence (trust strongly, but verify on the file before patching)
> - `[DECISION]` — a strategic/engineering decision locked by the operator
> - `[OPEN]` — unresolved, needs a decision or verification
>
>**Last updated:** 2026-06-08 (Brief 12 done — production outreach orchestration shipped, two new files with no-cross-module-import discipline, two new server routes, templated outreach files deleted resolving [AUDIT 🟡 #11]. `notifications.js` created (new util). Brief 13 next.)

---

## 0. CRITICAL OPERATING DOCTRINE (read first — the most expensive lessons learned)

### 0.1 The implementing-model-hallucinates rule
The **default** model used inside coding tools reliably fabricates structured technical detail — field names, API actor IDs, endpoint paths, response shapes, function names, causal flow. Evidence accumulated on this project: invented Apify actor behavior without verification, wrote `data.results` when PandaDoc returns `data.items`, hardcoded `"US"` when the actor wanted `"us"`, wrote to a `contact_name` field that didn't exist, invented function names (`generateStripeInvoice`, `handleStripeWebhook`), described the Stripe→contract flow backwards.

**Therefore, permanent rules:**
1. **Never trust a model's *descriptions*. Only trust its *actions on real files* — and verify even those.** When it says "I did X" or "the file does Y," the next step is always: read the actual file / run the actual command and read the output.
2. **For any external identifier (API field, actor ID, endpoint, response shape, env var, model string), assume it is wrong until proven against current docs or a real response.**
3. **For ground truth about the codebase, read the files — never accept a summary of the files.**
4. **Not all models are equal at this.** Two verified-stronger models on this project: a second-pass architecture model that passed a 5-point ground-truth verification (Stripe flow, payment_handler exports, negotiation_handler export, brand_id shape, verbatim niches.json + LLM prompt), and **Sonnet 4.6 inside the Antigravity IDE**, which produced the 2026-05-29 threat analysis (line-numbered, evidence-cited, severity-graded). Use these stronger models for inventory, mapping, and pre-flight audits. Keep weaker defaults suspect for descriptions.

### 0.2 Brief-writing discipline
- **One concern per brief.** Do not bundle. (Over-splitting into brief-per-bug is also wrong — that's ceremony. The unit is "one coherent concern.")
- **Two brief types only:**
  - **Operator task** — operator does it (Airtable schema, API keys in `.env` + Render, third-party dashboard config).
  - **Antigravity implementation brief** — runnable code, real diffs, surgery on the repo.
- **Code in implementation briefs is real, runnable code or explicitly marked `<not-implemented>`.** Never `{ ... }` placeholders — a placeholder once got pasted as literal code and broke a deploy.
- **Verify schema/field TYPES before writing code that depends on them** (Single Select vs Single Line Text caused the `PAYOUT_OWED` insertion error).
- **Webhook URL audit precedes any webhook-touching brief** (dead Make.com URLs bit Stripe and PandaDoc, twice).
- **Name exact transition states and field names** ("INVOICE_SENT → CONTRACT_SIGNED," not "reset the deal").
- **Keep engineering proportionate to stake.** The chat is scaffolding; the repo on disk / GitHub / Render is the artifact. Do not stack machine gates, queues, or verification layers where a human review already sits in the path. **When a human is already reading the output, that human is the verification step** — better than a second LLM call because they know the business. Over-isolation and over-engineering are the same failure as bundling — both ignore the whole organism.
- **Step back regularly to view the system as a whole.** The system is one organism: discovery → matching → scoring → context → outreach → reply → negotiation → contract → payment → payout → compliance → remediation. Quality leads upstream are the precondition for anything downstream mattering.

### 0.3 Standard post-brief verification checklist (for Antigravity implementation briefs)
1. `git status`
2. `grep -rn "require(" src/ scripts/` → must be empty (project is ESM-only, `"type": "module"`)
3. `grep -n "claude-" src/utils/llm.js` → must read `claude-sonnet-4-6`
4. `git add .` → `git commit` → `git push` (SEPARATE commands — PowerShell has no `&&`)
5. Confirm Render auto-redeploys to "Live" with the new commit hash
6. Functional test
7. `node scripts/pre_launch_diagnostic.js` before any synthetic test or launch

**Airtable SDK wire behavior on unwritten Long Text fields.** When a brief reads a Long Text (or any non-required) Airtable field that may not be populated on every record, the SDK omits unwritten fields from the response payload entirely — the field key is not present on the returned record object, regardless of whether the column exists in the schema. Strict key-presence checks (`'fieldname' in record`) produce false negatives on records where the field exists in the schema but has never been written to. Engine logic that reads such fields must treat "key absent" and "key present with empty value" as semantically identical (e.g., `record.fieldname ?? ''` for string fields, or `record.fieldname ?? []` for array fields) and surface the missing-value case at the field's purpose-appropriate stage, not as schema malformation. This applies retroactively to all Long Text fields in the current schema (`compliance_spec`, `compliance_status`, `creator_payout_schedule`, `escalation_events`, `delivery_reliability_evidence`, `placement_history`) and prospectively to all future Long Text additions.

**PowerShell-launched verification scripts and relative import paths.**
When a throwaway verification script is created in scripts/ via PowerShell here-string and launched with node scripts/foo.mjs, the script's ES-module imports resolve against the script's own directory, not against process.cwd(). A script in scripts/foo.mjs importing from ./src/utils/airtable.js will resolve to scripts/src/utils/airtable.js and fail with ERR_MODULE_NOT_FOUND — Node's own error message helpfully includes the correct fix ("Did you mean to import ../src/utils/airtable.js?"). The canonical patterns: (a) use ../src/... when the script is in scripts/, OR (b) use import.meta.url-anchored absolute paths (const __dirname = dirname(fileURLToPath(import.meta.url)); const SOMETHING = resolve(__dirname, '..', 'src', 'utils', 'something.js')) which works regardless of where the script lives. Pattern (b) is preferred for verification scripts that may be relocated or re-run from different working directories. Pattern (a) is fine for one-off throwaways. The trap: writing ./src/... "feels right" because you're conceptually thinking from the project root, but Node resolves from the script's own directory.

### 0.4 Environment quirks
- PowerShell: no `&&` (separate commands); `curl` aliases `Invoke-WebRequest` → use `curl.exe`; `$env:VAR` reads SYSTEM env not `.env` (paste actual values when testing locally).
- Render free tier: 15-min idle sleep, auto-wake, **ephemeral filesystem** (this matters for `tracker.js` — see §6/§7).
- Only `src/server.js` is publicly deployed; skills and scripts run locally (operator-triggered).

### 0.5 PRODUCT DEFINITION (locked 2026-05-30)

**What this brokerage actually is — the sentence the rest of the system has to serve:**

> **The brokerage is a dual-contract enforcement system between two parties (brands and creators) who do not naturally trust each other. It monetizes the function of being a credible enforcement layer at a price point ($5–15K) where neither side can credibly enforce on the other.**

The brokerage does not sell:
- Creator matching (matching is the input that makes the enforcement function economically survivable)
- Outreach (outreach is the acquisition mechanism)
- Contracts (contracts are the artifact of the enforcement function)

The brokerage sells: **enforced execution between brand and creator, with bounded and priceable operational risk on both sides.**

Every architectural decision downstream of this definition must be checked against it. If a feature does not serve the enforcement function — or worse, makes the enforcement function less visible to the parties paying for it — it does not belong in the system regardless of how interesting it is.

This definition emerged through the 2026-05-30 strategic stress-test (see §2.2 and Changelog 2026-05-30) and is the unifying frame that the §2 strategy mechanisms now serve. The mechanisms (intelligence-led outreach, curated roster, operator confirmation, deal-range doctrine) all pre-existed this frame; this frame explains what they are *for*.

### 0.6 BROKERAGE GOVERNANCE DOCTRINE (locked 2026-05-30)

Three principles that the strategy structurally depends on. These are not implementation details — they are operating disciplines that, if abandoned under pressure, cause the strategy to degrade in execution even when it looks correct on paper. They live in §0 because they are the things you forget under pressure.

**0.6.1 — Roster growth is subordinate to roster quality.**
The guarantee model (Decision A, §2.3) assumes a compliance-failure rate below ~15%. That assumption is held entirely by the curation bar on the creator roster. The first time supply-side discipline is relaxed for acquisition pressure ("they're close enough, the volume's worth it"), the strategy starts degrading invisibly until the failure rate spikes. The guarantee does not *create* this risk — the risk exists in any premium brokerage with selective inventory — but the guarantee *exposes the consequences mechanically and visibly* rather than slowly and deniably. Early-warning signal: any roster addition that wouldn't have qualified under the original bar. Pre-committed response: a written curation bar (artifact owned by Brief 18) and periodic roster audits against the bar.

**0.6.2 — Escalation path integrity is the institutional credibility test.**
Decision C (§2.5) substitutes institutional visibility for founder visibility via AI support + defined human escalation. This works in the steady state. It fails the moment the escalation path doesn't fire or doesn't respond within the committed window (Mon–Fri 7:30am–8pm EDT). The failure signal is not "we're not Don-shaped enough" but **measurable escalation-path failure** — a brand event that should have triggered escalation didn't, or did and was not handled inside the SLA. Pre-committed response: surface escalation response times in the operator dashboard as a first-class metric; have a personal-fallback ready for high-stakes situations where institutional framing isn't landing (the framing is the default, not a rule).

**0.6.3 — The enforcement function must remain legible as the product.**
The better the system works, the less visible the value becomes — brands see smooth campaigns and conclude "I could do this myself." Sophisticated creators see closed deals and conclude "I could find these brands directly." Both are wrong, but you can lose them before they realize they were wrong. The enforcement function (dual contracts, compliance object, escalation map, curation underwriting, payout discipline) must be continuously surfaced in brand- and creator-facing artifacts — not buried as features. Decision E (§2.7) is the structural answer: the process-ownership funnel as persistent visible artifact. Early-warning signal: brand churn after one or two successful campaigns ("we know how this works now"); creator pushback on the 15% fee as deals scale. Pre-committed response: portal copy, contract preambles, dashboard headers explicitly frame what is being sold ("we run a guaranteed delivery system that uses curated creators as inputs"), repeated across surfaces.

---

## 1. SYSTEM IDENTITY & CURRENT STATE

**What it is:** An AI-powered premium boutique influencer marketing brokerage operating as a **dual-contract enforcement system** (§0.5). The operator (alamir / GitHub: Donsnizito) is the broker. The system discovers brands and curates a creator roster, runs intelligence-led outreach, classifies inbound replies via LLM, presents a deal-framework-first portal where the brand self-selects from curated creators inside a bounded execution contract, generates contracts, collects payment, disburses creator payouts under a structured payout schedule, and surfaces compliance and escalation state to both sides during the campaign lifecycle. Broker takes a 15% fee (flat — `pricing.json` tiers exist but are not consumed; see §6/§7).

**Repo:** github.com/Donsnizito/influencer-brokerage-os (private)
**Local path:** `C:\Users\Shadow\.gemini\antigravity\scratch\influencer-agency`
**Deployment:** Render Web Service (free tier) at `https://influencer-brokerage-os.onrender.com`
**Stack:** Node.js v18+ (ESM only), Express, Airtable (primary DB), SendGrid (outbound + Inbound Parse), Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`), PandaDoc (contracts), Stripe (LIVE mode, invoicing/payments), Apify (lead discovery — superseded; see §6).

**Verified-and-running `[VERBATIM]`:** Transactional spine end-to-end — contract generation → signing → invoice → payment → operator payout alert → confirm → CAMPAIGN_LIVE — tested over 14 hours with real PandaDoc contracts, a real Stripe test payment, and a real operator alert email. Committed, deployed, live. The 2026-05-29 threat audit confirms: "the spine is solid: Stripe / PandaDoc / Airtable / SendGrid webhook plumbing, idempotency, contract generation, and payment flow are all correct and commercial-grade."

**Where the threats cluster `[AUDIT]`:**
1. The `/api/deals` FK-read bug hiding all deal data (Brief 6 — FIXED 2026-05-29).
2. The outreach layer has no LLM / draft / operator-gate integration yet (Brief 12 builds).
3. The dashboard is a read-only Kanban with stub action handlers (Brief 15 rebuilds).

**Where the strategic gaps cluster (post-2026-05-30):**
4. The compliance object replacing `view_guarantee` does not yet exist in the schema (Brief 7b adds).
5. The brand- and creator-facing surfaces required by Decisions B, C, D, and E do not exist beyond the scaffolded `views/roster.html` (Briefs 15b/15c/15d build).
6. The AI support + structured escalation interface (Decision C) is net-new and unscoped in the original build sequence (Brief 15d builds).

**Current data state:** Clean zero baseline (Brief 4 wiped all Influencer/Brand/Deal records; WebhookEvents preserved). Stripe in LIVE mode. `[DECISION/history]`

---

## 2. STRATEGY — LOCKED

> The 2026-05-29 frame (premium boutique, intelligence-led outreach, deal-range doctrine, operator confirmation as sanitization) is preserved and remains correct. The 2026-05-30 frame extends it: the product definition (§0.5), the trust stack (§2.2), and the five locked decisions (§2.3 through §2.7) supply the unifying theory that the existing mechanisms now serve. Nothing in the 2026-05-29 frame is overturned; everything is now in service of an explicit product.

### 2.1 The 2026-05-29 frame (preserved verbatim)

**Core model `[DECISION]`:** Premium boutique brokerage. $5–15K deals, 15% fee. Math: ~7–17 closed deals/month → $15–22K (realistic) to $25K+ profit. This needs ~1,700–3,000 *qualified* brand contacts/month, NOT 15,000 emails. Selectivity and intelligence-led outreach, not volume.

**Two separate engines `[DECISION]`:**
- **Brands = continuous pipeline via Apollo.io (locked).** Brands churn (campaigns, leadership turnover, seasons). Filter by title (Brand Manager, CMO, Head of Partnerships, Marketing Director), **company size 20–500 employees** (Nike won't answer cold email; a DTC electrolyte brand will), and niche-taxonomy keywords. **Validation tier:** free plan (~900 credits) covers a 2-niche validation pull (~100 SaaS + ~100 pet contacts). **Scale tier:** $50/mo → ~6K credits → ~3,000–4,000 qualified contacts/month after enrichment. Scale tooling only if results justify. **Indicative funnel:** 3,000 contacts → ~1% reply → ~30 warm → 25–50% close → 7–15 deals/mo × ~$9K × 15% → $15–22K+/mo from $50 in tooling.
- **Creators = curated roster, NOT a stream.** Premium creators (100K–1M followers, established, want to be found) don't churn monthly — a creator who deals in March deals again in June. Build a deep, hand-curated roster of 300–500 once, refresh quarterly. **Premium creators are publicly findable for free** — emails live on the YouTube About page, or in Linktree / Beacons / Stan Store / media-kit links. No scraping needed; the operator hand-picks. The bar: *"everything a premium brand looks for in a creator is what we look for."* The roster is a **structured intelligence record per creator**, not a contact list. Post-2026-05-30: the bar adds an explicit **delivery-reliability evidence** column (see §2.3 and Brief 18).

**Web-augmented intelligence-led outreach is the product/moat `[DECISION]`:** Every outreach is **match-then-pitch**, web-augmented at send time. Sonnet (`claude-sonnet-4-6`) **searches the web, assembles, and generates the outreach draft per send.** Boutique targets (DTC brands doing real integrations, SaaS 20–150 employees) have public footprint — this is table stakes for the model, not a stretch. What was cut is a standalone news/trigger layer, NOT web context itself. Example shape: *"Your brand makes premium senior-dog joint supplements. We have 4 creators whose audiences skew owners of aging large-breed dogs, with engagement above X."* That's intelligence, not a cold email. Post-2026-05-30: outreach drafts now point at a **deal-framework portal** (Decision B), not a creator-list portal, and signal the bounded execution structure without leading with the guarantee.

**Sanitization = operator confirmation, NOT a machine layer `[DECISION]`:** Every draft pauses in the operator dashboard — full message view, inline edit, one-button send. **The operator is the verification step** (better than a second LLM call: they know the business). No grounding contract, no separate verify call, no per-step queues — those were over-engineering, cut as ceremony.

**No `enrichment_tier` field `[DECISION]`:** Depth is emergent from what the live search returns per brand at send time. A stored "deep/standard" label is a word, not context — cut as ceremony.

**Deal-range ($5–10K sweet-spot within $5–15K band) lives in 4 places `[DECISION]`:**
1. **Matching filter** — surface only creators whose `rate_range` overlaps the band (deterministic).
2. **Scoring weight** — $5–10K scores higher in internal curation (deterministic).
3. **Negotiation instruction** — LLM nudge to converge toward the band (one LLM hook).
4. **Creator-side validation flag** — out-of-range quote is flagged (deterministic).
Three deterministic + one LLM. Brief 7 added `rate_range`; Brief 13 must inject the band into the negotiation classifier's context.

**The `context_notes` field `[DECISION]`:** Both Creator and Brand records have a free-text `context_notes` (long text) field the LLM reads for outreach color. **Hard rule: structured fields are the source of truth for anything the system computes on (matching, scoring, filtering); `context_notes` is read-only texture for the LLM and is NEVER parsed for structured data.** A creator's rate goes in the structured `rate_range` field, not buried in prose.

**First two test niches `[DECISION]`:** `ai_tech` / `ai_saas` (SaaS 20–150 employees — easy brand acquisition, mechanics-prover) and `pets` (premium 7–9 figure pet brands — richer deal economics, value-prover).

**Validation-first discipline `[DECISION]`:** (a) Hand-build deep creator + mock brand records, run the web-augmented outreach harness, READ the output — is it intelligence or dressed-up slop? This is the spike (Brief 8, done). (b) Pull ~100 Apollo contacts per niche on the free plan and inspect quality. (c) Then build the full engine around what the tests prove.

**The 4-mock full-system test `[DECISION]`:** The whole engine is validated like the transactional core was — 4 records (2 brands, 2 creators, across the 2 niches), operator-controlled emails, operator plays both sides and injects friction/varied rates, runs through to CAMPAIGN_LIVE. Real leads get injected at the end (Apollo for brands; CSV export from the curated roster for creators). **No real outreach before this passes.** Post-2026-05-30: the 4-mock test now also exercises the compliance object lifecycle, an escalation trigger, and the credit-and-replacement remediation path (see §2.3 and Brief 16).

**Retired by this strategy:** SERP-dorking brand discovery, Collabstr creator scraping (403-blocked), the 15K-volume premise, X/Twitter `micro_daemon` discovery.

**Preserved regardless of acquisition source:** the 3-layer email validation, bounce webhook, niche taxonomy, the Airtable contract, the diagnostic, and the entire verified deal/contract/payment/payout lifecycle.

### 2.2 The trust stack (locked 2026-05-30)

The 2026-05-29 frame solves acquisition and operations. It does not solve conversion at the $5–10K decision point, where the brand's real question is not "is this UI nice" or "is this creator real" but **"will my $10K produce predictable ROI or chaos."** That question is a trust problem, and trust at this price point is not solved by any single layer — it is distributed across a stack:

**H1 — Curation as underwriting.** External proof (the creator's track record, public brand-pairing history, named competitor sponsorships, audience demographics, category-validated format precedents) does *dual* work. Externally it justifies the price tag — if the brand isn't shown that this creator already delivered for comparable brands, the $10K doesn't feel earned. Internally it is **actuarial evidence** for the H3 guarantee — we only present creators whose delivery history makes the guarantee economically survivable. H1 is therefore not a marketing layer; it is a structural component of the business model.

**Operational note — scoring sensitivity vs roster size.** Brief 11's hybrid scoring is non-linear with respect to roster size. At small roster sizes (current state: 3 creators), normalization compresses the score range and individual signals (a single breach, a single completion) move scores more violently than they will at scale. A creator with one breach can fall below the curation floor entirely at 3-creator roster size; at 50+ creators (post-Brief-18) the same breach is a meaningful penalty but not annihilating. This is the spec working — the formula is correct — but operators should expect scoring behavior to feel harsher than its eventual production behavior during the pre-Brief-18 window. **Weight tuning is deferred until Brief 18 produces a representative roster.** During the early window, if a trusted creator falls below the floor due to small-roster sensitivity, the operator-correct response is editing `placement_history` source data (the underlying signal) rather than routing around the scoring formula (which would corrode the §2.2 H1 underwriting frame).

**H2 — Institutional visibility.** No founder personal branding. The substitute is institutional posture: AI support always-on for routine queries, a defined human escalation window (Mon–Fri 7:30am–8pm EDT) with defined triggers and response SLA. The brand does not need Don; the brand needs **confidence that a responsible human exists behind the system** and can be reached when something matters. The escalation map is the credibility artifact (see §2.5 / Decision C).

**H3 — Bounded guarantee.** Credit-and-replacement remediation, scoped to spec compliance + timeline (objective conditions defined at match-lock), 90-day window, with subjective performance and brand-satisfaction outcomes explicitly excluded. This converts execution risk into bounded, priceable operational risk (see §2.3 / Decision A).

**Plus — Process ownership visibility.** The continuous visible artifact of the enforcement function operating: Creator selected → Deliverables approved → Contract executed → Compliance monitored → Payment protected → Escalation available. This surface exists because the better the enforcement system works, the less visible the value becomes — without continuous surfacing, the brand starts thinking they could have done this themselves (see §2.7 / Decision E).

Together: H1 underwrites the guarantee that H3 mechanizes; H2 provides the human credibility that backstops both; the process-ownership surface keeps the enforcement function legible while it operates. No single layer closes alone. The system closes because all four are present in the right place at the right moment of the buying journey.

### 2.3 Decision A — Bounded guarantee (compliance + timeline, 90-day window, credit-and-replacement)

**Locked 2026-05-30.** The brokerage guarantees execution quality and delivery compliance, scoped narrowly to:
- **Spec compliance** — objectively verifiable conditions defined at match-lock and written into both the brand-side and creator-side contracts. Conditions include (non-exhaustive): deliverable length (e.g. "minimum 45 seconds of dedicated brand integration within a video ≥ 8 minutes"), required talking points (a list of 3–5 specific claims/features the brand wants surfaced), required disclosures (FTC, platform-specific), posting window (live by date X, remains posted minimum 90 days), pre-post approval (yes or no, defined upfront).
- **Timeline compliance** — delivery by agreed date; content remains live for the 90-day window.

Explicitly **NOT guaranteed**: view counts, CTR, conversion rates, algorithmic performance, brand-fit subjectivity, downstream business outcomes, external factors (brand positioning changes mid-campaign, etc.).

**Remediation on failure:** Credit-and-replacement — if a compliance condition fails inside the 90-day window, the brokerage delivers a replacement creator of equivalent caliber at no additional cost to the brand. The original creator's outcome is governed separately by Decision D (§2.6).

**Why this scope:** The line between what we own (execution discipline) and what we don't own (market outcomes) is the line a sophisticated brand-side buyer will accept as fair. Owning more (view guarantees, performance guarantees) is uncapped tail risk we cannot price. Owning less reduces the guarantee to noise and fails to convert. This is the survivable middle.

**Unit economics:** A typical deal: brand pays $10K, creator gets $8,500, brokerage takes $1,500. Under Decision D's 80/20 payout split (§2.6), the brokerage holds $1,700 as compliance-validation hold for 30 days post-delivery. A compliance failure costs the brokerage roughly $6,800 net (replacement creator cost ~$8,500 minus the $1,700 held). At a 15% failure rate across 10 deals/month, contingent liability runs ~$10,200/month against ~$15K/month gross fee revenue. **Survivable but tight, which is why §0.6.1 (roster discipline) is governance doctrine, not implementation detail.**

**Schema consequence:** The unused `view_guarantee` field on Deals is **killed** and replaced by a structured `compliance_spec` object (see §4.1 and Brief 7b). A derived `compliance_status` view tracks each condition with timestamped evidence and is surfaced on the brand portal, creator portal, and operator dashboard.

**Contract consequence:** The compliance_spec is **identical** across portal display, brand-side PandaDoc contract, and creator-side PandaDoc contract. The portal IS the contract preview; the contract IS the portal in formal form. Any drift between portal copy and contract terms breaks the trust chain.

### 2.4 Decision B — Portal architecture (deal framework first, creator cards second)

**Locked 2026-05-30.** The brand portal leads with a **deal framework summary** as the first screen, not creator cards. Creator selection is a downstream step inside an already-bounded deal framework, not the entry point.

**Deal framework screen contains:**
- What you're getting (deliverables, structured from the compliance_spec)
- What you're paying (rate, with breakdown if relevant)
- What's guaranteed (compliance_spec summary — timeline, spec conditions)
- What happens if compliance fails (credit-and-replacement, with link to 2-paragraph plain-English explanation)
- What's not guaranteed (view counts, algorithmic performance — stated plainly)
- Escalation availability (Decision C surface)
- Process-ownership funnel (Decision E surface)

**Then** creator cards — typically 3–7 curated matches, each card containing external proof (past sponsors, audience demographics, prior brand work in adjacent categories) AND compliance underwriting evidence ("delivered on time on N of last N sponsorships," "response window typically X hours," "completion rate N%"). H1 and H3 fuse on a single surface.

**Why this inverts marketplace defaults:** Standard influencer platforms lead with creators because their core asset is supply, their job is discovery volume, and they optimize for browsing behavior. That model assumes "trust is already given, now just pick who you want." This brokerage is not a marketplace. The brand's first question at this price point is not "who can I work with" — it is **"what happens if I give you $10K?"** The portal must answer that question before showing inventory.

**Architectural consequence:** The brand portal is a **substantially larger build** than the current `views/roster.html` scaffolding. Owned by Brief 15b.

**Creator portal:** The brokerage builds **two portals, not one.** Creator portal mirrors the structure from the supply-side: the creator sees the same compliance_spec, the same deal framework, the same escalation map (from their side), plus their 80/20 payout status and roster_eligibility state. Owned by Brief 15c. The creator portal was in "Later" in the 2026-05-29 build sequence; it is now **structurally required** because the guarantee model cannot function if the creator side does not see the same execution structure the brand side sees.

### 2.5 Decision C — Institutional visibility (AI support + defined human escalation)

**Locked 2026-05-30.** No founder personal branding in the buying journey — no name, no face, no "your campaign manager is Don." The substitute is **institutional posture**: the brokerage presents as an operating entity with defined responsiveness boundaries.

**Architecture:**
- **AI support, always on.** Handles basic questions, portal guidance, status queries. Bounded to **read-only operations against verifiable state** (deal status, compliance progress, FAQ answers, where the user is in the funnel). Hard handoff to human the moment anything touches contract interpretation, money, dispute, or remediation. The AI is a navigator, not a negotiator.
- **Human escalation window:** Mon–Fri, 7:30am–8pm EDT, with stated response SLA.
- **Escalation triggers explicitly defined and surfaced:**
  - Creator failure (delivery missed, quality below spec, non-responsive)
  - Campaign delay (timeline at risk)
  - Contract ambiguity (interpretation dispute)
  - Refund trigger (Decision A remediation requested)
  - Replacement trigger (Decision A remediation in progress)

**Framing discipline:** The escalation layer is positioned as a **trust substitute for founder visibility**, not as customer support. The framing is structural ("you have a defined escalation path with real humans") not service-oriented ("we have a help desk"). This framing is load-bearing and must be preserved across all surfaces.

**Operational commitment:** ~62.5 hours/week of coverage. At early volume this is the operator. At any scale beyond ~5 concurrent active campaigns, this becomes a staffing question that needs to be answered before scaling. The SLA is a real commitment, not aspirational copy. Weakening the SLA later trades off the trust premise the strategy depends on (see §0.6.2).

**Architectural consequence:** Net-new system component — owned by Brief 15d. The escalation map (creator failure / campaign delay / contract ambiguity / refund trigger / replacement trigger) is a structured map of the failure modes the guarantee covers, surfaced as a navigable interface. Not an FAQ. An interface.

### 2.6 Decision D — Creator-side enforcement (80/20 payout + roster-eligibility leverage)

**Locked 2026-05-30.** The brokerage is a dual-contract enforcement system, which means the creator side must accept terms that make the brand-side guarantee mechanically enforceable. The structure:

**Payout structure:**
- **80% on delivery approval** (deliverable submitted, compliance_spec verified against, approval granted).
- **20% at day 30** (compliance-validation hold; auto-releases unless a compliance failure is flagged within the window).

**Content-remains-live requirement (day 30 to day 90):**
- Content must remain posted for the full 90-day window.
- Removal before day 90 constitutes contract breach.
- Breach enforcement is **NOT cash forfeiture** (the 20% has already released at day 30). Breach triggers:
  - Ineligibility for future roster placement (`roster_eligibility` flipped to `flagged_breach`).
  - Entry into the internal placement-status registry.

**Why this enforcement model:** At the premium tier (100K–1M followers), the scarce resource is deal flow, not cash. Revoking access to structured $5–10K deals is a heavier stick than forfeiting $1,700, and it is operationally clean — one field update versus chasing recovery from a creator who has already spent the money. Cash holds are also creator-side hostile in framing and would push back premium supply at signing time; access revocation is aligned with how premium supply chains discipline themselves.

**Framing discipline:** The 20% hold is framed institutionally as **"compliance validation hold (system integrity layer)"**, never as escrow or punishment. Premium creators will accept structural conditions that apply uniformly across the platform because uniform conditions feel like terms of doing business with a serious operator, not personal distrust. If creator-facing copy ever softens this framing ("we're holding 20% back to make sure you deliver"), the structure becomes unacceptable. The frame protects the mechanism.

**Mid-window deletion risk:** Day 30 to day 90 deletion events are accepted as a rare cost of doing business. Empirically, creators who have been paid, signed contracts, and established brand relationships do not delete sponsored content at meaningful rates — but the rare event does happen, and the model prices it in rather than mechanically prevents it. Curation discipline (§0.6.1) and roster vetting are the upstream controls; contractual breach + future-opportunity revocation is the downstream control; the residual tail is operational cost.

**Schema consequence:** A structured `roster_eligibility` field on Influencers (suggested values: `active`, `inactive`, `flagged_breach`, `flagged_quality`, `under_review`). Owned by Brief 7b. Field name uses `roster_eligibility` or `placement_status`, **not** `risk_list` — same mechanism, less brittle terminology for surfaces where the field name may become visible.

**Matching consequence:** Brief 10 (matching) reads `roster_eligibility` as a hard filter — anything not `active` is excluded from new matches.

**Dashboard consequence:** Brief 15 surfaces the internal placement-status registry as an operator-facing view (who is flagged, why, when).

### 2.7 Decision E — Process ownership visibility (the funnel surface)

**Locked 2026-05-30.** The brand portal includes a **persistent visible artifact of the enforcement function in motion** — a clean, minimalist, sequential representation of campaign state across the full lifecycle:

```
Creator selected → Deliverables approved → Contract executed → Compliance monitored → Payment protected → Escalation available
```

This is **not** a status indicator. It is the **product made visible.** Each step represents the brokerage *doing the work* that justifies the 15% fee. Surfacing the work prevents the "we know how this works now, we'll go direct" failure mode by making it obvious that what the brand is paying for is not introductions but **the continuous operation of a structured execution system.**

**Why this exists:** §0.6.3 (governance doctrine) — the better the enforcement function works, the less visible its value becomes. Without continuous surfacing of process ownership, the enforcement function disappears under the matching narrative, and brands rationalize away the fee.

**Surface specification:** Lives on the brand portal as a first-class persistent surface during active campaigns; lives as a completion record post-campaign. Clean, minimalist, sequential. Each step shows current state, timestamps, and any open items. The funnel is also legible from a glance — a brand checking in for 10 seconds should see immediately where their campaign is and what is happening.

**Architectural consequence:** Owned by Brief 15b (brand portal full build) as a first-class component, not a status widget bolted onto an existing screen.

### 2.8 Strategic failure modes (carried as governance discipline)

The pre-mortem of the closed strategic system identified three failure modes. Each has a governance home in §0.6 (the failure modes ARE the governance principles, expressed as risks). They are restated here in failure-mode form for the build briefs to reference:

| Failure mode | Governance home | Early-warning signal | Pre-committed response |
|---|---|---|---|
| Curation discipline collapses under acquisition pressure | §0.6.1 | Roster addition that wouldn't have qualified under the original bar | Written curation bar artifact (Brief 18) + periodic roster audits |
| Escalation path fails to fire or fails within SLA | §0.6.2 | Brand event that should have escalated didn't, or did and wasn't handled inside the window | Escalation response time surfaced in operator dashboard as first-class metric; personal-fallback ready for high-stakes cases |
| Enforcement function becomes invisible | §0.6.3 | Brand churn after 1–2 successful campaigns; creator pushback on 15% fee at scale | Process-ownership funnel (Decision E) + explicit "what we sell" framing in portal copy, contract preambles, dashboard headers |

These failure modes are not bugs. They are the disciplines the strategy structurally depends on. They live in the doc precisely because they are the things forgotten under pressure.

---

## 3. ARCHITECTURE MAP

> Source: an architecture report that PASSED 5-point verification `[REPORT]`, cross-checked against verbatim `server.js`, `payment_handler.js`, `pre_launch_diagnostic.js` `[VERBATIM]`, refined by the 2026-05-29 senior-engineer threat audit `[AUDIT]`, and extended by the 2026-05-30 strategic decisions (which add net-new components, marked `[NEW 2026-05-30]`). File bodies tagged `[REPORT]` should be read verbatim before being modified.

### 3.1 File tree (real + planned)
```
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
    │   ├── airtable.js           [CLEAN per AUDIT]
    │   ├── disposable_domains.js [CLEAN per AUDIT]
    │   ├── errorHandler.js       [CLEAN per AUDIT]
    │   ├── llm.js                [AUDIT: chatCompletion() dead, no JSON guard — see §6]
    │   ├── logger.js             [CLEAN per AUDIT]
    │   ├── niches.js             [CLEAN per AUDIT]
    │   ├── pandadoc_client.js    [CLEAN per AUDIT]
    │   ├── pandadoc_signature.js [CLEAN per AUDIT] HMAC-SHA256 verify
    │   ├── sendgrid_signature.js [CLEAN per AUDIT] ECDSA via SDK
    │   ├── tracker.js            [AUDIT: in-file, ephemeral on Render — see §6]
    │   └── webhook_idempotency.js[CLEAN per AUDIT]
    └── skills/
        ├── brand_outreach.js     [AUDIT: templated, no LLM/gate — Brief 12 supersedes]
        ├── brand_scout.js        [CLEAN per AUDIT]
        ├── campaign_tracker.js   [CLEAN per AUDIT]
        ├── compliance_engine.js  [PLANNED — Brief 14/15 — derives compliance_status from compliance_spec + events]   [NEW 2026-05-30]
        ├── contract_generator.js [CLEAN per AUDIT — must extend to write compliance_spec into PandaDoc, Brief 14]
        ├── escalation_router.js  [PLANNED — Brief 15d — routes triggers, tracks SLA, surfaces in dashboard]   [NEW 2026-05-30]
        ├── follow_up_engine.js   [AUDIT: rec.name vs company_name bug — see §6]
        ├── influencer_outreach.js[AUDIT: nichesData.niches crash bug + templated — see §6]
        ├── ingest_sprint.js      [CLEAN per AUDIT]
        ├── micro_daemon.js       [AUDIT: retired]
        ├── negotiation_handler.js[REPORT body / VERBATIM prompt+exports — Brief 13 extends]
        ├── payment_handler.js    [VERBATIM — must extend for 80/20 creator payout split, Brief 14]
        ├── support_assistant.js  [PLANNED — Brief 15d — AI support, bounded read-only, handoff triggers]   [NEW 2026-05-30]
        └── lead_discovery/       [REPORT] superseded; reusable utils noted in §5.2
```

### 3.2 Key exports (for writing briefs against)
- `server.js` `[VERBATIM]`: no exports. Routes: `POST /webhooks/stripe`, `POST /webhooks/pandadoc`, `POST /webhooks/sendgrid/inbound`, `POST /webhooks/sendgrid/bounce`, `GET /roster`, `POST /api/roster/select`, `POST /api/roster/decline`, `GET /api/deals`, `POST /api/release_payout`, `POST /api/confirm_payout_complete`, `POST /api/generate_contracts`, `POST /api/create_invoices`, `POST /api/approve_action`. Planned additions: brand-portal routes, creator-portal routes, escalation routes, support-assistant routes (all owned by Briefs 15b/15c/15d).
- `payment_handler.js` `[VERBATIM]`: exports `createInvoices()`, `releasePayout(dealId)`. Internal `sendOperatorPayoutAlert()` (SendGrid REST). **Brief 14 extends** to support 80/20 creator payout split with day-30 auto-release of held 20%.
- `negotiation_handler.js` `[REPORT]`: exports `classifyNegotiation(emailText, senderType)`, `processInboundEmail(record, emailText, senderType)`, `generateRosterLink(brandId)`. **Brief 13 extends** to inject `rate_range` band into classifier context AND to add guarantee-scope-expansion (brand requests for performance guarantees, view guarantees, extended warranty terms) as a RED escalation trigger.
- `contract_generator.js` `[CLEAN per AUDIT]`: exports `generateContracts()`. **Brief 14 extends** to write the `compliance_spec` object into both brand-side and creator-side PandaDoc contracts as structured terms.
- `llm.js` `[AUDIT]`: exports `classifyAndExtract({systemPrompt,userMessage,expectedSchema})` AND dead `chatCompletion({systemPrompt,userMessage})`. **Brief 9 wires `chatCompletion` and encodes the doctrine (deal-framework-first framing, guarantee scope language, curation-as-underwriting frame, escalation availability signal — see §2.2/§2.3/§2.4/§2.5).**
- `niches.js` `[CLEAN]`: `getParentNiche`, `getParentLabel`, `getChildNiches`, `getAllSubNiches`, `normalizeNicheString`, `validateNiche`.
- `airtable.js` `[CLEAN]`: `influencersTable`, `brandsTable`, `dealsTable`, `webhookEventsTable`, `fetchRecords`, `updateRecord`, `createRecord`, `deleteRecord`.
- `webhook_idempotency.js` `[CLEAN]`: `findExistingEvent`, `recordReceive`, `markProcessed`, `markFailed`.

### 3.3 The one LLM call site (current state) and what comes
Only ONE Claude call exists today: `negotiation_handler.js → classifyNegotiation()` via `llm.js classifyAndExtract()`, model `claude-sonnet-4-6`, temp 0, max_tokens 2048. Classifies inbound emails GREEN/YELLOW/RED and extracts quote data from influencers. **Everything the strategy calls for — matching, scoring, intelligence-led outreach, context-based negotiation, deal-range awareness, compliance-aware classification, deal-framework-first outreach — does NOT exist yet. The downstream intelligence engine is NET-NEW.**

### 3.4 Scripts (operator utilities)
`pre_launch_diagnostic.js` `[VERBATIM]` (17 checks), `cleanup_brief_4.js` `[VERBATIM]`, `normalize_existing_niches.js`, `setup_sendgrid_inbound_signing.js`, `test_discovery.js`, plus diagnostic/cleanup one-shots. `cleanup_mock_data_legacy.js` has a broken import path (§6).

---

## 4. DATA CONTRACT

### 4.1 Airtable tables & key fields `[REPORT, cross-checked w/ diagnostic VERBATIM, extended 2026-05-30]`

**Influencers:** `name`, `email`, `niche`, `subscriber_count`, `avg_views`, `channel_url`, `status`, `quote_terms` (JSON string), `engagement_rate`, `inbound_flag`, `email_invalid`, `discovery_source`, `platform`, `source`, `rate_range` (Single Line Text, added Brief 7), `context_notes` (Long Text, added Brief 7). **Brief 7b will add:** `roster_eligibility` (enum: `active`, `inactive`, `flagged_breach`, `flagged_quality`, `under_review` — defaults to `active`), `delivery_reliability_evidence` (Long Text — operator-curated track record evidence, READ for matching filter, see Brief 10), `placement_history` (Long Text — record of past deals, breaches, completions; operator-maintained).

- `delivery_reliability_evidence_last_modified` (Last Modified Time, auto-populated, tracks ONLY `delivery_reliability_evidence`) — Airtable-managed timestamp recording the last modification to `delivery_reliability_evidence` specifically. Brief 11's `delivery_evidence_score` uses this for the 90-day recency check. Field scope MUST be "specific fields" tracking only `delivery_reliability_evidence` — default "all editable fields" is wrong and would corrupt the recency signal.

**Brands:** `company_name`, `contact_name`, `contact_email`, `niche`, `status`, `roster_token`, `roster_token_expires`, `roster_view_count`, `inbound_flag`, `email_invalid`, `discovery_source`, `context_notes` (Long Text, added Brief 7).

- `target_budget` (Number, integer, optional) — stated deal-size target in USD. Brief 11 Layer 2 weighting uses this for rate-band fit computation. Must fall inside $5,000-$15,000 brokerage band when populated; outside-band values surface a flag in Brief 11 but are not schema-enforced.
- `preferred_audience_scale` (Single Select, optional, enum: `micro` / `mid` / `macro` / `mega`) — preferred creator size tier. Bucket boundaries (inclusive at low end, exclusive at high end): `micro` = [0, 100K), `mid` = [100K, 500K), `macro` = [500K, 1M), `mega` = [1M, ∞). Brief 11 Layer 2 weights toward creators whose `subscriber_count` falls in the brand's preferred bucket.
- `preferred_platform` (Single Select, optional, enum: `youtube` / `instagram` / `tiktok` / `podcast` / `multi`) — primary platform interest. `multi` is platform-agnostic (no Layer 2 penalty for any platform).

**Deals:** `deal_id`, `brand_id`, `influencer_id`, `status`, `agreed_rate`, `deliverables`, `quote_terms`, `pandadoc_doc_id`, `stripe_invoice_id`, `contract_state`, `contract_drafted_date`, `contract_sent_date`, `contract_signed_date`, `contract_docs_sent`, `payment_collected_date`, `payment_released_date`, `payout_status`, `payout_amount`, `payout_to_influencer_email`, `payout_to_influencer_name`, `payout_flagged_date`, `negotiation_history`, `escalation_flag`, plus campaign_tracker fields (`youtube_video_url`, `post_deadline`, `view_guarantee` **[KILLED 2026-05-30 — see Brief 7b]**, `views_last_checked`, `campaign_complete`).

**Brief 7b additions to Deals (replacing `view_guarantee`):**
- `compliance_spec` (Long Text, JSON-stringified object) — the structured compliance contract defined at match-lock. Shape:
  ```json
  {
    "deliverable": {
      "type": "1x YouTube integration",
      "min_length_seconds": 45,
      "min_video_length_seconds": 480,
      "required_talking_points": ["point 1", "point 2", "point 3"],
      "required_disclosures": ["FTC", "platform_specific"],
      "pre_post_approval": true
    },
    "timeline": {
      "delivery_by": "2026-07-15",
      "remains_live_until": "2026-10-13",
      "remains_live_window_days": 90
    },
    "remediation": {
      "type": "credit_and_replacement",
      "window_days": 90
    }
  }
  ```
- `compliance_status` (Long Text, JSON-stringified object) — derived state per condition with timestamped evidence (was it posted by deadline, does the video meet length spec, were the talking points hit, was the disclosure present, is it still live). Operator-maintained early; automated where possible later.
- `creator_payout_schedule` (JSON-stringified object) — tracks 80/20 split status:
  ```json
  {
    "payout_total": 8500,
    "payout_80_amount": 6800,
    "payout_80_released_date": null,
    "payout_20_amount": 1700,
    "payout_20_release_due_date": "2026-08-14",
    "payout_20_released_date": null,
    "compliance_hold_active": true
  }
  ```
- `escalation_events` (Long Text, JSON-stringified array) — log of escalation triggers fired on this deal, response times, resolution status (Brief 15d surface).

**WebhookEvents:** `event_id`, `provider`, `event_type`, `verified`, `processed`, `received_at`, `raw_payload`, `notes`.

**OutreachDrafts (NEW — Brief 7d):** persistent store for LLM-generated outreach drafts between generation (Brief 12) and operator review/send (Brief 15 dashboard). 26 fields covering identity (draft_id Autonumber + brand_id/creator_id linked records), status (pending_review/sent/rejected/archived state machine), the 8-field LLM output contract from Brief 9b (subject, body, fit_assessment, fit_rationale, proposed_rate_band, evidence_used, search_queries, flags), Brief 11 scoring_metadata preserved per-draft, edit-tracking snapshots (original_subject/body/proposed_rate_band — never updated after creation), audit timestamps (created_at/sent_at/rejected_at/archived_at), send tracking (sendgrid_message_id/send_failure_count/last_send_failure_reason), and reply tracking (reply_received/reply_received_at/reply_classification — created here, populated by Brief 13). The original_* snapshots preserve LLM output before operator edits so a future learning brief (Brief 19+) can extract patterns from the delta between LLM output and shipped output, correlated with reply outcomes.

### 4.2 `brand_id` / `influencer_id` shape — RESOLVED 2026-05-29 `[VERBATIM-confirmed against real base]`
Confirmed against the real Airtable base during Brief 7 verification: both fields are **Long Text** (not Linked Record, not Single Line Text — Long Text). They have always been Long Text. **Canonical type = Long Text. Behavioral contract = plain string in, plain string out.** The `?.[0]` read pattern in `/api/deals` was the trap — the inference said Linked Record (which would return an array); the fact is Long Text (which returns a string), so `?.[0]` returned the first character of the ID string.

**Why Long Text and not Single Line Text on an FK field (which is convention):** intentionally left as Long Text per operator decision 2026-05-29. Functionally identical for FK use (both return plain strings via the Airtable SDK); the convention change is deliberately deferred as ceremony.

**Consequence pre-Brief-6 (live bug, FIXED):** `/api/deals` was reading `deal.influencer_id?.[0]` which returned `"r"` (first character of `"recXXXXXXXXXXXXXX"`), resolving every card to "Unknown." **Brief 6 shipped 2026-05-29 (commit `6edaa95`)** — fix verified in production, no crash, returns empty array on clean-zero as expected.

**Defensive guards in `payment_handler.js:26` and `contract_generator.js:26` (`Array.isArray(x) ? x[0] : x`) return the plain string unchanged → expected-safe.**

### 4.3 Niche taxonomy `[VERBATIM — config/niches.json]`
Object keyed by parent (NOT an array — see §6 bugs). 6 parents, 20 leaf sub-niches:
```json
{
  "tech_software": {"label":"Tech & Software","children":["ai_tech","ai_saas","productivity","ecommerce"]},
  "lifestyle_personal": {"label":"Lifestyle & Personal","children":["lifestyle","self_development","travel","home_decor","home_garden_wedding"]},
  "content_media": {"label":"Content & Media","children":["content_creation","podcasts","books"]},
  "family_home": {"label":"Family & Home","children":["pets","baby_kids","diy"]},
  "education_knowledge": {"label":"Education & Knowledge","children":["education","teaching"]},
  "physical_goods": {"label":"Physical Goods","children":["physical_products","automotive"]}
}
```
Test niches map: `ai_tech`,`ai_saas` → `tech_software`; `pets` → `family_home`.

### 4.4 Full status state machine `[VERBATIM/REPORT-confirmed, extended 2026-05-30]`
- **Influencer:** `INFLUENCER_DISCOVERED` → `QUOTE_REQUESTED` → `QUOTE_RECEIVED` → `DEAL_INITIATED`. Also `COLD`, `INVALID_EMAIL`, `BOUNCED`. **Cross-cutting:** `roster_eligibility` enum tracks supply-side standing independent of status (Decision D / Brief 7b).
- **Brand:** `BRAND_COLD` → `BRAND_PITCHED` → `INTERESTED` → (deal-framework portal entry → roster select) → `DEAL_INITIATED`. Also `ROSTER_DECLINED`, `INVALID_EMAIL`, `BOUNCED`.
- **Deal:** `DEAL_INITIATED` → `DEAL_LOCKED` (MANUAL Airtable edit currently; Brief 15 surfaces the approval gate in the dashboard) → `contract_state: DRAFTING` → `contract_state: SENT` + `CONTRACT_SENT` → `CONTRACT_SIGNED` → `INVOICE_SENT` → `PAYMENT_COLLECTED` → (`payout_status: PAYOUT_OWED`) → `PAYMENT_RELEASED_80` → `CAMPAIGN_LIVE` → (compliance window day 0-30) → `PAYOUT_20_RELEASED` (day 30) → (compliance window day 30-90) → `CAMPAIGN_COMPLETE` (day 90).
- **Compliance-failure branches (Brief 14/15d):** at any point during the 90-day window, a compliance failure event flips `compliance_status` and triggers either (a) credit-and-replacement remediation (Decision A) which spawns a new linked deal, or (b) creator breach flagging (Decision D) which flips `roster_eligibility` to `flagged_breach`.

### 4.5 Env vars (synced local `.env` ↔ Render)
`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `SENDGRID_VERIFY_STRICT=true`, `STRIPE_SECRET_KEY` (LIVE `sk_live_`), `STRIPE_WEBHOOK_SECRET` (live whsec_), `PANDADOC_API_KEY`, `PANDADOC_WEBHOOK_SECRET`, `PANDADOC_BRAND_TEMPLATE_ID=xp9DuLRJdUsP2fq64K8p3Y`, `PANDADOC_INFLUENCER_TEMPLATE_ID=YeJ2mEivMqaHeyEXUqawrn`, `PANDADOC_BRAND_ROLE=Signer`, `PANDADOC_INFLUENCER_ROLE=Signer`, `ANTHROPIC_API_KEY`, `OWNER_EMAIL=donj@wellsplusdaily.com`, `OPERATOR_NOTIFICATION_EMAIL=donj@wellsplusdaily.com`, `PUBLIC_SERVER_URL=https://influencer-brokerage-os.onrender.com`, `NEOMAIL_USER=` (blank), `NEOMAIL_PASS`. `PANDADOC_VERIFY_STRICT` not set (soft-fail OK). `APIFY_API_TOKEN` (added for lead_discovery, now superseded). Owns second domain `wellspluspartners.com` (for future domain split). `[OPEN — operator to note APOLLO_API_KEY when Apollo is added, Brief 17]`.

**Planned additions (Brief 15b/15c/15d):** signed-URL secret(s) for brand portal and creator portal access; AI support assistant API key if separate from `ANTHROPIC_API_KEY`; escalation routing config (operator phone/email/SMS for off-hours alerting if any).

---

## 5. BUILT vs REMAINING

### 5.1 Built & verified `[VERBATIM]`
Transactional spine end-to-end: contract generation (PandaDoc) → signature webhooks → auto-invoice (Stripe) → payment webhook (`invoice.paid` + `invoice_payment.paid`) → operator payout alert (SendGrid HTTP API) → confirm → CAMPAIGN_LIVE. Webhook hardening (idempotency via WebhookEvents, Stripe HMAC, PandaDoc HMAC soft-fail, SendGrid ECDSA). Niche taxonomy + ingest validation. Roster portal scaffolding at `views/roster.html` (niche-match, parent fallback, 15% markup display, self-select → Deal creation; SUPERSEDED in scope by full brand portal, Brief 15b). SendGrid bounce webhook (`email_invalid` flagging). Pre-launch diagnostic (17 checks). Cleanup tooling. Operator Kanban dashboard (read + Release Payout; full rebuild scheduled Brief 15).

### 5.2 Built but superseded `[REPORT]`
`lead_discovery/` (Apify SERP dorking for Shopify brands + Collabstr creator scraping) — fully coded, only callable via `test_discovery.js`, NOT wired into server. Retired/replaced by Apollo (brands) + curated roster (creators). **Keep the reusable parts:** `email_validator.js` (3-layer), `airtable_writer.js`, `http_client.js`, `cheerio_helpers.js`.
`micro_daemon.js` — X/Twitter discovery. Free-tier unusable per audit, plus the `nichesData.niches` array-vs-object bug. Retired.

### 5.3 What net-new (post-2026-05-30, expanded)
The 2026-05-29 audit confirmed the downstream intelligence layer is **NET-NEW** end to end. The 2026-05-30 strategic closure adds further net-new components:
- **Schema:** `compliance_spec`, `compliance_status`, `creator_payout_schedule`, `escalation_events`, `roster_eligibility`, `delivery_reliability_evidence`, `placement_history` (Brief 7b).
- **Compliance engine:** `compliance_engine.js` — derives `compliance_status` from events, drives the 80/20 payout day-30 auto-release logic, triggers compliance-failure branches (Brief 14).
- **Brand portal:** Full deal-framework-first surface (Brief 15b) — substantially larger than `roster.html`. Owns the Decision E process-ownership funnel.
- **Creator portal:** Full supply-side mirror surface (Brief 15c) — sees compliance_spec from supply side, tracks 80/20 payout state, surfaces `roster_eligibility` status.
- **AI support + escalation interface:** `support_assistant.js` (bounded read-only assistant), `escalation_router.js` (trigger routing, SLA tracking, dashboard surface) — Brief 15d.
- **Contract template extension:** PandaDoc templates must be revised to embed the `compliance_spec` structured terms identically across brand and creator contracts (Brief 14).
- **Operator dashboard:** compliance_status view per deal, escalation_status view, roster_eligibility management UI, internal placement-status registry view (Brief 15).
- **Roster curation artifact:** written curation bar (Brief 18) as governance artifact, not just a data field.

### 5.4 The proving sequence `[DECISION — extended 2026-05-30]`
(a) Schema first — Brief 7 done; **Brief 7b** adds the 2026-05-30 schema (compliance_spec, roster_eligibility, etc.). (b) Spike — Brief 8 — DONE. (c) LLM foundation — Brief 9 — encodes the 2026-05-30 doctrine. (d) Build the engine — Briefs 10–14. (e) Build the customer-facing surfaces — Briefs 15, 15b, 15c, 15d. (f) 4-mock full-system test — Brief 16 — through CAMPAIGN_LIVE AND a compliance-failure remediation path AND an escalation trigger. (g) Inject real leads — Briefs 17–18. **Never send real outreach before Brief 16 passes.**

### 5.5 BUILD SEQUENCE — LOCKED (extended 2026-05-30)

> Numbering continues from Brief 4 (cleanup wipe). **"Brief" = one coherent concern**, carries its own §0.3 verification checklist where applicable, and is not "done" on description — only on verified action against real files/output. **Completion bar = Brief 16 passing** (a mock deal flowing match → lock → contract → sign → invoice → pay (80%) → CAMPAIGN_LIVE → compliance window → day-30 payout (20%) → CAMPAIGN_COMPLETE; AND a mock compliance failure flowing through credit-and-replacement remediation; AND a mock escalation trigger flowing through the escalation router; with no manual repair, relevant `pre_launch_diagnostic.js` slice green).

> The 2026-05-30 strategic closure inserts Brief 7b (schema amendment) and Briefs 15b/15c/15d (customer-facing surfaces + AI support/escalation), and extends the scope of Briefs 9, 10, 12, 13, 14, 15, 16, 18 to absorb the new doctrine.

| # | Type | Concern | Status |
|---|---|---|---|
| **5** | Doc-only | Decision & document lock | DONE 2026-05-29 |
| **6** | Antigravity | `/api/deals` foreign-key read fix | DONE 2026-05-29 |
| **7** | Operator | Initial Airtable schema (rate_range, context_notes) | DONE 2026-05-29 |
| **7b** | Operator | **Schema amendment 2026-05-30:** Kill `view_guarantee` on Deals. Add `compliance_spec` (Long Text, JSON), `compliance_status` (Long Text, JSON), `creator_payout_schedule` (Long Text, JSON), `escalation_events` (Long Text, JSON). On Influencers add `roster_eligibility` (enum: active / inactive / flagged_breach / flagged_quality / under_review — defaults to active), `delivery_reliability_evidence` (Long Text), `placement_history` (Long Text). | NEW — required before Brief 9 |
| **7c** | Operator | **Schema migration prerequisite for Brief 11.** Brands table: `target_budget` (Number), `preferred_audience_scale` (Single Select micro/mid/macro/mega), `preferred_platform` (Single Select youtube/instagram/tiktok/podcast/multi) — all optional. Influencers table: `delivery_reliability_evidence_last_modified` (Last Modified Time, tracks ONLY `delivery_reliability_evidence`). Living doc §4.1 documents the new fields plus `placement_history` outcome enum extension with `breach_timeline_missed`. | DONE |
| **7d** | Operator | **Schema migration prerequisite for Brief 12.** New table OutreachDrafts with 26 fields covering the draft lifecycle (pending_review → sent / rejected → archived), the 8-field LLM output contract, Brief 11 scoring metadata preservation, edit-tracking snapshots, audit timestamps, SendGrid send tracking (sendgrid_message_id for Brief 13 reply matching), and reply correlation fields (created here, populated by Brief 13). Round-trip verification: create temporary test draft via SDK, read back all 26 fields, delete (try/finally cleanup). | DONE |
| **8** | Operator + chat | Intelligence spike | DONE 2026-05-30 |
| **9** | Antigravity | **LLM foundation** (permanent, separate from spike): system-prompt doctrine, tone baseline, few-shot bank, output contract, context-assembly rules. Revives the dead `chatCompletion()` as the generative call. **EXTENDED 2026-05-30 scope:** doctrine encodes the product definition (§0.5), deal-framework-first framing (§2.4 / Decision B), guarantee scope language (§2.3 / Decision A — what's covered, what's not, in non-over-promising language), curation-as-underwriting frame (§2.2 H1), escalation availability signal (§2.5 / Decision C). **Structure locked 2026-05-30 (post-7b):** **Split into Brief 9a (content) + Brief 9b (engineering).** Brief 9a produced a single artifact at `src/prompts/outreach_system.md` containing the full system prompt + the few-shot bank (Option B-flat). Brief 9b hardens `chatCompletion()`, builds the context-assembly layer that consumes 9a from disk, and enforces structured output via **Anthropic tool-use** (NOT JSON-with-fence-stripping — string manipulation of model output is a liability per the Brief 8 spike's JSON-parse failure). Output contract enforcement lives in the wrapper (`chatCompletion()` defines the tool schema; callers receive a typed object, not raw text). **9a + 9a-supplement done 2026-06-02 — Section 5 (user-message template, Path Y) added to the artifact with `{{BRAND_PAYLOAD}}`, `{{CREATOR_PAYLOAD}}`, `{{TASK_INSTRUCTION}}` substitution tokens defined under loader contract. 9b done 2026-06-02 — chatCompletion + outreach_engine.js shipped, verified against real Zapier × Nate and Chewy × Chas pairs.** | DONE 2026-06-02 |
| **10** | Antigravity | **Matching** — deterministic: niche filter + `rate_range` overlaps $5–15K + **`roster_eligibility = active` hard filter (Brief 7b)** + **delivery_reliability evidence required (Brief 7b)**. Owns the `rate_range` parsing contract (strict `"$LOW-$HIGH"` no spaces; defensive fallback regex; malformed entries set `rate_range_invalid` flag — non-matching until corrected). **Locked 2026-06-02:** five-stage filter (Stage 0 field presence + four semantic). Pure function, structured return `{ matches, rejected, flags }`. Strict niche equality (no taxonomy walk). Test-only override `ignoreEmptyDeliveryEvidence` scoped to Stage 4 only, strict `=== true` activation, WARN log per affected creator, production-path grep verification (`Select-String -Path src\server.js,src\skills\outreach_engine.js -Pattern ignoreEmptyDeliveryEvidence` must return zero hits). | DONE 2026-06-02 (+supplement) |
| **10-supp** | Antigravity | Stage 0 redesign — collapsed into per-stage missing-field guards (option ii). New rejection codes `roster_eligibility_missing`, `niche_missing`, `rate_range_missing` replace unified `creator_record_malformed`. Stage 4 defensive read via `delivery_reliability_evidence ?? ''`. §0.3 doctrine added. | DONE 2026-06-02 |
| **11** | Antigravity | **Scoring** — deterministic hybrid. **Layer 1 (curation floor):** computed from placement_history completions/breaches/recency-bonus + delivery_reliability_evidence content+recency (0-3 tier scale). Normalized 0-100 against the eligible roster. **Floor = 50** — below excluded with reason `curation_floor`. Tunable constants at file head. **Layer 2 (brand-fit multiplier):** preferred_audience_scale (bucket match), target_budget (rate-band overlap), preferred_platform (channel_url heuristic). Multiplier in `[0.6, 1.4]`; brand with no Layer 2 fields = 1.0 neutral. **finalScore = layer1 × multiplier.** Curation is gate, brand-fit is sort. Top-20 default, ties by record ID. Pure function: `scoreMatches(matchResult, brand, options) → { scoredMatches, rejected, flags, scoringMetadata }`. `withdrawn_pre_delivery` counted in metadata but neutral on score (option i — tunable when data exists). Delta tests verify causal structure with finally-block cleanup discipline. | DONE 2026-06-07 |
| **12** | Antigravity | **Production outreach orchestration** — batch generation + operator-triggered send. **DONE 2026-06-08.** Two files: `outreach_orchestration.js` (`runOutreachBatchForBrand(brandId, options)` orchestrating matchCreatorsForBrand → scoreMatches → generateOutreachDraft → persist to OutreachDrafts as pending_review; per-creator generation failures accumulate in `errors` array without halting batch) + `outreach_send.js` (`sendOutreachDraft(draftId)` status-checking pending_review load-bearing double-send protection, reads brand.contact_email, fires via `notifications.js` sendOutreachEmail, persists state transition on success or send_failure_count increment on failure). **No cross-module imports** — OutreachDrafts table is the integration contract (verified by grep). Two server routes: `POST /api/outreach/batch` + `POST /api/outreach/send/:draftId`. `notifications.js` created (new util — SendGrid REST v3, SENDGRID_OUTREACH_FROM_EMAIL env var, returns messageId from x-message-id header). Deleted `brand_outreach.js` + `influencer_outreach.js` (via git rm), resolving `[AUDIT 🟡 #11]` (nichesData.niches crash — file removed). `outreachDraftsTable` export added to `airtable.js`. Verification: 5-step e2e (batch → persist → send → state transition → double-send rejection) against live Airtable + real SendGrid; 1 draft created for Nate Herkelman with sendgridMessageId captured; cleanup deleted test draft. **Locked 2026-06-08:** `outreach_orchestration.js` + `outreach_send.js` + `notifications.js` (new) + route additions to `server.js` + `airtable.js` (outreachDraftsTable export) + brand_outreach/influencer_outreach deleted. | DONE 2026-06-08 |
| **13** | Antigravity | **Reply → classify → negotiate** — reconcile/extend `negotiation_handler.js`. Inject `rate_range` band into classifier context. Add deal-range priority to negotiation (out-of-range quote flag, nudge-to-band instruction). **EXTENDED 2026-05-30 scope:** RED escalation triggers expand to include brand requests for guarantee-scope expansion (view guarantees, performance guarantees, custom warranty terms — anything outside Decision A's spec+timeline scope). RED triggers also fire on creator pushback against the 80/20 payout structure (Decision D) framed adversarially. | EXTENDED 2026-05-30 |
**Plus Brief 13 writes reply correlation data back to OutreachDrafts** (`reply_received` checkbox, `reply_received_at` timestamp, `reply_classification` Single Select) when classifying inbound replies. Reply matching uses `In-Reply-To` and `References` headers from SendGrid Inbound Parse as primary strategy; falls back to most-recent-sent-to-this-sender heuristic when headers are stripped; operator-manual association as last resort.
| **14** | Antigravity | **Match-lock → contract handoff** — wire new engine's `DEAL_LOCKED` output into the contract/Stripe/payout spine. Do NOT rebuild the spine. **EXTENDED 2026-05-30 scope:** PandaDoc templates revised so the `compliance_spec` from the portal is written into both brand-side and creator-side contracts as structured terms (the portal IS the contract preview; the contract IS the portal in formal form — no drift). `payment_handler.js` extends to support 80/20 creator payout split: 80% released on delivery approval, 20% held under `creator_payout_schedule` with day-30 auto-release barring compliance flag. Build `compliance_engine.js` to derive `compliance_status` from events and drive the auto-release logic. **Brief 14 must pin the day-30 trigger mechanism** (external scheduler / Render cron / operator-confirmed dashboard release). **Decision (locked):** operator-confirmed dashboard release at early volume per §0.2 doctrine — a "Release 20% hold" button in the dashboard; operator stays disciplined on day-30 fires. Auto-release safety net layered later if volume scales past ~30 deals/month. | EXTENDED 2026-05-30 |
| **15** | Antigravity | **Operator dashboard rebuild.** Replaces `dashboard/app.js` + `dashboard/index.html` wholesale. Lead state board, `DEAL_INITIATED → DEAL_LOCKED` approval gate, outreach draft review/edit/send panel (operator-confirmation sanitization layer), YELLOW/RED `inbound_flag` surfacing, roster interactions, revenue, pipeline health, bounce/invalid tracking. **EXTENDED 2026-05-30 scope:** `compliance_status` view per deal (each condition with timestamp evidence), `escalation_events` view per deal, `roster_eligibility` management UI + internal placement-status registry view, escalation response time as first-class metric (§0.6.2). Resolves `[AUDIT 🟠 #5]` (stub handlers), `[AUDIT 🟡 #14]` (niche colors), `[AUDIT 🟠 #8]` (`follow_up_engine.js` bug surfacing), `[AUDIT 🟡 #10]` (flat-15% vs `pricing.json` — pick flat-15% as intentional or consume pricing.json, apply across `payment_handler.js` + portal markup). Decision in brief: `escalation_flag` stays in `tracker.js` ephemeral OR promoted to Airtable field `[AUDIT 🟠 #7]`. | EXTENDED 2026-05-30 |
| **15b** | Antigravity | **NEW: Brand portal full build.** Replaces `views/roster.html` scaffolding. **First screen = deal framework summary** (Decision B): deliverables, rate, what's guaranteed (compliance_spec summary), what happens on compliance failure (credit-and-replacement, plain-English link), what's not guaranteed (views/algorithm — stated plainly), escalation availability, **process-ownership funnel (Decision E)**. Second screen = curated creator cards (each card with external proof + compliance underwriting evidence). Third screen = selection → deal lock handoff. Persistent escalation panel and process-ownership funnel visible across screens during active campaign. Signed-URL access with expiry. Post-campaign view shows completion record. **Cross-brief coupling — load-bearing:** Brief 15b and Brief 14 share a single source of truth (`compliance_spec` JSON on Deal) and CANNOT drift. Portal rendering and PandaDoc contract terms must say the same thing in the same structure. Coordinate at implementation time even though briefs are non-adjacent in sequence. Equivalence enforced in Brief 16. | NEW |
| **15c** | Antigravity | **NEW: Creator portal full build.** Mirrors brand portal from supply-side. Creator sees: the `compliance_spec` from their side (what they're committing to deliver, by when, with what verification conditions), the deal framework, the escalation map (from supply side), their 80/20 payout schedule with real-time status, their `roster_eligibility` standing. Same framing discipline (Decision C: institutional posture; Decision D: 20% hold framed as "compliance validation hold (system integrity layer)"). Signed-URL access with expiry. | NEW |
| **15d** | Antigravity | **NEW: AI support + escalation interface layer.** Builds `support_assistant.js` (bounded read-only assistant, navigates portal, answers FAQ, surfaces deal/compliance status; hard handoff to human on contract/money/dispute/remediation) and `escalation_router.js` (routes the five defined triggers — creator failure, campaign delay, contract ambiguity, refund trigger, replacement trigger — tracks response times against Mon–Fri 7:30am–8pm EDT SLA, surfaces escalation state to operator dashboard + brand portal + creator portal). Framed as trust substitute for founder visibility (§2.5), NOT customer support. | NEW |
| **16** | Operator + Antigravity | **4-mock full-system test through CAMPAIGN_COMPLETE.** Operator plays both sides via real email + portals, injects friction/varied rates. **EXTENDED 2026-05-30 scope:** test exercises the full compliance object lifecycle (spec defined at match-lock → conditions verified on delivery → 80% payout → day-30 hold → 20% payout → day-90 closure); test fires at least one escalation trigger through the escalation router and verifies SLA-tracked response; test runs at least one compliance-failure remediation path through credit-and-replacement. **Brief 16 includes a portal/contract equivalence test:** render the `compliance_spec` on the brand portal, generate the PandaDoc contract, compare structurally — they must say the same thing in the same structure. This is the unit test for the §2.3 "no drift between portal and contract" commitment. **No real outreach before this passes.** | EXTENDED 2026-05-30 |
| **17** | Operator → Antigravity | **Apollo brand acquisition.** Free-plan validation → API integration → niche+size filtered pulls → existing 3-layer validation → Brands table. Parallel track. | UNCHANGED |
| **18** | Operator | **Curated creator roster injection.** Operator hand-picks deeply-enriched records (sourced per §2). **EXTENDED 2026-05-30 scope:** `rate_range` required column (Brief 7); `delivery_reliability_evidence` required column (Brief 7b); `roster_eligibility` defaulting to `active`; **written curation bar artifact** produced as governance artifact (§0.6.1) — auditable, used for periodic roster review. | EXTENDED 2026-05-30 |
| **Later** | — | Domain split (`wellspluspartners.com`, sized to real volume), hardening trio (matching instrumentation logging, multi-deal capacity model), compliance dispute resolution playbook, internal placement-status governance review, scaling the escalation SLA beyond the operator (staffing the Mon–Fri 7:30am–8pm window past ~5 concurrent campaigns). | — |


**Deliberately no brief:** `micro_daemon.js` and root `diagnostic.js` `nichesData.niches` bugs `[AUDIT 🟡 #11/#12 + §6]`. Both are retired paths.

---

## 6. KNOWN BUGS & DEAD CODE `[from AUDIT 2026-05-29 — line-numbered, evidence-cited]`

**🔴 CRITICAL:**
- **`server.js` lines 612–613** — `/api/deals` uses `deal.influencer_id?.[0]` / `deal.brand_id?.[0]` on Long Text fields. **FIXED Brief 6.**
- **`src/skills/influencer_outreach.js` line 58** — `nichesData.niches.find(...)` on an object that has no `.niches` key. **Resolved by Brief 12 (file replaced wholesale).**

**🟠 HIGH:**
- **`src/skills/brand_outreach.js` + `influencer_outreach.js`** — templated, no LLM/gate. **Replaced wholesale by Brief 12.**
- **`llm.js → chatCompletion()`** — dead, no schema guard. **Brief 9 wires it.**
- **`negotiation_handler.js`** — zero deal-range awareness; no `rate_range` reads; no out-of-range flag; no guarantee-scope-expansion as RED trigger. **Brief 13 extends.**
- **`dashboard/app.js`** — `viewDeal()`, `takeover()`, `approveAction()` are `alert()` stubs. **Brief 15 rebuilds.**
- **`server.js` write/read split on FK fields** — write correct; read was bug (Brief 6 fixed).
- **`tracker.js`** — in-process JSON file store; Render filesystem ephemeral → escalation state flush on restart. **Brief 15 decides: keep ephemeral OR promote `escalation_flag` to Airtable field.**
- **`follow_up_engine.js` line 150** — `subject.replace(/{company_name}/g, rec.name)`; Brands table has `company_name`, not `name`. **Brief 15 surfacing path.**

**🟡 MEDIUM:**
- **`payment_handler.js` line 176** — broker fee hardcoded `Math.round(grossAmount * 0.15)`. `pricing.json` defines tiered fees but is never read. **Brief 15 decision point.**
- **`dashboard/app.js` `NICHE_COLORS`** — missing entries. Cosmetic. **Fold into Brief 15.**
- **`config/deal_stages.json`** — defined, never imported. Documentation-only gap.
- **`config/negotiation_policy.json`** — fields defined; `negotiation_handler.js` embeds inline. Inconsistent but harmless.
- **`micro_daemon.js`** — retired.
- **`diagnostic.js` (root)** — same `nichesData.niches.map(...)` runtime throw. Not in live path. No brief.
- **`cleanup_mock_data_legacy.js`** — broken import. Superseded by `cleanup_brief_4.js`.
- **`lead_discovery/creator_collabstr.js`** — speculative selectors. Not on critical path.
- **`config/pricing.json`** — defined, not consumed. See payment_handler bug above.

**Token approach in `contract_generator.js`:** PandaDoc templates use signer-filled fields (Signer role), so any token-mapping in the code is effectively dead but harmless — knowingly kept. **Brief 14 will revise the templates to embed `compliance_spec` as structured contract terms — token approach may need revisiting at that point.**

**`view_guarantee` field on Deals (NEW NOTE 2026-05-30):** field is defined, never written, never read. **Killed by Brief 7b.** Replaced by `compliance_spec` + `compliance_status` + `creator_payout_schedule` + `escalation_events`.

---

## 7. SURGICAL PRIORITY ORDER `[AUDIT-derived + 2026-05-30 strategic additions]`

These items must be cleared before the relevant brief writes new code.

| Pre-flight | Resolved in Brief |
|---|---|
| Fix `server.js` lines 612–613 (drop `?.[0]`) | **6** — DONE |
| Fix `influencer_outreach.js` line 58 (`nichesData.niches` traversal) | **12** (replaced wholesale) |
| Fix `follow_up_engine.js` line 150 (`rec.name` → `rec.company_name`) | **15** |
| Define `chatCompletion()` output contract location (wrapper vs caller) | **9b** — LOCKED 2026-05-30 to wrapper-level via Anthropic tool-use |
| Decide `tracker.js` escalation_flag: in-file ephemeral OR Airtable field | **15** |
| Add missing niche colors to `dashboard/app.js` | **15** |
| Resolve flat-15% vs `pricing.json` tiered (pick one, apply consistently) | **15** |
| Confirm Airtable FK field types | **Done 2026-05-29; see §4.2** |
| **Kill `view_guarantee` field; add compliance_spec / compliance_status / creator_payout_schedule / escalation_events to Deals** | **7b** — NEW |
| **Add `roster_eligibility`, `delivery_reliability_evidence`, `placement_history` to Influencers** | **7b** — NEW |
| **Revise PandaDoc templates (brand + influencer) to embed compliance_spec as structured contract terms** | **14** — NEW |
| **Extend `payment_handler.js` for 80/20 creator payout split with day-30 auto-release** | **14** — NEW |
| **Pin day-30 release mechanism (external scheduler / Render cron / operator-confirmed dashboard) — locked: operator-confirmed dashboard at early volume, auto-release safety net layered later past ~30 deals/month** | **14** — NEW |
| **Build `compliance_engine.js`** | **14** — NEW |
| **Build `support_assistant.js` + `escalation_router.js`** | **15d** — NEW |
| **Brand portal full build (deal-framework-first per Decision B, process-ownership funnel per Decision E)** | **15b** — NEW |
| **Creator portal full build (supply-side mirror)** | **15c** — NEW |
| **Written curation bar artifact (governance, §0.6.1)** | **18** — NEW |

---

## 8. VERBATIM ARTIFACTS (do not paraphrase)

### 8.1 The negotiation classifier system prompt `[VERBATIM]`
(From `negotiation_handler.js`, model `claude-sonnet-4-6`, temp 0, max_tokens 2048. `${senderType}` interpolated.)
```
You are an inbound email classifier for an influencer marketing brokerage. You will receive an email reply from either an influencer/creator or a brand/advertiser, and your job is to classify the reply and extract structured data.

The sender type is: ${senderType}

Classify the reply into exactly one of three categories:

- GREEN: A simple positive engagement that requires no negotiation. Examples: a thank-you, a clarifying question, a scheduling request, a request for more information, or an unconditional yes.

- YELLOW: A reply that contains negotiable substance and requires human approval before responding. Examples: discussion of price/rate/fees, deliverable changes, timeline adjustments, counter-offers, or revisions.

- RED: A reply that contains legal, contractual, or rights-related complexity that requires immediate owner intervention. Examples: requests for exclusivity, perpetual usage rights, custom legal clauses, liability terms, or non-standard payment terms (net 30/60/90).

In addition to classification, extract structured data ONLY if the sender type is 'influencer' AND the email contains a quote (rate, deliverable, timeline). Extract into this shape:

{
  "rate": <number — dollar amount as integer>,
  "deliverable_type": <string — e.g., "1x TikTok integration", "1 YouTube video">,
  "timeline": <string — e.g., "2 weeks", "delivery by Dec 15">,
  "usage_rights": <string — what rights the brand gets, default "Standard">,
  "exclusivity_window": <string — exclusivity terms if any, default "None">
}

If the email is from an influencer but contains no quote data, set extractedData to null.
If the email is from a brand, set extractedData to null regardless.
Also extract a one-sentence intent description.

Respond ONLY with valid JSON in this exact shape, no preamble, no markdown fencing:

{
  "classification": "GREEN" | "YELLOW" | "RED",
  "intent": "one-sentence description of what the sender is saying",
  "extractedData": null | { quote shape above }
}
```

**Note (2026-05-30):** Brief 13 will extend this prompt to add deal-range awareness and guarantee-scope-expansion RED triggers. The verbatim above is the current state.

### 8.2 quote_terms JSON shape (stored on Influencers as a string) `[VERBATIM]`
```json
{"rate":100,"deliverable_type":"1x test post","timeline":"1 week","usage_rights":"Standard","exclusivity_window":"None"}
```

### 8.3 compliance_spec JSON shape (NEW 2026-05-30, stored on Deals as a string) `[SPEC — to be implemented in Brief 7b]`
```json
{
  "deliverable": {
    "type": "1x YouTube integration",
    "min_length_seconds": 45,
    "min_video_length_seconds": 480,
    "required_talking_points": ["point 1", "point 2", "point 3"],
    "required_disclosures": ["FTC", "platform_specific"],
    "pre_post_approval": true
  },
  "timeline": {
    "delivery_by": "2026-07-15",
    "remains_live_until": "2026-10-13",
    "remains_live_window_days": 90
  },
  "remediation": {
    "type": "credit_and_replacement",
    "window_days": 90
  }
}
```

### 8.4 creator_payout_schedule JSON shape (NEW 2026-05-30, stored on Deals as a string) `[SPEC — to be implemented in Brief 7b/14]`
```json
{
  "payout_total": 8500,
  "payout_80_amount": 6800,
  "payout_80_released_date": null,
  "payout_20_amount": 1700,
  "payout_20_release_due_date": "2026-08-14",
  "payout_20_released_date": null,
  "compliance_hold_active": true
}
```
### 8.5 placement_history JSON shape (NEW 2026-05-30, stored on Influencers as a string) `**Outcome enum (inside JSON :**`completed_on_spec`, `completed_with_remediation`, `breach_content_removed`, `breach_quality_failure`, `breach_timeline_missed`, `withdrawn_pre_delivery`.


## 9. FRESH-CHAT KICKOFF BLOCK (paste this instruction when starting a new build chat)

> Load the `ai-first-engineering` skill. Read this entire living document. Do NOT write any brief yet. The operating doctrine in §0 is binding — especially: implementing models hallucinate identifiers, so verify everything against verbatim files; one concern per brief; real code never placeholders; sanitization = operator confirmation in the dashboard, NOT a machine layer. **Read §0.5 (product definition) and §0.6 (governance doctrine) before anything else — they frame what the rest of the system serves.**
>
> **Current state:** §4.2 RESOLVED (`brand_id`/`influencer_id` = Long Text, canonical). Brief 5 done. Brief 6 shipped 2026-05-29 (`/api/deals` FK fix). Brief 7 done (initial schema). Brief 8 done (intelligence spike — verdict: pass with notes, eight encoding requirements extracted, see Changelog 2026-05-30). **Strategic system closed 2026-05-30 — see §2 (five locked decisions A through E, trust stack, product definition).** Build queue locked in §5.5 with three new brief insertions (7b, 15b, 15c, 15d) and scope extensions to 9, 10, 12, 13, 14, 15, 16, 18.
>
> **Next brief is Brief 7b (operator task — schema amendment).** Brief 9 (LLM foundation) cannot start until 7b is done — Brief 9's doctrine references fields that must exist in the schema.
>
> **First move:** If the next brief touches a file tagged `[REPORT]`, ask the operator to paste it verbatim before writing. Files already known clean per `[AUDIT]` (§3.1) can be relied on without re-paste. The 2026-05-29 audit (§6) is the authority on known bugs — fixes are folded into the briefs that own them.
>
> **Then:** write the next brief per §5.5. One concrete artifact per turn. No re-litigating decisions in §2 (including the 2026-05-30 additions in §2.2–§2.7). Schema first. Validate on mocks before real outreach. Use Sonnet 4.6 inside Antigravity IDE for implementation.

---

## 10. CHANGELOG (append-only — maintain with discipline after every brief)

- **2026-05-28** — Living document created. Grounded in: verbatim `server.js`, `payment_handler.js`, `pre_launch_diagnostic.js`; a 5-point-verification-passed architecture report; verbatim `niches.json` and negotiation classifier prompt; and the locked premium-boutique strategy correction. Transactional spine verified & live. Data at clean zero baseline. Strategy pivoted from 15K-volume to premium-curated. Downstream intelligence engine confirmed NET-NEW. §4.2 marked OPEN.

- **2026-05-29** — **Brief 5 (decision & doc lock).** §4.2 RESOLVED: `brand_id`/`influencer_id` confirmed (initially as Single Line Text per the read; subsequently corrected to Long Text via Brief 7 verification — see that entry); `/api/deals` `?.[0]` read identified as broken (masked by clean-zero), fix scheduled Brief 6. **Eight decisions locked:** web-augmented outreach at send time with operator-confirmation sanitization; no `enrichment_tier` field; deal-range lives in 4 places (3 deterministic + 1 LLM); §4.2 resolved; Apollo paid-tier economics restored; creator email sourcing free (hand-picked); proportionality doctrine first-class in §0.2; "LLM training" = prompt/context engineering. **Build sequence locked as §5.5 (Briefs 5–18 + Later).** **Threat audit folded in** (Sonnet 4.6 in Antigravity IDE — recorded as verified-stronger model in §0.1): 2 CRITICAL, 5 HIGH, 6 MEDIUM bugs catalogued in §6; pre-flight fixes mapped to the briefs that own them (§7).

- **2026-05-29 (later)** — **Brief 6 shipped** (commit `6edaa95`). `/api/deals` `?.[0]` reads dropped. Pre-commit audit confirmed defensive guards in `payment_handler.js:26` and `contract_generator.js:26` are safe. Render redeployed to Live; `/api/deals` returns empty `[]` on clean-zero as expected. `[AUDIT 🔴 #1]` resolved.

- **2026-05-29 (later)** — **Brief 7 done** (operator task). Added `rate_range` (Single Line Text) to Influencers; `context_notes` (Long Text) to both Influencers and Brands. Field-type verification surfaced a true finding: `brand_id` / `influencer_id` on Deals are **Long Text**, not Single Line Text as §4.2 previously asserted — §4.2 updated. Brief 6's fix is unaffected (Long Text returns plain string, same as Single Line Text). `rate_range` format enforcement explicitly assigned to Brief 10. Schema foundation complete; spike (Brief 8) unblocked.

- **2026-05-30** — **Brief 8 shipped (intelligence spike).** Throwaway harness ran two pairs (Zapier × Nate Herkelman in `ai_saas`; Chewy × Chas/@dear.fig in `pets`) using Sonnet 4.6 + web_search. Both drafts produced intelligence-grade prose with verified facts (Zapier's 760% AI task growth + April 2025 orchestration launch + n8n/Apify creator partnerships; Chewy Storefronts expansion + CarePlus/telehealth direction + exotic-pet whitespace). Verdict: **Pass with notes.** Eight encoding requirements extracted for Brief 9: (1) close mechanic should be roster-portal handoff not generic "schedule a call" (model defaulted to B2B playbook); (2) subject lines are weak — fit-led not stat-led, separate few-shot bank needed; (3) "deploy facts, don't recite them" — explicit instruction + few-shot needed; (4) tone tighter — target ~120 words not 160; (5) honest fit assessment — both came back "Strong"; raise the bar, normalize "Moderate with caveats"; (6) JSON parse reliability — model wrapped in code fences; either strip-before-parse or move to tool-use/structured output (recommend tool-use); (7) deal-range doctrine encoded in system prompt, not left to inference; (8) search budget cap (currently 4, recommend 2) + constrained queries. Spike also revealed that downstream conversion at $5–10K is not solved by intelligence-led outreach alone — surfaced the deeper strategic gap that triggered the strategic stress-test below.

- **2026-05-30 (same day, strategic closure session)** — **Strategic system closed. Product definition, trust stack, five decisions, governance doctrine, failure-mode discipline.** No code changed; doc reshape only. Reasoning summary preserved here in full so the implementation chat can absorb the upgrade without re-running the conversation:

  - **Frame entered with:** Locked §2 strategy (premium boutique, intelligence-led outreach, deal-range doctrine, operator confirmation) solves acquisition and operations but does not solve conversion at the $5–10K decision point, where the brand's real question is "will my $10K produce predictable ROI or chaos." Hypothesis on the table: external proof curation (Layer 2) added as a decision-interface component.
  
  - **First push-back:** External proof solves "the category is real" and "the creator is credible" but does not solve "will this brokerage execute." The brand's real fear is the operator, not the category. Three competing hypotheses surfaced for what closes $5–10K trust friction: H1 (external proof / belief problem), H2 (brokerage credibility / vendor problem), H3 (structural risk transfer / contract problem).
  
  - **Operator response:** H1 was reasoned hypothesis not empirical evidence. H3 is the empirical reality for conversion; external proof justifies the price tag (without H1 the $10K doesn't feel earned) but doesn't close. Trust burden distributes across surfaces; brokerage-credibility (H2) emerges as a byproduct of how H1 and H3 are surfaced.
  
  - **Second push-back:** "Distributed across the surface" is correct as design principle but doesn't tell you which layer carries which weight at which moment. Mapped the buying journey T+0 → T+30s (outreach) → T+5min (portal entry) → T+30min (creator selection) → T+24h (sign decision) → post-signature (dissonance window). Demonstrated that the current §2 system is heavily weighted T+0 through T+30min and has almost nothing for T+30min onward except the contract spine itself, which the brand doesn't see surfaced. The `view_guarantee` field exists in schema but is zero-percent surfaced. The actual gap is not "we need proof curation" — it's "the structural safety that already exists is invisible at the moments it needs to do its job."
  
  - **Forced business decisions:**
    - Is the `view_guarantee` field a real guarantee or a placeholder? Operator: kill it; replace with credit-and-replacement remediation scoped to spec compliance + timeline (not view-based outcomes). H1 protects the brokerage — we only match creators who can deliver, so guarantee liability is bounded by curation discipline.
    - **Decision A locked:** Guarantee bounded to spec + timeline, 90-day window, cap-by-category, credit-and-replacement remediation. View guarantees and subjective performance explicitly out of scope.
  
  - **Third push-back:** Portal architecture — invert marketplace default? Operator: yes. Standard platforms lead with creators because supply is their asset and they assume trust is given. We are not a marketplace. Brand's first question is "what happens if I give you $10K," not "who can I work with." 
    - **Decision B locked:** Brand portal leads with deal framework, creator cards second.
  
  - **Fourth push-back:** Who is on the other end of the guarantee? "Don's brokerage" needs a face or an institution. Founder visibility vs institutional substitute. Operator: institutional substitute — defined responsiveness boundaries, AI support + human escalation window (Mon–Fri 7:30am–8pm EDT), five defined escalation triggers (creator failure, campaign delay, contract ambiguity, refund trigger, replacement trigger), positioned as trust substitute not customer support.
    - **Decision C locked:** Institutional visibility via AI support + structured escalation. Creator portal promoted from "Later" to structurally required (since the guarantee model cannot function if creator side does not see the execution structure brand side sees).
  
  - **Fifth push-back:** Creator-side enforcement. The guarantee requires the creator to accept terms the brokerage commits them to. Three options surfaced (i) holds-with-clawback; (ii) full-pay-with-clawback; (iii) full-pay-no-clawback. Operator: hybrid — 80/20 split, 80% on delivery approval, 20% at day 30; content must remain live for 90 days enforced via roster_eligibility (future opportunity cost), not cash hostage. Framing as "compliance validation hold (system integrity layer)" — uniform, institutional, not adversarial.
    - **Decision D locked:** 80/20 payout, day-30 release on the 20%, 90-day live-content requirement enforced via roster eligibility. Internal placement-status registry as structured schema field (suggested name `roster_eligibility`, NOT `risk_list`, to keep terminology durable across surfaces).
  
  - **Synthesis: Product definition.** What got built across the four decisions: a system that is no longer "find creators and run deals" but **a dual-contract enforcement system between two parties who do not naturally trust each other.** The brokerage monetizes the function of being the credible enforcement layer at a price point where neither side can credibly enforce on the other. The matching, outreach, contracts are all in service of this. Logged as §0.5.
  
  - **Pre-mortem of closed system:** Three failure modes identified.
    1. Curation discipline collapses under acquisition pressure — risk exists in any premium brokerage with selective inventory; guarantee exposes consequences mechanically and visibly. **Roster growth is subordinate to roster quality** is governance doctrine, not implementation.
    2. Escalation path fails to fire or fails within SLA — institutional framing fails the moment the escalation doesn't respond when it matters. Failure signal is measurable escalation-path failure, not absence of founder face. Personal-fallback ready for high-stakes cases.
    3. Enforcement function becomes invisible — the better the system works, the less visible the value becomes; brand churn after 1–2 successful campaigns is the early signal. Addressed by Decision E (continuous process-ownership surface). Operator added: portal must continuously show process ownership — Creator selected → Deliverables approved → Contract executed → Compliance monitored → Payment protected → Escalation available. The funnel surface is "the product made visible."
    - **Decision E locked:** Process-ownership funnel as persistent first-class surface on brand portal. Three failure modes carried as governance discipline in §0.6 and §2.8.
  
  - **Architectural implications absorbed into build sequence:**
    - **New Brief 7b** (schema amendment): kill `view_guarantee`; add `compliance_spec`, `compliance_status`, `creator_payout_schedule`, `escalation_events` to Deals; add `roster_eligibility`, `delivery_reliability_evidence`, `placement_history` to Influencers.
    - **Brief 9 extended:** doctrine encodes product definition + deal-framework framing + guarantee scope language + curation-as-underwriting frame + escalation availability signal.
    - **Brief 10 extended:** matching reads `roster_eligibility` as hard filter and `delivery_reliability_evidence` as required field.
    - **Brief 12 extended:** outreach signals deal-framework portal (not creator-list portal); does NOT lead with guarantee.
    - **Brief 13 extended:** RED triggers expand to guarantee-scope-expansion requests + creator pushback on 80/20 framed adversarially.
    - **Brief 14 extended:** PandaDoc templates revised to embed compliance_spec as structured terms across both brand and creator contracts; `payment_handler.js` extends for 80/20 split with day-30 auto-release; new `compliance_engine.js` derives compliance_status and drives release logic.
    - **Brief 15 extended:** compliance_status view per deal, escalation events view, roster_eligibility management UI, internal placement-status registry, escalation response time as first-class metric.
    - **New Brief 15b:** brand portal full build — deal-framework-first per Decision B, process-ownership funnel per Decision E.
    - **New Brief 15c:** creator portal full build — supply-side mirror per Decision D framing.
    - **New Brief 15d:** AI support + escalation interface — `support_assistant.js` (bounded read-only) + `escalation_router.js` (trigger routing, SLA tracking).
    - **Brief 16 extended:** test exercises compliance object lifecycle + escalation trigger + credit-and-replacement remediation.
    - **Brief 18 extended:** delivery_reliability_evidence required column + written curation bar artifact as governance.
  
  - **What did NOT change:** All of §0.1 through §0.4 operating doctrine. All of §2.1 (the 2026-05-29 frame). All of §3 architecture map (only additions, no removals). All of §4.2, §4.3, §4.5. All of §6, §7 (existing audit findings; new entries added). All of §8.1, §8.2 verbatim artifacts. Transactional spine remains verified-and-running.
  
  - **What was killed:** The `view_guarantee` field on Deals (Brief 7b kills it; replaced by the compliance object).
  
  - **No code changed in this session.** Doc reshape only. Brief 7b is the next operator task; Brief 9 follows immediately after.

- **2026-05-30 (same day, targeted additions)** — Four targeted doc additions following pre-flight review of the §5.5 build sequence against the new doctrine. No new decisions, no scope changes — these surface couplings and pin a mechanism that were implicit and would have been re-discovered at brief-writing time:
  - **Brief 14 row (§5.5):** day-30 trigger mechanism pinned to **operator-confirmed dashboard release** at early volume per §0.2 doctrine — "Release 20% hold" button in the dashboard; operator stays disciplined on day-30 fires. Auto-release safety net layered later if volume scales past ~30 deals/month. This replaces what the prior text described as "day-30 auto-release" without specifying the trigger mechanism.
  - **Brief 15b row (§5.5):** load-bearing cross-brief coupling with Brief 14 surfaced explicitly — Brief 15b and Brief 14 share a single source of truth (`compliance_spec` JSON on Deal) and CANNOT drift. Portal rendering and PandaDoc contract terms must say the same thing in the same structure. Briefs are non-adjacent in sequence; coordination is implementation-time.
  - **Brief 16 row (§5.5):** test scope extended with a portal/contract **equivalence test** — render the `compliance_spec` on the brand portal, generate the PandaDoc contract, compare structurally — they must say the same thing in the same structure. This is the unit test for the §2.3 "no drift between portal and contract" commitment.
  - **§7 surgical priority order:** added one row pinning the day-30 release mechanism, placed adjacent to the existing 80/20 `payment_handler.js` extension row (same Brief 14 concern).

- **2026-05-30 (later)** — **Brief 7b done (operator task).** Schema amendment per 2026-05-30 strategic closure: `view_guarantee` killed on Deals; `compliance_spec`, `compliance_status`, `creator_payout_schedule`, `escalation_events` added to Deals (all Long Text, JSON-stringified payloads); `roster_eligibility` (Single Select, 5 options — `active` / `inactive` / `flagged_breach` / `flagged_quality` / `under_review`, default `active`), `delivery_reliability_evidence` (Long Text), `placement_history` (Long Text) added to Influencers. Round-trip verification (D.6) passed: JSON-stringify into Long Text → SDK fetch → `JSON.parse` → nested field access all clean. Brief 9 (LLM foundation) unblocked. PowerShell-vs-bash quoting issue in original D.6 one-liner surfaced and worked around with a temp `.mjs` script in `scripts/`; Brief 7b's Section D.6 should be revised to use the file-based approach as canonical (deferred — not blocking).

- **2026-05-30 (later, same day)** — **Brief 9 structural decisions locked (pre-write).** Two open questions resolved before Brief 9a begins: (1) **Split locked to B** — Brief 9 splits into 9a (content design: system prompt + few-shot bank as `src/prompts/outreach_system.md`) and 9b (engineering: `chatCompletion()` hardening, context-assembly layer, output contract enforcement). Rationale: content-design and engineering are genuinely two concerns with different review muscles; smaller verifiable surfaces honor §0.1 implementing-model-hallucinates rule; same proven pattern as 7→8→9. (2) **Brief 9a structure locked to B-flat** — one artifact, system prompt + few-shot bank in a single file, reviewed as a single thing. Rationale: simplicity over further fragmentation when the artifact is still a single coherent voice. (3) **Output contract locked to Anthropic tool-use** in the `chatCompletion()` wrapper — NOT JSON-with-fence-stripping. Rationale: the Brief 8 spike's JSON-parse failure confirmed string manipulation of model output is a liability at scale; tool-use enforces schema by API contract. §5.5 Brief 9 row and §7 pre-flight updated to reflect the locks. **Brief 9a is the next artifact.**

- **2026-06-02** — **Brief 9a done.** `src/prompts/outreach_system.md` written, operator-reviewed against the send-test bar (would you personally send each few-shot to a real contact), tightened by operator before shipping. Encodes the seven framing components from §0.5 / §2.2–§2.5 / §2.1, the eight spike-derived encoding requirements, and three calibrated few-shots covering the Strong / Moderate-with-caveats / Weak distribution: Manus AI + Nate Herkelman (Strong, grounded in Meta acquisition + v1.6 + Meta Ads Manager integration evidence from real web search), Spot & Tango + Chas (Moderate-with-caveats, the dog-vs-exotic-pet center-of-gravity caveat articulated honestly, care-buyer angle proposed at $5K–$7K), Lyzr AI + Chas (Weak — operator-facing note re-routing Lyzr to Nate or Greg given total enterprise-vs-consumer buyer mismatch). Mechanical verification (`scripts/check_outreach_prompt.mjs`, throwaway): `<<<` / `>>>` markers balanced, 3 JSON blocks parse cleanly, all required output-contract fields present, word budgets honored. Operator set the broker signature to `[Wells+ Daily]` in Section 1 and added a fifth forbidden subject pattern ("anything that reads like generic agency outreach"). **Brief 9b structural decisions locked (2026-06-02):** single brief covering chatCompletion hardening + context-assembly layer + outreach_engine.js wiring; user-message template lives in the prompt artifact (Path Y), not in code. **Order B chosen:** a small Brief 9a-supplement adds Section 5 (user-message template) to `outreach_system.md` before Brief 9b begins, preserving the content-vs-engineering separation that justified the 9a/9b split.

- **2026-06-02 (later)** — **Brief 9a-supplement done.** Section 5 (user-message template, Path Y) added to `src/prompts/outreach_system.md`. Defines the literal user message between `[[[` and `]]]` markers with three substitution tokens (`{{BRAND_PAYLOAD}}`, `{{CREATOR_PAYLOAD}}`, `{{TASK_INSTRUCTION}}`). Substitution token contract pins which Airtable fields the loader extracts for each payload (and explicitly which fields it excludes as operational noise — `roster_token`, `quote_terms`, `engagement_rate`, `placement_history`, etc.). Loader behavior contract specifies the read → extract → substitute → call → return pipeline. Failure modes named: unsubstituted tokens raise loud, missing record fields emit `(missing)` and flag `record_incomplete`, missing artifact file is unrecoverable, broken markers raise loud. Same edit pass: operator fixed the `[Broker name]` → `[Wells+ Daily]` drift across the four few-shot bodies in Section 3, eliminating signature inconsistency between Section 1 and Section 3. **Brief 9b unblocked — single brief, all three concerns coupled (chatCompletion hardening + loader + outreach_engine.js).**

- **2026-06-02 (later still)** — **Brief 9b done.** `src/utils/llm.js` `chatCompletion()` rewritten with Anthropic tool-use (`tool_choice` forces the model's tool call; structured output is API-contract-enforced, not parse-recovered); existing `classifyAndExtract()` untouched. New file `src/skills/outreach_engine.js` builds the loader (reads `outreach_system.md` at module init, parses Section 1 / Section 3 / Section 5 markers, fails loud on malformed artifact), three few-shot assembly as synthetic (user → assistant tool_use → tool_result) turn triples for in-context priming, `formatBrandPayload()` and `formatCreatorPayload()` emitting only the Section 5 contract field set, defensive `{{...}}` survivor check, and `generateOutreachDraft(brandId, creatorId, options)` as the single public API (Brief 12 will consume). Verification: real API call against two real spike pairs (Zapier × Nate, Chewy × Chas) — both produced clean tool_use outputs with all 8 fields populated. Pair 1 (Zapier × Nate) landed Strong fit at 132 words (2 over cap — flagged as model-calibration watch item for the Brief 15 dashboard, not infrastructure bug); Pair 2 (Chewy × Chas) landed Weak fit honestly because `delivery_reliability_evidence` is missing from the Chas record — curation-as-underwriting (§2.2 H1) working as designed, model refused to underwrite without evidence. Committed (`src/utils/llm.js`, `src/skills/outreach_engine.js`, `src/prompts/outreach_system.md`) and pushed; Render auto-redeploy confirmed. **Brief 10 (matching) unblocked.**

- **2026-06-02 (later, still)** — **Brief 10 structural decisions locked (pre-write).** Five answers settled before writing the brief: (1) **Pure function, structured return** — `matchCreatorsForBrand(brandId, roster = null, options) → { matches, rejected, flags }`. No throw on empty matches. (2) **Niche matching is exact leaf equality only** — no taxonomy walk. Strictness is deliberate; coverage gaps are answered by future expansion of `config/niches.json` and creator re-tagging, not by relaxing the match. (3) **Five-stage filter** — Stage 0 field-presence check (catches schema drift pre-Brief-7b records) precedes the four semantic filters (Stage 1 roster_eligibility, Stage 2 niche, Stage 3 rate_range parse+overlap, Stage 4 delivery_reliability_evidence non-empty). Field-presence reason is `creator_record_malformed`, structurally distinct from later filter reasons. (4) **rate_range parsing contract** — three states: strict pass (no flag), loose pass (call-level `rate_range_parsed_loose_count_N` aggregated), invalid (per-creator `rate_range_invalid` rejection). Strict regex `^\$\d+K?-\$\d+K?$`, loose accepts spaces/missing-$/alt-dashes/lowercase-k. K-suffix multiplies by 1000. (5) **Test-only override `ignoreEmptyDeliveryEvidence`** — narrowly scoped to Stage 4 ONLY (Stages 0, 1, 2, 3 cannot be overridden). Strict `=== true` activation (truthy non-true does NOT activate; defense against accidental). WARN log per affected creator with `brandId`/`creatorId`/`creatorName`/stack-slice. Call-level `override_used_ignore_empty_delivery_evidence` flag aggregated once regardless of creator count. Production-path grep at Section C.4 verifies zero hits in `server.js` and `outreach_engine.js`; Brief 12 must also pass this check. Override exists because Brief 18 (curated roster injection) hasn't run yet and the live three-creator roster may not have `delivery_reliability_evidence` populated; the override is a bridge mechanism, not a feature. The §0.6.1 governance risk (override drifting into production) is mitigated by two-layer defense: code-review-time grep + runtime WARN logs that would be unmissable. Pattern (ii) for roster: optional second positional argument, function fetches via `fetchRecords(influencersTable)` when null, trusts caller-provided roster as-is otherwise.

- **2026-06-02 (later)** — **Brief 10-supplement done.** Stage 0 redesign per the (i)/(ii) framework — implementing model chose option (ii) collapse: per-stage missing-field guards. New rejection codes (`roster_eligibility_missing`, `niche_missing`, `rate_range_missing`) replace the unified `creator_record_malformed`. Stage 4 reads `delivery_reliability_evidence ?? ''` defensively — absent SDK key and empty string both coerce to the same empty string and fail the trim-length check, enabling the override to fire correctly in either condition. **§0.3 doctrine entry added:** "Airtable SDK wire behavior on unwritten Long Text fields" — explicitly names that the SDK omits unwritten fields from response payloads, mandates `record.field ?? ''` (or `?? []`) defensive reads for all six existing Long Text fields plus prospective additions. Doctrine is the prospective fix; Brief 10-supplement is the retrospective correction. Verification: revised Test 6 (absent field → Stage 4 with appropriate handling), new Test 6b through 6d (each `*_missing` code fires correctly), live Airtable re-verification (Nate + Greg → `niche_mismatch`, Chas → `delivery_reliability_evidence_missing` → matches via override). Production-path grep zero hits, override semantics preserved exactly as Brief 10 designed. Commit `84f712b` pushed, Render redeploy clean. **Brief 11 (scoring) unblocked.** *Architectural note surfaced during the supplement:* the living doc currently lives in `C:\Users\Shadow\Downloads\`, outside the repo; not tracked in git. Operator decision pending on whether to move it into the repo for durability.

- **2026-06-07** — **Brief 11 done.** `src/skills/scoring_engine.js` shipped (~360 lines): hybrid scoring with Layer 1 curation floor (50, brand-agnostic, normalized 0-100 from completions × 10 + delivery_evidence_score × 5 + recency_bonus × 3 − breaches × 25) + Layer 2 brand-fit multiplier (0.6-1.4 range, weighted 0.4 audience scale + 0.4 budget overlap + 0.2 platform match, gracefully degrades to 1.0 neutral when Brand fields absent per §0.3 doctrine). Pure function `scoreMatches(matchResult, brand, options) → { scoredMatches, rejected, flags, scoringMetadata }`; passes Brief 10's rejected/flags through unchanged plus adds scoring-specific flags (`no_floor_passers`, `layer2_inactive`, `target_budget_out_of_band`, `small_roster_normalization_warning_N`). Constants exposed at file head as tuning knobs (`COMPLETION_WEIGHT`, `BREACH_PENALTY`, `EVIDENCE_RICH_THRESHOLD_CHARS`, `EVIDENCE_RECENT_THRESHOLD_DAYS`, `CURATION_FLOOR`, etc.). `withdrawn_pre_delivery` outcome counted in `scoringMetadata.withdrawnPreDeliveryCount` but does NOT affect score (option (i) neutral per Brief 11 lock — operator can revisit weighting after ~10-20 deals with data to read). New creators with empty `placement_history` rank low; no artificial neutral baseline (option (b) per Brief 11 lock). Internal `parseRateRange` helper duplicated from `matching_engine.js` rather than exported (small DRY violation contained to keep matching_engine.js untouched per "do NOT modify" scope). Verification: six mechanical tests + two delta tests with strict finally-block Airtable cleanup discipline (Nate.placement_history breach injection drops score below floor; Zapier.target_budget=25000 surfaces `target_budget_out_of_band` flag; all originals restored to confirmed values). Production-path grep (`Select-String -Path src\server.js,src\skills\outreach_engine.js -Pattern scoreMatches\|scoring_engine`) returns zero hits. **Brief 12 (production outreach orchestration) unblocked.**

- **2026-06-02 (later)** — **Brief 7d done (operator task).** Schema migration prerequisite for Brief 12. New table OutreachDrafts created in Airtable with 26 fields: draft_id (Autonumber primary), brand_id/creator_id (Link to Brands/Influencers), status (Single Select pending_review/sent/rejected/archived default pending_review), the 8 LLM output fields per Brief 9b output contract, scoring_metadata Long Text preserving Brief 11's scoreBreakdown per-draft, edit-tracking snapshots (original_subject/body/proposed_rate_band — set once at creation, never updated), audit timestamps (created_at auto + sent_at/rejected_at/archived_at populated on state transitions), SendGrid send tracking (sendgrid_message_id Single Line Text for Brief 13 reply matching via In-Reply-To headers + send_failure_count Number + last_send_failure_reason Long Text), reply correlation (reply_received Checkbox + reply_received_at Date with time + reply_classification Single Select — created here, populated by Brief 13). Round-trip verification (D.4 + D.5) passed: temporary test draft created via Airtable SDK, all 26 fields persisted correctly through fetch round-trip including JSON-stringified Long Text fields, status state transitions verified (pending_review → sent updates sent_at and sendgrid_message_id), test draft deleted cleanly in finally block. **Living doc updates same commit:** §4.1 documents OutreachDrafts table, §5.5 adds Brief 7d row + amends Brief 13 row wording to include OutreachDrafts reply-write coupling with In-Reply-To matching strategy, §2.2 H1 adds small-roster scoring sensitivity operational note (weight tuning deferred until Brief 18 produces representative roster; pre-Brief-18 operators expect harsher scoring behavior than eventual production). **Brief 12 (production outreach orchestration) unblocked.** *Forward-looking note for Brief 19+ learning loop:* the original_subject/body/proposed_rate_band snapshots in OutreachDrafts are the captured data for the eventual learning brief — separate offline analysis brief that reads OutreachDrafts in batches, produces operator-reviewable pattern reports correlating edit deltas with reply classifications, proposes few-shot bank revisions for operator approval. Never auto-modifies prompt artifacts. §0.2 doctrine extends to learning the same way it extends to operational decisions.

- **2026-06-08** — **Brief 12 done.** Production outreach orchestration shipped. Two new files: `src/skills/outreach_orchestration.js` (~175 lines) implements `runOutreachBatchForBrand(brandId, options)` orchestrating matchCreatorsForBrand → scoreMatches → generateOutreachDraft → persist to OutreachDrafts (status=pending_review) for the top-N floor-passers. Per-creator generation failures accumulate in `errors` array without halting batch. `src/skills/outreach_send.js` (~175 lines) implements `sendOutreachDraft(draftId)` reading from OutreachDrafts, status-checking `pending_review` (load-bearing double-send protection), firing via `sendOutreachEmail()` in new `src/utils/notifications.js`, persisting state transition (status=sent + sent_at + sendgrid_message_id) on success or incrementing send_failure_count + populating last_send_failure_reason on failure. **No cross-module imports** between orchestration and send — OutreachDrafts table is the integration contract; verified by grep confirming zero `import` lines cross the boundary (comment references in docs are not import lines). Two server routes added: `POST /api/outreach/batch` + `POST /api/outreach/send/:draftId`. **`src/utils/notifications.js` created** (new file — SendGrid REST v3 using `fetch()` per the pattern in `payment_handler.js`; `sendOutreachEmail({ to, subject, body })` uses `SENDGRID_OUTREACH_FROM_EMAIL` env var distinct from operator-alert `OWNER_EMAIL`; returns `{ messageId }` from `x-message-id` response header for Brief 13 reply correlation). `src/utils/airtable.js` extended with `outreachDraftsTable` export (one line). `src/skills/brand_outreach.js` + `src/skills/influencer_outreach.js` deleted via `git rm`, resolving `[AUDIT 🟡 #11]` (nichesData.niches crash bug — file removed). `SENDGRID_OUTREACH_FROM_EMAIL` added to `.env`. Verification: 5-step end-to-end against live Airtable + real SendGrid — Step 1: batch ran in 17.7s producing 1 draft (Nate Herkelman, matchResult 2 matches/1 rejected, scoringResult floor 1 passed/1 rejected); Step 2: status=pending_review, original_subject=subject ✓, scoring_metadata present; Step 3: sent to youruhwizard@gmail.com (Zapier brand contact), sendgridMessageId=uG2ZlByqSiW7F6PNCxK9KQ; Step 4: status=sent, sent_at and sendgrid_message_id persisted; Step 5: double-send correctly rejected with explicit error. try/finally cleanup deleted all test drafts. Production-path grep confirms `ignoreEmptyDeliveryEvidence` override never defaults to true in production code (orchestration accepts pass-through; server.js comment only). **Brief 13 (negotiation extension) unblocked** — Brief 13 will write reply correlation data (reply_received / reply_received_at / reply_classification) back to OutreachDrafts via `In-Reply-To` / `References` header matching from SendGrid Inbound Parse, using `sendgrid_message_id` captured in this brief. *Architectural note:* dashboard reject/archive/reopen for OutreachDrafts is Brief 15's scope (dashboard rebuild). Brief 12 does NOT introduce routes for those state transitions.

- _[next entry: after Brief 13 (negotiation extension) is shipped]_
