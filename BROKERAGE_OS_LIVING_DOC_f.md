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
>**Last updated:** 2026-06-19 — **Brief 14-REFRAME done (doc-only).** Founder's week of strategic reflection encoded as doctrine. Five strategic shifts landed: positioning → AI-native enforcement/execution OS; offer → $2K/mo + 3.6% fee (15% brokerage fee killed); Stripe economics → brand absorbs all costs upstream at campaign funding; liability → brand configures enforcement, platform faithfully executes; workflow → Stream A/B/C split as doctrine. New sections §0.5.B (liability model) and §0.5.C (comprehensive audit logging surface) added. §0.5, §0.5.A, §4.4, §4.6, §4.7, §4.8, §5.5, §6, §10 updated. Cleanup candidates K.17–K.21 surfaced. All downstream briefs (14.2, 14.3, 14.6, 14.7, 14.8, 15+) unblocked with full architectural precision.

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

### 0.5 Operating system economics and offer structure (read this before anything else) `[updated 2026-06-19 — Brief 14-REFRAME]`

**What this product actually is — the sentence the rest of the system has to serve:**

> **The platform is an AI-native enforcement and execution layer for creator deals and marketing campaigns at any scale. It sells structured, automated campaign enforcement as software — the thing talent agencies and internal teams do manually at $5–25K/month, packaged as an operating system brands subscribe to.**

The product does not sell:
- Creator matching as a core value proposition (matching is a feature and a wedge — it gets brands in; the OS keeps them inside)
- Outreach (outreach is the acquisition mechanism; intelligence-led outreach is a feature in service of the enforcement function)
- Contracts (contracts are the artifact of the enforcement function; the platform automates their generation and lifecycle)

The product sells: **enforced campaign execution — deliverables received, compliance maintained, brand safety preserved, budget protected, performance tracked. Brands bring creators or let the platform recommend them. The system runs the rest.**

Every architectural decision downstream of this definition must be checked against it. If a feature does not serve the enforcement and execution function — or worse, makes that function less visible to the brands paying for it — it does not belong in the system.

**The BYOC unlock (brand-bring-your-own-creator):** brands can import their own existing creator relationships into the platform. The platform provisions creator dashboards, runs contracts, manages payouts, and enforces compliance for those creators — even creators the platform didn't source. This removes the hardest dependency in the space (supply of platform-curated creators), replaces the marketplace identity with "control of new or existing creator relationships," and opens the platform to enterprise buyers who already have creator relationships but lack the enforcement infrastructure to run them reliably.

**Competitive white space:** CreatorIQ and Impact.com show what happened — they are discovery and tracking layers. Talent agencies and internal teams enforce, but manually, via human labor at $5–25K/month. Nobody has packaged "structured automated enforcement with escalation routing and contract lifecycle management" as software. That is the actual white space the platform occupies.

**The wedge structure:** creator acquisition / BYOC / matching / platform-curated roster / AI brief generation / negotiation classification are the wedges that get brands in. The operating system — compliance engine, contract lifecycle, payout holds, audit logging, Lara, brand-configurable enforcement rules — is what keeps brands inside. The wedge gets the deal; the OS justifies renewal.

**Vocabulary scope:** the platform serves the full creator economy — not just influencers. This includes streamers (Twitch, Kick), video creators (YouTube, Instagram, TikTok), podcasters, niche experts and community owners, and industry personalities. The primitives are the same: deliverables, payout holds, compliance criteria, brand safety rules, contract terms. "Influencer" is a historical label; the operational vocabulary is "creator."

---

**Operating system economics and offer structure (locked 2026-06-19):**

**1. Subscription — $2,000/month (system access).** Single tier, no usage tiers, no "first 5 brands free" logic. The subscription covers:
- LLM usage (brief generation, matching, scoring, negotiation classification, Lara, Mode 2)
- Enforcement system (compliance engine, contract lifecycle, breach detection, escalation routing)
- Brand-facing dashboard AND creator-facing dashboard provisioned on behalf of the brand
- Full workflow automation (outreach, negotiation, contract handoff, payment, deliverable upload, approval, payout release)
- Campaign brief creation AND iteration (CCI Mode 1 + revisions)
- Brand-configurable enforcement logic (payout schedules, release triggers, contract terms, breach conditions)
- Platform-curated creator curation (as a feature inside the funnel, not the core value proposition)
- Operating system uptime and data integrity

**2. Transaction fee — 3.6% at campaign creation (execution usage).** Charged at campaign funding time (Stage A5 acquisition checkout or Stage P6 in-dashboard checkout). Covers Stripe Connect infrastructure usage, payment routing, workflow execution at scale, operational load scaling at high campaign volume.

**Brand funding model (brand absorbs all costs upstream):** when a brand funds a campaign, the total charged to the brand is:

```
Creator total payout:          $20,000
Platform fee (3.6%):              $720
Stripe processing fees:             $X  (computed based on Stripe Connect plan and routing)
─────────────────────────────────────────
Total brand funding at checkout:  $20,000 + $720 + $X
```

This definition emerged through the 2026-05-30 strategic stress-test (§2.2 and Changelog 2026-05-30) and was sharpened by the 2026-06-19 strategic reframe (Changelog 2026-06-19). The §2 strategy mechanisms all pre-existed this frame; this frame explains what they are *for* and what economic model they serve.

### 0.5.A Product Positioning and Category `[rewritten 2026-06-19 — Brief 14-REFRAME]`

§0.5 defines the economic model (OS economics, $2K + 3.6%). §0.5.A defines the category this product occupies and how it is positioned against alternatives. The two layers must be understood together.

**Layer 1 — Economic model (§0.5):** subscription + transaction fee. Enforcement function as software. Brand-configurable rules, platform faithfully executes. The function this platform monetizes.

**Layer 2 — Product surface (§0.5.A):** the user-facing experience is software, not service. Brands experience: structured campaign intake, AI-matched creator recommendations, automated negotiation, contract execution, configurable enforcement rules, compliance tracking, payout release, lifecycle querying via Lara. Creators experience: workflow tooling for deliverable submission, payout tracking, compliance visibility. The operator runs the system; the system performs the enforcement and execution function. The product surface is AI-driven SaaS-shaped.

**Why both layers matter:**

- The economic model (§0.5) justifies the unit economics and the strategic moat. Without the enforcement function and the OS model, the platform is competing as a creator marketplace, where margin is structurally compressed and there is no moat.
- The product surface (§0.5.A) justifies the category positioning, the investor framing, and the frontend engineering direction. Without the product surface framing, downstream briefs produce service-shaped UIs — brokerage workflow leakage rather than software-shaped UIs that abstract the enforcement work as invisible infrastructure.

**The competitive position:**

| Competitor | What they do | Gap |
|---|---|---|
| CreatorIQ, Impact.com | Discovery and post-campaign tracking — show what happened | No enforcement; no contract lifecycle; no compliance automation |
| Talent agencies, internal teams | Manual enforcement at $5–25K/month human labor cost | Not software; does not scale; not available on-demand |
| **This platform** | Structured automated enforcement as SaaS | The actual white space: nobody packages this as software |

**Critical distinction for downstream briefs:**

- **Brief 15 (operator dashboard):** system-administration surface where the operator monitors the enforcement OS. Not deal-management shaped.
- **Brief 15b (brand portal/dashboard):** software, not service. The brand configures enforcement rules, launches campaigns, monitors compliance, manages payouts. They interact with a product, not a relationship with a broker.
- **Brief 15c (creator portal):** workflow tooling. Creators upload deliverables, track payouts, see compliance status. Not a creator-management interface — the creator's relationship is with the brand via the platform, not with the platform independently.
- **Brief 15d (AI support + escalation):** Lara is the natural-language routing surface over read endpoints + escalation trigger. SLA-bound. Human escalation is the layer behind it. Trust substitute for founder visibility (Decision C).
- **Future Campaign Creation Interface (post-Brief 16):** planner surface for returning brands inside the dashboard. Structurally a planner (§0.5.1) — produces structured campaign briefs and creator recommendations; does not execute state changes. Mode 1 is structured intake; Mode 2 is contextual conversation. Both are read-only on Airtable.

**What this distinction does NOT change:**

- The §2.2 trust stack (H1 curation as underwriting, H2 institutional visibility, H3 bounded guarantee) is unchanged.
- The §2.3 (Decision A) bounded guarantee is unchanged.
- The §2.4 (Decision B) portal architecture (deal framework first) is unchanged.
- The §2.5 (Decision C) institutional visibility is unchanged.
- The §2.6 (Decision D) 80/20 creator payout default is unchanged.
- The §2.7 (Decision E) process-ownership funnel is unchanged.
- The §0.6 governance doctrine is unchanged.

The product surface framing sits on top of the function. It does not replace the function. Frontend engineering reads §0.5.A to understand what shape to build. Strategic decisions read §0.5 to understand what economic model the function serves.

**Comparison framing (for positioning, not lifted into brand-facing copy):**

Uber is a logistics + routing + marketplace system that replaces human dispatching. Internally it is still a transportation-economics business; the surface is software. This platform is structurally analogous: an AI campaign-creation + matching + enforcement system that replaces manual deal-brokering and creator campaign management. The enforcement work is real and substantial; the surface is software. Internal team thinks in Layer 1 terms; external positioning leads with Layer 2.

### 0.5.1 Planner / Executor Doctrine (locked 2026-06-12 supplement)

The system has two functional roles that must never be mixed in implementation. This is architectural doctrine, not implementation detail — mixing the two produces a category of failure where LLM-driven reasoning silently triggers state changes, which is exactly the failure mode §0.2 doctrine warns against.

**Planner — produces structured outputs, no side effects.**

The planner reads structured input from the user, augments with LLM intelligence, outputs structured recommendations. Specifically:

- Reads from Airtable, web search, and other read-only data sources
- Augments the read context with LLM reasoning
- Produces structured outputs: campaign briefs, creator recommendations, performance projections, contextual insights
- Token-bounded — known cost ceiling per planner invocation (same discipline as Brief 9b outreach engine with its 5-6 link search cap)
- Deterministic-ish where possible — same input shape should produce similar output shape
- **Read-only on Airtable.** Cannot write records. Cannot trigger state changes.
- Cannot invoke executor functions

Planner examples (existing and future):
- Brief 9b's `outreach_engine.js` — produces structured outreach drafts from brand+creator context (technically does write, but writes only to OutreachDrafts as draft records, which are pre-decision artifacts; downstream executor decides whether to send)
- Future Campaign Creation Interface (post-Brief 16) — Mode 1 structured intake (captures brand-configured enforcement rules, campaign objectives, creator preferences; single-pass planner output) + Mode 2 contextual conversation (read-only scoped LLM, thinking partner; cannot mutate brand-configured rules — only Mode 1 can) (see §4.7)

**Executor — acts on structured inputs to produce real outcomes, has side effects.**

The executor consumes structured inputs (campaign briefs, locked compliance_specs, OutreachDrafts, ComplianceEvents) and acts on them. Specifically:

- Reads structured inputs from planner outputs and from existing state
- Writes to Airtable. Triggers Stripe transfers. Generates PandaDoc contracts. Sends emails via SendGrid. Modifies state.
- Has side effects. Every executor call may change the real world (money moves, contracts ship, emails fire)
- **Cannot invoke planner functions during execution.** Executor logic is deterministic and does not reason via LLM during the act of executing

Executor examples:
- Brief 10's `matching_engine.js` — pure deterministic match logic
- Brief 11's `scoring_engine.js` — pure deterministic scoring
- Brief 12's `outreach_orchestration.js` and `outreach_send.js` — orchestrates outreach generation and send pipeline
- Brief 13's `negotiation_handler.js` — classifies replies and writes correlation data
- Brief 14's `compliance_engine.js` + `contract_generator.js` + `payment_handler.js` — locks deals, generates contracts, releases payouts, derives compliance state

**The rule: planner never invokes executor functions directly. Executor never invokes planner functions. They communicate only through structured documents.**

The structured document is the integration contract:

- Planner produces a campaign brief → executor reads the brief
- Planner recommends creators → executor writes OutreachDrafts based on operator approval of recommendations
- Executor locks a deal → planner reads the locked compliance_spec for downstream contextual insights
- Executor records ComplianceEvents → planner reads events to produce status summaries for contextual conversation

**Why this matters:**

Mixing planner and executor produces systems where LLM-driven reasoning silently triggers state changes. Example: a planner that "recommends" a creator and then writes to Airtable on the recommendation directly. This makes LLM hallucination a state-mutation risk. The architectural separation is: planner recommends → operator (or rule) approves → executor acts. The approval gate is the chokepoint where human or deterministic judgment intervenes between AI reasoning and state mutation.

This is the same discipline as §0.2's "human review is the verification step." The planner/executor split formalizes it as architecture, not just process.

**Doctrine implications for downstream briefs:**

- Brief 15b (brand dashboard): the Launch Campaign tab is a planner surface (produces campaign briefs, recommends creators, generates projections). It does NOT execute the deal lifecycle. Approval moves the planner output into the executor pipeline (Brief 14's lock flow).
- Brief 15d (Lara): Lara is a planner-shaped routing surface (reads state, produces natural-language answers). She does not execute state changes directly — when escalation is needed, she hands off to the operator (human) who is the executor.
- Future Campaign Creation Interface: explicitly two-mode (Mode 1 structured intake = planner; Mode 2 contextual conversation = planner with read-only LLM). Both modes are planner-shaped. Approval transitions to executor (Brief 14 lock pipeline).
- Future learning loop (Brief 19+): reads executor-produced data (OutreachDrafts edits, reply outcomes), proposes prompt revisions for operator review. Operator review is the approval gate. The learning loop never auto-modifies prompt artifacts.

**What this doctrine forbids:**

- LLM-driven autonomous state changes (e.g., AI agent that books a deal)
- Planner functions that write to Airtable beyond pre-decision artifacts
- Executor functions that invoke LLM during execution (deterministic only)
- "AI agents" in the autonomous-action sense — the system uses LLMs as routing and reasoning layers, never as autonomous actors

### 0.5.B Platform Liability Model `[NEW 2026-06-19 — Brief 14-REFRAME]`

This section is the reference point downstream briefs cite when scoping product features. Any feature that approaches the liability boundary (e.g., "should the platform judge creator content quality?") gets pushed back against this doctrine.

**The execution doctrine:** the platform is an execution engine over brand-defined rules. Same liability posture as Stripe for payments and Shopify for commerce — infrastructure that faithfully executes the merchant's configured rules. The platform does not adjudicate disputes that fall outside the brand's configured rules. It executes rules; it does not arbitrate when parties disagree about whether a deliverable met spec (that is the brand's call per their configured criteria).

**What the platform CARRIES as liability:**
- **Platform terms of service** — the agreement the brand signs when subscribing
- **Uptime and data integrity** — standard SaaS SLA territory
- **Stripe Connect integration correctness** — if the platform misroutes a payment, that is on the platform
- **Faithful execution of brand-configured enforcement rules** — if the brand says "release 20% on day 30 if no breach," the platform must do exactly that, accurately, on time
- **Data privacy / GDPR / CCPA / PIPEDA** on stored data — standard SaaS

**What the platform does NOT CARRY:**
- **KYC/AML on creators** — Stripe Connect handles this through its onboarding flow; creators onboard via Stripe Connect link; Stripe runs KYC, handles tax forms (1099 generation), manages bank verification, files SARs
- **Tax handling for creator payments** — Stripe Connect
- **Dispute adjudication outside brand-configured rules** — the platform executes rules; it does not arbitrate subjective disputes between brand and creator
- **Substance of the campaign brief** — the brand owns the brief content; the platform helps generate and iterate it via LLM (planner, §0.5.1) but the brand owns the final spec
- **Brand safety judgments outside brand-configured rules** — the platform flags compliance breaches per brand-configured criteria; it does not have an opinion about whether a creator's content is "good for the brand" beyond what the brand defined as their enforcement criteria

**Stripe Connect setup (unchanged from Brief 14):** creators onboard via Stripe Connect link provisioned by the platform. Stripe runs KYC, handles 1099 generation, manages bank verification, files SARs. Platform's exposure: keep the Stripe Connect integration correct and respond to Stripe's compliance escalations. The platform's liability boundary at the Stripe layer is integration correctness, not creator KYC.

**Brand-configurable enforcement surfaces (Brief 14.7 scope):**
The brand-facing dashboard exposes enforcement configuration as a first-class product surface:
- **Payout splits:** brand chooses arbitrary split percentages (80/20 default; could be 50/50, 100% on delivery, milestone-based multi-release). Default fallback: 80/20 + day-30 (Brief 14's current hardcoded behavior becomes the fallback-when-unspecified after Brief 14.7)
- **Release triggers:** brand chooses what triggers each payout release (day-N elapsed time, deliverable_uploaded event, brand_approval event, operator manual confirmation, combinations)
- **Contract terms:** brand provides their own template OR uses platform's structured template with brand-configurable clauses (exclusivity period, usage rights duration, revisions allowed, geographic scope)
- **Breach conditions:** brand defines what constitutes a breach (deliverable not uploaded by date X, deliverable does not meet spec, creator goes off-message)
- **Compliance criteria:** brand defines what criteria must be met for campaign completion and held payout release

**Cross-references:**
- Stripe Connect economics: §0.5 brand funding model
- Comprehensive audit logging surface: §0.5.C
- Brand-configurable enforcement implementation: Brief 14.7
- Creator onboarding in BYOC flow: §4.6 Stage A3 / §4.8

### 0.5.C Comprehensive Audit Logging Surface `[NEW 2026-06-19 — Brief 14-REFRAME]`

Enterprise trust requires comprehensive audit coverage. This section enumerates the required audit logging surface. Much of it exists today (ComplianceEvents + OutreachDrafts + Stripe API logs); Brief 14.7 identifies the gaps and ships structural additions. This section is the enumeration Brief 14.7 reads to scope the gap analysis.

**Campaign creation logs:**
- Timestamp + actor (brand user ID, IP, user agent) + campaign spec snapshot at creation time
- Brand funding requirement breakdown at checkout (creator payout total, platform fee, Stripe fees, total funded amount)
- Brand-configured enforcement rules at campaign creation time (payout splits, release triggers, contract terms, breach conditions)
- Stripe Checkout session ID + PaymentIntent ID + `metadata.deal_id`

**Creator assignment logs:**
- Distinguish BYOC (brand-imported) from platform-curated explicitly for every deal
- For BYOC: import timestamp + brand user who imported + creator-side onboarding status (Stripe Connect link sent, accepted, KYC completed by Stripe)
- For platform-curated: matching engine output + Brief 11 scoring metadata + brand selection event + creator outreach trigger
- Creator acceptance event (creator accepts campaign brief, signs contract)

**Message logs:**
- All outreach, negotiation, and brand-creator communication
- Sender, recipient, timestamp, content (full retention per retention policy)
- LLM classification output for inbound replies (green_yes / green_pricing_q / yellow_general_q / red_pushback / red_escalation per Brief 13)
- Operator interventions (when operator overrides classification, manually responds, edits a draft)
- Cross-reference to OutreachDrafts table + ComplianceEvents

**Payout logs:**
- Full payout schedule computed and frozen at lock time (immutable post-lock)
- Actual release events: timestamp + trigger that fired the release + Stripe transfer ID + amount + recipient connected account ID
- Brand-configured rules that governed the release (which rule set applied at lock time)
- Any compliance gates that delayed or blocked a release

**SLA timestamps on every workflow stage transition:**
- Outreach sent → reply received
- Reply received → match locked
- Match locked → contract sent
- Contract sent → contract signed (brand + creator separately timestamped)
- Contract signed → deliverable uploaded
- Deliverable uploaded → brand approval (or rejection with reason)
- Brand approval → first payout released
- First payout released → release trigger met for held portion
- Release trigger met → held portion released

**Deliverable tracking:**
- Upload timestamp + uploader identity (creator) + file reference
- Brand approval timestamp + approver identity (brand user)
- Rejection events with brand-supplied reason
- Revision request events
- Final approved version reference

**Coverage gap analysis:** ComplianceEvents (10-field table, Brief 14) covers most of the post-lock audit trail. OutreachDrafts (Brief 7d) covers the outreach/negotiation message log. Stripe API logs (external) cover payment events. Gaps to be identified in Brief 14.7: (1) campaign creation actor logging (who, when, from what IP), (2) brand-configured enforcement rules snapshot at lock time, (3) BYOC vs curated creator assignment distinction in the audit trail, (4) SLA timestamps for pre-lock stages. Brief 14.7 identifies gaps and ships the structural additions.

**Cross-references:**
- ComplianceEvents schema: §4.1
- OutreachDrafts schema: §4.1
- Gap analysis and structural additions: Brief 14.7

### 0.6 BROKERAGE GOVERNANCE DOCTRINE (locked 2026-05-30)

Three principles that the strategy structurally depends on. These are not implementation details — they are operating disciplines that, if abandoned under pressure, cause the strategy to degrade in execution even when it looks correct on paper. They live in §0 because they are the things you forget under pressure.

**0.6.1 — Roster growth is subordinate to roster quality.**
The guarantee model (Decision A, §2.3) assumes a compliance-failure rate below ~15%. That assumption is held entirely by the curation bar on the creator roster. The first time supply-side discipline is relaxed for acquisition pressure ("they're close enough, the volume's worth it"), the strategy starts degrading invisibly until the failure rate spikes. The guarantee does not *create* this risk — the risk exists in any premium brokerage with selective inventory — but the guarantee *exposes the consequences mechanically and visibly* rather than slowly and deniably. Early-warning signal: any roster addition that wouldn't have qualified under the original bar. Pre-committed response: a written curation bar (artifact owned by Brief 18) and periodic roster audits against the bar.

**0.6.2 — Escalation path integrity is the institutional credibility test.**
Decision C (§2.5) substitutes institutional visibility for founder visibility via AI support + defined human escalation. This works in the steady state. It fails the moment the escalation path doesn't fire or doesn't respond within the committed window (Mon–Fri 7:30am–8pm EDT). The failure signal is not "we're not Don-shaped enough" but **measurable escalation-path failure** — a brand event that should have triggered escalation didn't, or did and was not handled inside the SLA. Pre-committed response: surface escalation response times in the operator dashboard as a first-class metric; have a personal-fallback ready for high-stakes situations where institutional framing isn't landing (the framing is the default, not a rule).

**0.6.3 — The enforcement function must remain legible as the product.**
The better the system works, the less visible the value becomes — brands see smooth campaigns and conclude "I could do this myself." Sophisticated creators see closed deals and conclude "I could find these brands directly." Both are wrong, but you can lose them before they realize they were wrong. The enforcement function (dual contracts, compliance object, escalation map, curation underwriting, payout discipline) must be continuously surfaced in brand- and creator-facing artifacts — not buried as features. Decision E (§2.7) is the structural answer: the process-ownership funnel as persistent visible artifact. Early-warning signal: brand churn after one or two successful campaigns ("we know how this works now"); creator pushback on the subscription fee or platform transaction fee as deals scale. Pre-committed response: portal copy, contract preambles, dashboard headers explicitly frame what is being sold ("we run an enforcement and execution system for creator campaigns"), repeated across surfaces.

---

## 1. SYSTEM IDENTITY & CURRENT STATE

**What it is:** An AI-native enforcement and execution platform for creator deals and marketing campaigns (§0.5). The operator (alamir / GitHub: Donsnizito) runs the system. The platform discovers brands and curates a creator roster, runs intelligence-led outreach, classifies inbound replies via LLM, presents a deal-framework-first portal where the brand self-selects from curated creators or imports their own (BYOC), generates contracts, collects payment ($2K/mo subscription + 3.6% campaign fee), disburses creator payouts under brand-configured enforcement rules, and surfaces compliance and escalation state to both sides during the campaign lifecycle.

**Repo:** github.com/Donsnizito/influencer-brokerage-os (private)
**Local path:** `C:\Users\Shadow\.gemini\antigravity\scratch\influencer-agency`
**Deployment:** Render Web Service (free tier) at `https://influencer-brokerage-os.onrender.com`
**Stack:** Node.js v18+ (ESM only), Express, Airtable (primary DB), SendGrid (outbound + Inbound Parse), Anthropic Claude Sonnet 4.6 (`claude-sonnet-4-6`), PandaDoc (contracts), Stripe (LIVE mode, invoicing/payments + payment_intent.succeeded lock pipeline), Apify (lead discovery — superseded; see §6).

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
```

### 3.2 Key exports (for writing briefs against)
- `server.js` `[VERBATIM]`: no exports. Routes: `POST /webhooks/stripe`, `POST /webhooks/pandadoc`, `POST /webhooks/sendgrid/inbound`, `POST /webhooks/sendgrid/bounce`, `GET /roster`, `POST /api/roster/select`, `POST /api/roster/decline`, `GET /api/deals`, `POST /api/release_payout`, `POST /api/confirm_payout_complete`, `POST /api/generate_contracts`, `POST /api/create_invoices`, `POST /api/approve_action`. Planned additions: brand-portal routes, creator-portal routes, escalation routes, support-assistant routes (all owned by Briefs 15b/15c/15d).
- `payment_handler.js` `[VERBATIM]`: exports `createInvoices()`, `releasePayout(dealId)`. Internal `sendOperatorPayoutAlert()` (SendGrid REST). **Brief 14 extends** to support 80/20 creator payout split with day-30 auto-release of held 20%.
- `negotiation_handler.js` `[VERBATIM — Brief 13 done]`: exports `processInboundEmail({ record, emailText, senderType, senderEmail, inReplyToHeader, referencesHeader })`, `generateRosterLink(brandId)`. `classifyNegotiation(emailText, senderType, dealContext)` is internal (not exported). 5-label taxonomy: `green_yes` | `green_pricing_q` | `yellow_general_q` | `red_pushback` | `red_escalation`. Two new RED triggers: `guarantee_scope_expansion` (brand requests view/conversion/impression/performance guarantee) + `payout_structure_pushback` (creator requests full upfront or non-standard split). Three-tier reply-to-draft matching: Tier 1a (In-Reply-To → sendgrid_message_id exact match) → Tier 1b (References chain match) → Tier 2 (most-recent-sent-to-sender heuristic) → Tier 3 (no-match, operator manual). Deal-range context fetched from matched draft → brand + creator links. `writeReplyCorrelationToDraft` is the single write path for Brief 19+ learning loop. System prompt loaded from `src/prompts/negotiation_system.md` at module init (fails loud if missing or markers malformed). `classifyAndExtract` in `llm.js` no longer called from this module (Q5=migrate; chatCompletion tool-use used instead). **Brief 14 extends** to wire the match-lock → contract handoff with the new taxonomy.
- `email_headers.js` `[VERBATIM — Brief 13, NEW]` (`src/lib/email_headers.js`): exports `extractHeaders(headersFieldText, headerNames)`, `normalizeMessageId(messageId)`, `parseReferencesHeader(referencesHeader)`. Pure string parsing; no LLM calls, no Airtable lookups, no negotiation-specific logic.
- `contract_generator.js` `[CLEAN per AUDIT]`: exports `generateContracts()`. **Brief 14 extends** to write the `compliance_spec` object into both brand-side and creator-side PandaDoc contracts as structured terms.
- `llm.js` `[AUDIT]`: exports `classifyAndExtract({systemPrompt,userMessage,expectedSchema})` AND dead `chatCompletion({systemPrompt,userMessage})`. **Brief 9 wires `chatCompletion` and encodes the doctrine (deal-framework-first framing, guarantee scope language, curation-as-underwriting frame, escalation availability signal — see §2.2/§2.3/§2.4/§2.5).**
- `niches.js` `[CLEAN]`: `getParentNiche`, `getParentLabel`, `getChildNiches`, `getAllSubNiches`, `normalizeNicheString`, `validateNiche`.
- `airtable.js` `[CLEAN — Brief 14]`: `influencersTable`, `brandsTable`, `dealsTable`, `webhookEventsTable`, `outreachDraftsTable`, `complianceEventsTable` (Brief 14), `unresolvedPaymentsTable` (Brief 14 Pin 1), `fetchRecords`, `updateRecord`, `createRecord`, `deleteRecord`.
- `webhook_idempotency.js` `[CLEAN]`: `findExistingEvent`, `recordReceive`, `markProcessed`, `markFailed`.
- `compliance_engine.js` `[NEW — Brief 14]`: exports `validateLockedSpec(spec) → { valid, errors }`, `deriveDealState(deal, events) → { status, payout_status, conditionsMet, evidence, flags }`, `checkDay30Eligibility(deal, events) → { eligible, reason, daysRemaining, approvalEvent }`. Pure functions, no side effects, no Airtable writes. consumed by server.js read endpoints + Brief 15 dashboards + Brief 15d Lara + Brief 16 equivalence test.
- `payment_handler.js` `[VERBATIM — EXTENDED Brief 14]`: exports `createInvoices()`, `releasePayout(dealId)` (unchanged), `release80Percent(dealId)`, `release20Percent(dealId)`, `sendOperatorAlertForUnresolvedPayment({ paymentIntentId, stripeEventId, customerEmail, amount, timestamp })`. Internal `sendOperatorPayoutAlert()` (SendGrid REST) unchanged. **New imports:** `complianceEventsTable`, `unresolvedPaymentsTable` from airtable.js; `sendOutreachEmail` from notifications.js.

### 3.3 The one LLM call site (current state) and what comes
Brief 13 completed the intelligence engine's inbound side. Active LLM call sites as of Brief 13: (1) `outreach_engine.js → chatCompletion()` via `llm.js`, tool `outreach_draft`, model `claude-sonnet-4-6` — generates outreach emails. (2) `negotiation_handler.js → classifyNegotiation() → chatCompletion()`, tool `classify_reply`, model `claude-sonnet-4-6` — 5-label inbound reply classifier with deal-range awareness. `classifyAndExtract()` in `llm.js` is now dead code (no callers); left exported for backward compat, to be removed in a future cleanup brief. **Everything the strategy calls for on the buy-side — match-lock → contract handoff, compliance engine, 80/20 payout enforcement, dashboard rebuild, customer portals — still in backlog (Briefs 14–16).**

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
- `compliance_spec` (Long Text, JSON-stringified object) — frozen at lock time (LOCKED status). Schema: `docs/compliance_spec_schema.md`. Full field table, invariants, and examples in that doc.
- `compliance_status` (Long Text, JSON-stringified object) — derived state per condition with timestamped evidence. Do NOT write manually — always re-derive via `deriveDealState()` or read from `GET /api/deals/:dealId/compliance-status`.
- `creator_payout_schedule` (Long Text, JSON-stringified object) — tracks 80/20 split status:
  ```json
  {
    "total_payout_to_creator": 8500,
    "split_80_amount": 6800,
    "split_20_amount": 1700,
    "split_80_released_at": null,
    "split_80_stripe_transfer_id": null,
    "split_20_released_at": null,
    "split_20_stripe_transfer_id": null,
    "compliance_hold": false
  }
  ```
  Written by `handleStripePaymentSucceeded()` at lock time; updated by `release80Percent()` and `release20Percent()` in payment_handler.js.
- `escalation_events` (Long Text, JSON-stringified array) — log of escalation triggers fired on this deal, response times, resolution status (Brief 15d surface).

**Brief 14 additions to Deals:**
- `pandadoc_brand_document_id` (Single Line Text) — PandaDoc document ID for the brand-side contract. Written by `contract_generator.js` on contract creation. Used by PandaDoc webhook (E.3-α lookup) to determine which party signed.
- `pandadoc_creator_document_id` (Single Line Text) — PandaDoc document ID for the creator-side contract. Same pattern.

**WebhookEvents:** `event_id`, `provider`, `event_type`, `verified`, `processed`, `received_at`, `raw_payload`, `notes`.

**OutreachDrafts (NEW — Brief 7d):** persistent store for LLM-generated outreach drafts between generation (Brief 12) and operator review/send (Brief 15 dashboard). 26 fields covering identity (draft_id Autonumber + brand_id/creator_id linked records), status (pending_review/sent/rejected/archived state machine), the 8-field LLM output contract from Brief 9b (subject, body, fit_assessment, fit_rationale, proposed_rate_band, evidence_used, search_queries, flags), Brief 11 scoring_metadata preserved per-draft, edit-tracking snapshots (original_subject/body/proposed_rate_band — never updated after creation), audit timestamps (created_at/sent_at/rejected_at/archived_at), send tracking (sendgrid_message_id/send_failure_count/last_send_failure_reason), and reply tracking (reply_received/reply_received_at/reply_classification — created here, populated by Brief 13). The original_* snapshots preserve LLM output before operator edits so a future learning brief (Brief 19+) can extract patterns from the delta between LLM output and shipped output, correlated with reply outcomes.

**ComplianceEvents (NEW — Brief 14):** audit trail for the full deal compliance lifecycle. 10 fields:
- `event_id` (Autonumber) — primary key
- `deal_id` (Link to Deals) — required link to the Deal
- `event_type` (Single Select) — values: `payment_released_80` | `payment_released_20` | `contract_signed_brand` | `contract_signed_creator` | `brand_approval` | `breach_report` | `delivery_rejected` | `compliance_event_manual` | `delivery_uploaded` | `campaign_live`
- `event_at` (Created Time) — auto-populated by Airtable on record creation
- `event_payload` (Long Text, JSON) — structured payload (event-type-specific; schema documented per-type in compliance_spec_schema.md)
- `event_attachment` (Attachment) — for delivery evidence (screenshots, URLs)
- `event_source` (Single Select) — `system_derived` | `operator_manual` | `brand_portal` | `creator_portal`
- `event_actor` (Single Line Text) — who wrote the event: `stripe_webhook` | `pandadoc_webhook` | `payment_handler` | `operator` | system-module name
- `event_notes` (Long Text) — human-readable description of what happened
- `updated_at` (Last Modified Time) — auto-populated by Airtable

**UnresolvedPayments (NEW — Brief 14 Pin 1):** durable operator-recovery surface for `payment_intent.succeeded` events arriving without `deal_id` metadata. 7 fields:
- `payment_intent_id` (Single Line Text) — Stripe PI ID
- `stripe_event_id` (Single Line Text) — the Stripe event ID that triggered this record
- `customer_email` (Email) — from `receipt_email` or `customer` field on the PaymentIntent
- `amount` (Number, Currency) — payment amount in USD (stored as dollars, not cents)
- `received_at` (Created Time) — auto-populated
- `resolved_at` (Date with time, optional) — operator sets when resolved
- `resolution_notes` (Long Text, optional) — operator notes on how the record was resolved

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

### 4.4 Full status state machine `[VERBATIM/REPORT-confirmed, extended Brief 14 + Brief 14-supplement]`
- **Influencer:** `INFLUENCER_DISCOVERED` → `QUOTE_REQUESTED` → `QUOTE_RECEIVED` → `DEAL_INITIATED`. Also `COLD`, `INVALID_EMAIL`, `BOUNCED`. **Cross-cutting:** `roster_eligibility` enum tracks supply-side standing independent of status (Decision D / Brief 7b).
- **Brand:** `BRAND_COLD` → `BRAND_PITCHED` → `INTERESTED` → (deal-framework portal entry → roster select) → `DEAL_INITIATED`. Also `ROSTER_DECLINED`, `INVALID_EMAIL`, `BOUNCED`.
- **Deal (post-Brief-14 canonical state machine, dual-path pre-lock):**
  - **Acquisition path (first deal per brand):** `CART_DRAFT` (Selection Cart entry, §4.6 Stage A3, pre-payment, brand may be unauthenticated) → `payment_intent.succeeded` Stripe webhook → `LOCKED`
  - **Continuous path (returning brand subsequent campaigns):** `CAMPAIGN_DRAFT` (Campaign Creation Interface Mode 1 output composed, brand reviewing in Mode 2, §4.7 Stage P3-P4) → `CAMPAIGN_APPROVED` (brand approved recommendations, awaiting payment, §4.7 Stage P5) → `payment_intent.succeeded` Stripe webhook → `LOCKED`
  - **Both paths converge at LOCKED.** The lock pipeline handles both transitions identically. The pre-lock state is metadata about which flow produced the deal; lock pipeline behavior is path-agnostic.
  - **Post-lock (unified for both paths):** `LOCKED` (spec frozen, brand-configured enforcement rules frozen, payout schedule initialized) → `CONTRACTS_SENT` (both PandaDoc docs generated and sent) → `CONTRACTS_SIGNED` (both parties signed; each signature writes a ComplianceEvent) → `INVOICE_SENT` → `PAYMENT_COLLECTED` → `DELIVERY_UPLOADED` (creator uploads via §4.8 creator dashboard) → `DELIVERY_APPROVED` (operator approves, triggers first payout per brand-configured split) → `CAMPAIGN_LIVE` → (compliance window per brand-configured hold period) → `PAYOUT_HELD_RELEASED` (release trigger fires per brand-configured rules) → `CAMPAIGN_COMPLETE` (day 90 or brand-configured window).
  - **Note on payout state labels:** Brief 14's hardcoded 80/20 split uses `PAYOUT_20_RELEASED` as the held-portion-released state. After Brief 14.7 ships brand-configurable enforcement, the label generalizes to `PAYOUT_HELD_RELEASED` (configurable split, configurable trigger). Both are canonical during the transition period.
  - `BREACH_FLAGGED` — entered if `validateLockedSpec()` fails post-payment, OR if a `delivery_rejected` or `breach_report` ComplianceEvent fires post-lock. Operator must resolve before pipeline progression continues.
  - `CANCELLED` — pre-lock cancellation. Both `CART_DRAFT` and `CAMPAIGN_DRAFT`/`CAMPAIGN_APPROVED` can transition to `CANCELLED` (cart abandoned, deal declined, brand changes mind pre-payment).
  - **[K.6 STATUS COEXISTENCE — see §6]:** Pre-Brief-14 pipeline used `DEAL_LOCKED` (now `LOCKED`), `CONTRACT_SIGNED` (now `CONTRACTS_SIGNED`), `CONTRACT_SENT` (now `CONTRACTS_SENT`). Both values are written in parallel during the transition period (see K.6/K.7 in §6 for cleanup criteria).
- **Compliance-failure branches (Brief 14/15d):** at any point during the compliance window, a compliance failure event (breach_report or delivery_rejected ComplianceEvent) flips `deriveDealState().status` to a breach value and triggers either (a) credit-and-replacement remediation (Decision A) which spawns a new linked deal, or (b) creator breach flagging (Decision D) which flips `roster_eligibility` to `flagged_breach`.

### 4.5 Env vars (synced local `.env` ↔ Render)
`AIRTABLE_API_KEY`, `AIRTABLE_BASE_ID`, `SENDGRID_API_KEY`, `SENDGRID_WEBHOOK_PUBLIC_KEY`, `SENDGRID_VERIFY_STRICT=true`, `STRIPE_SECRET_KEY` (LIVE `sk_live_`), `STRIPE_WEBHOOK_SECRET` (live whsec_), `PANDADOC_API_KEY`, `PANDADOC_WEBHOOK_SECRET`, `PANDADOC_BRAND_TEMPLATE_ID=xp9DuLRJdUsP2fq64K8p3Y`, `PANDADOC_INFLUENCER_TEMPLATE_ID=YeJ2mEivMqaHeyEXUqawrn`, `PANDADOC_BRAND_ROLE=Signer`, `PANDADOC_INFLUENCER_ROLE=Signer`, `ANTHROPIC_API_KEY`, `OWNER_EMAIL=donj@wellsplusdaily.com`, `OPERATOR_NOTIFICATION_EMAIL=donj@wellsplusdaily.com`, `PUBLIC_SERVER_URL=https://influencer-brokerage-os.onrender.com`, `NEOMAIL_USER=` (blank), `NEOMAIL_PASS`. `PANDADOC_VERIFY_STRICT` not set (soft-fail OK). `APIFY_API_TOKEN` (added for lead_discovery, now superseded). Owns second domain `wellspluspartners.com` (for future domain split). `[OPEN — operator to note APOLLO_API_KEY when Apollo is added, Brief 17]`.

**Planned additions (Brief 15b/15c/15d):** signed-URL secret(s) for brand portal and creator portal access; AI support assistant API key if separate from `ANTHROPIC_API_KEY`; escalation routing config (operator phone/email/SMS for off-hours alerting if any).

### 4.6 Brand Experience Stages — Acquisition Flow `[updated 2026-06-19 — Brief 14-REFRAME]`

The first-deal acquisition flow is the journey a new brand takes from cold outreach response to live campaign. This is one-time per brand: returning brands launch subsequent campaigns through the continuous flow (§4.7), not by re-entering acquisition.

This section is canonical for Brief 15b (brand portal full build) and Brief 16 (4-mock test exercising the full acquisition path). Frontend engineering reads this section to understand what surfaces exist at each stage and what data they render.

**Visual direction (locked):** The brand-facing surfaces across acquisition and product layers borrow Ramp's UI patterns directly. Ramp Reporting → spending tracker tab. Ramp Bills → invoices tab with Stripe payment integration. Ramp Transaction detail → deal detail view with compliance/payout state. Visual consistency across operator dashboard (Brief 15), Kanban (Brief 15b acquisition), brand dashboard (Brief 15b product), and creator dashboard (Brief 15c).

**Stage A1 — Landing (from outreach link)**

- **Trigger:** Brand clicks the outreach link from a Brief 12 outreach email
- **Authentication state:** unauthenticated
- **Purpose:** confirm context, set expectation, establish product framing
- **What the brand sees:** a context-setting landing page that confirms the enforcement OS framing. Brief copy explaining what this is (AI-native enforcement and execution platform for creator campaigns — not a marketplace, not a talent agency). The framing language must align with §0.5 product definition — this is the buyer's first encounter with the system. Copy leads with the enforcement function: "Brands bring their own creators or choose from our curated roster. We run the contracts, compliance, payouts, and escalation. You configure the rules; we execute them." BYOC unlock is surfaced here if relevant to the outreach context
- **CTA:** "View creators" or equivalent commitment-light language → progresses to Stage A2
- **Backend data dependencies:** brand record (from `roster_token` lookup), no creator data exposed yet
- **What's NOT here:** no creator cards, no pricing, no compliance details. Stage A1 is framing-only

**Stage A2 — Kanban (unauthenticated, two screens)**

- **Authentication state:** unauthenticated
- **Purpose:** product discovery layer — the brand encounters the curated creator set and the enforcement OS framing
- **Two screens (sequential):**

  **Screen A2.1 — 15-second context video.** Explains: what the platform is, how creator selection works, what happens after selection. Production quality matters here; this is the brand's first encounter with the platform as a product. Video covers: enforcement OS framing (in plain language — "you configure the rules, we execute"), curation discipline as quality signal, compliance window as the visible enforcement mechanism. BYOC framing surface: "Already have a creator? Bring them. We'll run the contracts and compliance for you." After 15 seconds, brand progresses to Screen A2.2 (or skips ahead via CTA).

  **Screen A2.2 — Main Kanban.** The creator cards surface. Each card contains:
  - Creator's external proof (past sponsors, audience demographics, prior brand work in adjacent categories)
  - Brief 11 scoring metadata translated to brand-facing display (compliance underwriting evidence: "delivered on time on N of last N sponsorships," "response window typically X hours," "completion rate N%")
  - Brief 12 OutreachDrafts' `fit_rationale` and `evidence_used` rendered as buyer-facing reasoning (why this creator fits this brand)
  - Compliance/guarantee framing at platform-template level (NOT per-deal yet — Stage A2 shows the platform's house template for how deals work, not a specific compliance_spec for a specific creator)
  - **BYOC entry point:** at the top or bottom of Screen A2.2, a BYOC path: "Already working with a creator? Import them." Routes to Stage A3 via BYOC flow (creator not yet in system; brand provides creator email; creator onboarding provisioned at Stage A3)

- **User action:** select creator(s) OR enter BYOC path → progresses to Stage A3
- **Backend data dependencies:** brand record, Brief 11 scored creators for this brand (read from OutreachDrafts where brand_id = this brand), Brief 12 outreach drafts' rationale fields
- **What's NOT here:** authentication, payment, specific pricing per creator, locked compliance_spec
- **Why two screens, not one:** the 15-second video sets framing before the brand encounters inventory. Marketplace defaults lead with inventory; the platform leads with the structure that inventory sits inside (§2.4 / Decision B).

**Stage A3 — Selection Cart (unauthenticated)**

This is the transaction preview state — critical layer between discovery and authentication. NOT a dashboard. NOT a checkout. A commitment-ready preview that surfaces the deal shape before asking for payment.

- **Authentication state:** unauthenticated
- **Purpose:** transaction preview, allow brand to review their selection before committing to payment
- **BYOC variant:** if the brand took the BYOC path in Stage A2, Stage A3 surfaces creator onboarding fields (creator name, email, creator's platform/channel URL, category/niche). The platform provisions a creator dashboard invitation email to the creator — creator completes Stripe Connect onboarding from their side — creator record created in system with BYOC source flag
- **What the brand sees:**
  - Selected creators (condensed cards from Stage A2 — preserve the rationale visible at selection time)
  - Pricing estimate / range (computed from creator rate ranges + Brief 11 scoring metadata; for BYOC creators: brand-provided or estimated rate)
  - Small campaign summary (deliverables shape, timeline estimate)
  - **Brand-configurable enforcement preview** — after Brief 14.7: brand sees their configured payout split, release triggers, hold period, compliance criteria. Pre-Brief-14.7: 80/20 + day-30 default shown with label "System default — customizable after account creation"
  - **LLM insights on potential performance** — a paragraph-length contextual projection of how the campaign might perform. This is a planner output (per §0.5.1) — token-bounded LLM call producing structured performance projection from creator data + brand context. Same architectural pattern as Brief 9b's outreach engine. No back-and-forth dialogue at this stage (Stage A3 LLM is single-pass output, not conversational). This LLM call belongs to a future planner brief (likely scoped alongside or before the Campaign Creation Interface brief)
  - Deliverables, compliance summary, timeline estimate as a resume — NOT a redundant copy of creator cards, but a synthesized summary
- **CTA:** "Continue to checkout" or equivalent commitment-intent framing. The CTA must signal commitment without being salesy
- **User action:** click "Continue to checkout" → triggers Stage A4 authentication
- **Backend data dependencies:** selected creator IDs, brand record, Brief 11 scoring metadata, LLM call to planner producing performance projection
- **State management:** a draft Deal record is created in Airtable with `status: CART_DRAFT` when the brand enters Stage A3. This is necessary because:
  - The brand may authenticate on a different device than they cart-built on
  - Magic-link auth (Stage A4) requires the cart to survive the auth roundtrip
  - Operator visibility into "carts in flight" is itself useful (abandoned-cart retention signal)
- **Draft Deal record carries:** selected creator IDs, working `compliance_spec` (in flux, may be modified before payment), brand association (anonymous via `cart_token` until auth completes, then linked to authenticated brand), pricing estimate, status `CART_DRAFT`
- **What's NOT here:** authentication, payment, locked spec, contracts. The spec is in flux; nothing irreversible has happened

**Stage A4 — Authentication**

- **Trigger:** ONLY by the Stage A3 "Continue to checkout" CTA. Authentication is never the first surface; it is triggered by commitment intent
- **Authentication state:** transitions from unauthenticated to authenticated during this stage
- **Method:** magic-link email (preferred). The brand enters their email, receives a magic-link email, clicks the link, lands authenticated
- **Framing discipline:** the framing is "unlock my deal" — NOT "sign up for a platform." This is load-bearing for the strategic product positioning. The brand does not experience this as creating an account; they experience it as confirming identity to proceed with a transaction
- **Profile fields:** brand profile information (brand name, profile picture, team members) is deferred to post-auth dashboard settings. Stage A4 collects only what is needed to authenticate (email)
- **Backend data dependencies:** magic-link generation, email delivery via SendGrid, session creation on link click
- **State management:** the CART_DRAFT record from Stage A3 is associated with the newly-authenticated brand record on auth completion
- **What's NOT here:** payment processing, profile completion, onboarding tutorials. Stage A4 is identity confirmation only

**Stage A5 — Checkout**

This is where money happens. Payment IS lock per Brief 14's architecture.

- **Authentication state:** authenticated
- **Purpose:** Stripe payment surface; payment confirms commitment and triggers the Brief 14 lock pipeline
- **What the brand sees:**
  - Invoice / payment breakdown — **REQUIRED full transparency:** line items showing: (1) creator payout total, (2) platform fee (3.6%), (3) Stripe processing fees (labeled "payment infrastructure"), (4) total funded amount. This breakdown is non-negotiable per §0.5 brand funding model
  - Selected creators (reference, not editable)
  - Payment method selection (Stripe-hosted; platform does not handle card data directly per §0.2 safety doctrine)
  - "Confirm & Pay" CTA
- **User action:** click "Confirm & Pay" → Stripe processes payment → `payment_intent.succeeded` webhook fires
- **Backend data dependencies:** CART_DRAFT record with locked spec, Stripe PaymentIntent creation with `metadata.deal_id` set to the CART_DRAFT's deal_id
- **Critical: `metadata.deal_id` must be set at PaymentIntent creation.** Brief 14 detects missing metadata and fails loud per Pin 1 (UnresolvedPayments table + operator alert). Brief 15b owns ensuring metadata is set
- **State transition:** payment succeeds → Stripe webhook → Brief 14 lock pipeline → `validateLockedSpec()` → `status: LOCKED` → `creator_payout_schedule` initialized (per brand-configured rules, 80/20 default until Brief 14.7) → `generateContracts(dealId)` → `status: CONTRACTS_SENT`
- **What's NOT here:** spec modification (the spec is now frozen by lock), creator re-selection (the deal is committed)

**Stage A6 — Dashboard (first time)**

- **Authentication state:** authenticated
- **Purpose:** brand transitions from acquisition layer to product layer (§0.5.A). The first-time dashboard landing is the moment the brand enters the product
- **Value-demonstration moment (locked):** The first-time dashboard landing is a deliberate value-demonstration surface. The brand has just paid. They need to see the machine moving immediately — "your campaign is already in motion." The OS framing must be visible here: compliance engine is running, contracts are in flight, enforcement is live. This is NOT an onboarding tutorial moment. It is a system-is-executing-on-your-behalf moment
- **What the brand sees:** the full brand dashboard (described in detail under §4.7 returning-brand flow Stage P1, since the dashboard is the same for first-time and returning brands — the only difference is the data it renders). For first-time landing, the dashboard shows:
  - The just-locked Deal in CONTRACTS_SENT state (awaiting brand+creator signatures)
  - The compliance_spec from the lock (read-only, immutable per Decision A)
  - The process-ownership funnel (Decision E) showing current state: contracts sent, awaiting signatures
  - Empty or initial state for: spending tracker (zero spend until contracts execute and invoices fire), invoices tab (first invoice will arrive after contract signing), reporting tab
  - Lara available via Escalation tab for any deal-state questions
- **Backend data dependencies:** the locked Deal record, ComplianceEvents (initially the lock event), creator_payout_schedule (initialized at lock with configured split amounts, all flags false)
- **Critical UX moment:** the first time landing happens immediately after payment confirmation. The brand sees their deal already in progress — system is triggered on their side. They are now in the product. The Ramp-style UI patterns described in §4.7 govern the visual direction
- **What's NOT here:** the Kanban (acquisition surface), the Selection Cart (pre-lock surface), the onboarding video. Returning to the brand dashboard does not re-trigger Stage A1-A5

**Stage A6 transitions seamlessly to ongoing product use (§4.7). The acquisition flow is one-time per brand; from this point forward the brand interacts with the product layer.**

**Cross-references:**
- The CART_DRAFT state machine entry: §4.4
- The lock pipeline implementation: §5.5 Brief 14 row + `compliance_engine.js` + `server.js` payment_intent.succeeded handler
- Pin 1 UnresolvedPayments operator recovery: §6 Pin 1 operational infrastructure
- The compliance_spec JSON schema: `docs/compliance_spec_schema.md`
- Decision B portal architecture: §2.4
- Decision E process-ownership funnel: §2.7

### 4.7 Returning-Brand Continuous Campaign Lifecycle (locked 2026-06-12 supplement)

This section describes how a brand interacts with the system for every subsequent campaign after their first deal. The acquisition flow (§4.6) is one-time; the continuous flow is the product the brand uses repeatedly.

**Core architectural distinction:** the Kanban-and-creator-cards in §4.6 Stages A1-A3 is acquisition machinery. The dashboard described here is the product. Returning brands do NOT re-enter through outreach → Kanban → cart. They log into the dashboard and launch a new campaign from inside.

This distinction matters because:
- The first-deal lifecycle and subsequent-deal lifecycle have different upstream paths to lock
- Brief 14's lock pipeline must handle both paths identically once Stripe payment confirms
- Frontend engineering must NOT build the Kanban as the entry point for returning brands

This section is canonical for Brief 15b (brand dashboard rebuild) and the future Campaign Creation Interface brief (post-Brief 16).

**Stage P1 — Dashboard Landing**

- **Authentication state:** authenticated (brand is returning, already has an account)
- **Purpose:** the brand's home base in the product. All deals, campaigns, communications, spending data accessible from here
- **Dashboard surfaces (full inventory):**

  The brand dashboard contains all of the following tabs/surfaces. Visual direction is Ramp template — direct borrowing of UI patterns:

  - **Contract Executed tracking:** high-level state badges per deal, click-through to PandaDoc signed PDFs. Shows "Contract sent to creator, awaiting signature" → "Both parties signed" → "Active." This is NOT the full ComplianceEvents audit log; it is a state summary with deep-link to the signed contract.

  - **Compliance Monitoring:** high-level status per deal ("On track" / "Flag raised — under review" / "Resolved"). NOT the full ComplianceEvents trace — that's operator-facing. Brands see status, not the audit log.

  - **Payment Protected:** live "80% released on [date]" / "20% held under compliance review through [date]" view per deal. Forecasting/tracking-style UI showing funds in transit. This is the visible enforcement function from Decision E — hiding it would erode the strategic value premise. The brand should see the money is held; the fact that money is held is the proof the system is working.

  - **Escalation Available (with Lara):** a dedicated tab containing:
    - The locked compliance_spec resume for each active deal
    - Compliance window status (where in the 90-day window each campaign sits)
    - Conditions and current state
    - Lara — the natural-language interface for deal-state queries (see Lara definition below in this section)

  - **Documents:** Ramp Bills-style view of contracts, invoices, payment receipts. Each document is a card with status, date, click-through to the PandaDoc or Stripe-hosted document.

  - **Email threads:** Gmail-style view of brokerage ↔ brand communications, scoped per deal. Reads from the SendGrid inbound parse data + outreach send history.

  - **Reporting / Spending tracker:** Ramp Reporting-style view. Total spent with brokerage, by deal, by creator, by month. Financial summary.

  - **Invoices:** Ramp Bills-style management with Stripe payment links. Each invoice is a card showing amount, due date, payment status, "Pay" button that opens Stripe-hosted payment page.

  - **Launch Campaign:** entry to Stages P2-P5 (the Campaign Creation Interface). This is how returning brands initiate new campaigns. NOT a "browse creators" button — it is a "start a new campaign" button.

  - **Settings:** brand profile (set post-acquisition since profile fields were deferred in Stage A4), payment methods, team management, notification preferences.

  - **Possibly future: New Matches tab.** Retention surface where new curated creators are surfaced on cadence. Scope and trigger TBD — likely a separate retention engine brief, post-Brief 16.

- **Backend data dependencies:** brand record, all Deal records for this brand, ComplianceEvents (derived to status, not raw), creator_payout_schedule per deal, OutreachDrafts (for email threads), Stripe invoice data, brand settings
- **What's NOT here:** Kanban, creator cards as the entry point, Selection Cart, acquisition flow surfaces

**Stage P2 — New Campaign Trigger**

- **Trigger:** brand clicks "Launch Campaign" from the dashboard (P1)
- **What happens:** the Campaign Creation Interface opens (Stage P3)
- **State management:** no Deal record created yet — the Campaign Creation Interface Mode 1 produces a brief that may or may not become a Deal depending on Stage P5 approval

**Stage P3 — Campaign Creation Interface, Mode 1 (Structured Intake)**

This is the planner-side product surface for returning brands. It is structurally a planner per §0.5.1 — produces structured outputs that feed into the executor pipeline (Brief 10 matching + Brief 11 scoring + Brief 12 outreach generation).

**Mode 1 architecture:**
- Looks like chat; behaves like a guided form
- Brand provides:
  - Campaign objectives
  - Budget
  - Audience definition
  - Constraints (timing, exclusivity asks, platform preferences)
  - Optional assets (PDFs, briefs, prior creative)
- LLM produces:
  - Creator recommendations (drawn from the curated roster, matched and scored against the campaign brief — same Brief 10/11 pipeline as outreach-side)
  - Performance projection (paragraph-length structured projection of expected campaign performance)
- **Token-bounded:** known cost ceiling per intake. Same discipline as Brief 9b outreach engine — 5-6 link cap on web search if used, max_tokens cap on LLM call
- **Single-pass output:** Mode 1 produces a complete recommendation set in one LLM call. No back-and-forth dialogue at this stage. Conversational refinement happens in Mode 2 (Stage P4)
- **Planner discipline (§0.5.1):** Mode 1 reads from Airtable (creator roster), augments with LLM reasoning, outputs structured recommendations. Mode 1 does NOT write to Airtable. Mode 1 does NOT trigger state changes. Mode 1's output is a planner artifact that the brand reviews

**Output structure (the brief):**
- Campaign brief object (objectives, budget, audience, constraints)
- Ranked creator recommendations with brand-facing rationale
- Performance projection narrative
- Estimated pricing range

This output feeds into Stage P4 (Mode 2 conversation) and Stage P5 (approval).

**Stage P4 — Campaign Creation Interface, Mode 2 (Contextual Conversation)**

After Mode 1 produces recommendations and projection, the brand can continue querying the system about that specific campaign. Mode 2 is a separate LLM instance with different scope.

**Mode 2 architecture:**
- Open-source LLM (different instance from Lara — different scope, different access boundary)
- Conversational — brand can ask multiple questions, refine understanding, explore scenarios
- **Read access scoped to:**
  - The campaign's brief (from Mode 1)
  - The recommendations produced by Mode 1
  - The creator data underlying the recommendations
- **Read access NOT granted to:**
  - The full Airtable
  - Other brands' campaigns
  - Historical performance data outside this campaign's recommendation set
- **Critical: Mode 2 does NOT modify the campaign autonomously.** Read-only at the API layer. Mode 2 is a thinking partner, not an agent. Brand drives all decisions. Mode 2 cannot:
  - Write to Airtable
  - Trigger state changes
  - Invoke executor functions
  - Modify recommendations (it can suggest modifications; brand approves; planner Mode 1 may re-run on brand request)
- **Example brand queries:**
  - "What if I pushed the budget to $30K instead of $20K?"
  - "What platforms underperform for this audience demographic?"
  - "How would adding a fourth creator change the projection?"
  - "What's the breakdown of the projection — what's driving the reach estimate?"

**Token discipline (to be defined precisely in the future Campaign Creation Interface brief):**
- Token caps per Mode 2 session
- Context boundary enforcement (Mode 2 cannot reach beyond the campaign's data scope)
- Read-only enforcement at the API layer (not just at the prompt level)

**Planner discipline (§0.5.1):** Mode 2 is planner-shaped, not executor-shaped. It provides contextual insight. The brand's decisions and actions in the dashboard are what move state forward. Mode 2 informs; the brand executes (with the executor pipeline doing the actual state mutation).

**Stage P5 — Approval**

- **What happens:** brand reviews recommendations (potentially refined through Mode 2 conversation), approves the campaign
- **State transition:** approval creates a Deal record with `status: CAMPAIGN_APPROVED`. The working compliance_spec from the planner output is attached to the Deal record but not yet locked (CAMPAIGN_APPROVED is pre-lock state)
- **Pricing finalization:** at approval, the precise rates per creator are finalized. The pricing estimate from Mode 1 becomes a committed pricing structure
- **What this state means:** the brand has committed to the campaign shape and the creator selection. The deal has not yet been paid for; spec is not yet locked; contracts have not yet generated

**Stage P6 — In-Dashboard Checkout**

This is the continuous-flow analog to Stage A5 (acquisition checkout). The brand pays inside the dashboard rather than on a separate checkout page.

- **Surface:** Stripe payment surface embedded in the dashboard
- **What the brand sees:** invoice, selected creators (reference, not editable), payment method, "Confirm & Pay" CTA
- **Critical: `metadata.deal_id` must be set on the PaymentIntent at creation,** same requirement as Stage A5. The Brief 14 lock pipeline detects missing metadata and fails loud per Pin 1.
- **State transition:** payment succeeds → Stripe webhook → Brief 14 lock pipeline → `validateLockedSpec()` → `status: LOCKED` (transitioned from CAMPAIGN_APPROVED) → `creator_payout_schedule` initialized → `generateContracts(dealId)` → `status: CONTRACTS_SENT`
- **Same lock pipeline as Stage A5.** The dual-path lock pipeline handles both `CART_DRAFT → LOCKED` (acquisition) and `CAMPAIGN_APPROVED → LOCKED` (continuous) identically. The pre-lock state is metadata about which flow produced the deal; the lock pipeline behavior is path-agnostic

**Stage P7 — Campaign Live in Dashboard**

- **What the brand sees:** the post-lock experience is identical to Stage A6 (first-time dashboard landing) — the dashboard surfaces described in P1 now reflect this new campaign alongside any previous campaigns
- **All Brief 14 functionality applies:** compliance engine derives status from events; 80/20 payout split fires on delivery approval; day-30 release dashboard math + operator confirmation; Lara provides natural-language access to deal state; UnresolvedPayments handles any payment-with-missing-metadata recovery
- **The brand returns to P1** for ongoing dashboard use, with this new campaign now appearing alongside historical campaigns

**Lara — natural-language interface scope (locked):**

Lara lives in the Escalation Available tab (P1 dashboard surface). Sharp definition:

- **NOT an AI agent.** Doesn't act autonomously
- **NOT a chatbot for general conversation.** Doesn't engage in open-ended dialogue
- **NOT a reasoning layer over business strategy.** Doesn't interpret deal logic, doesn't reconstruct context outside the immediate query, doesn't make decisions
- **IS a natural-language interface to backend functions.** Routing layer over the read endpoints (`GET /api/deals/:dealId/compliance-status`, `/payout-schedule`, `/compliance-events`, `/compliance-spec`) and the escalation trigger
- **IS SLA-bound for escalation.** When Lara cannot resolve via read functions and escalation is needed, she triggers human escalation per Decision C (Mon-Fri 7:30am-8pm EDT). When escalation fires, the operator joins the same thread from the operator dashboard and responds inline. Communication stays inside the dashboard channel, NOT via email

**Lara workflow example:**
- Brand opens Escalation Available tab, types "What's the status of my deal with Creator X?"
- Lara interprets intent: deal-state query
- Lara calls `GET /api/deals/:dealId/compliance-status` (after disambiguating which deal via clarifying question if needed)
- Lara returns the natural-language answer: "Your campaign with Creator X is currently in compliance window day 12 of 30. Delivery was approved on [date]. 80% of payout was released to the creator on [date]. The 20% compliance hold releases on [date 18 days from now] assuming no issues are flagged."
- If the brand follows up with "I'm having an issue with this deal," Lara routes to escalation: creates an escalation record, notifies the operator, opens the dashboard channel for operator response

**Lara is NOT the Mode 2 LLM** (the Campaign Creation Interface Mode 2). They are two separate LLM instances with separate scopes:
- Lara: SLA escalation channel, dashboard-wide deal-state queries, can trigger human escalation, scope is all of the brand's deals
- Mode 2 LLM: scoped to a single campaign's planner output during the Campaign Creation Interface session, read-only insights for campaign decision-making, no escalation capability, session ends when the campaign is approved or abandoned

Different briefs build them. Lara is Brief 15d. Mode 2 is the future Campaign Creation Interface brief.

**Cross-references:**
- CAMPAIGN_DRAFT and CAMPAIGN_APPROVED state machine entries: §4.4
- Lock pipeline: §5.5 Brief 14 row
- Planner/executor doctrine: §0.5.1
- Process-ownership funnel surfaced in Payment Protected: §2.7
- Compliance engine: §3.2 compliance_engine.js

### 4.8 Creator-Side Lifecycle (locked 2026-06-12 supplement)

Creators have their own dashboard. Minimal scope by design — the creator's interaction with the system is workflow-tool shaped, not relationship-management shaped (§0.5.A product surface discipline). Three tabs.

This section is canonical for Brief 15c (creator portal full build) and Brief 16 (4-mock test exercising deliverable upload through approval and payout).

**Creator dashboard surfaces (three tabs):**

- **Invoices:** payouts received, pending, scheduled. Each invoice is a card showing amount, related Deal, status, date. Click-through to Stripe receipt for completed payouts. Pending payouts show why they're pending (awaiting delivery approval, in 20% hold window, etc.)

- **Contracts:** signed contracts list. Click-through to PandaDoc PDFs of signed contracts. Shows current contract state per Deal (sent, signed by brand, signed by creator, both-signed/active)

- **Active deals:** the main working surface. Per active deal:
  - Locked compliance_spec resume (what the creator agreed to deliver)
  - Deliverable upload surface (the primary creator action)
  - Compliance window status (where in the 90-day window the deal sits)
  - 80/20 payout tracking (80% pending delivery approval / 80% released on [date] / 20% in compliance hold through [date] / 20% released on [date])
  - `roster_eligibility` status (active / under review / flagged)

**Deliverable upload flow (the load-bearing creator action):**

When the creator uploads a deliverable (video, stream clip, post proof), the workflow is:

1. **Creator uploads file** through their dashboard Active Deals tab
2. **File stored** as Airtable Attachment on a new ComplianceEvents row with:
   - `event_type: deliverable_uploaded`
   - `event_attachment: <uploaded file>`
   - `event_source: creator_portal`
   - `event_payload`: JSON with platform/format metadata
3. **Compliance engine derives** new status (`delivery_uploaded` condition now true; evaluates timeline against `compliance_spec.timeline.delivery_due_date`)
4. **Brand dashboard surfaces the deliverable** in the campaign timeline / Documents tab — brand sees that delivery has been submitted
5. **Brand reviews** the deliverable:
   - **If approved:** brand creates `event_type: brand_approval` ComplianceEvent → `deriveDealState()` recomputes → payment_handler.js triggers `release80Percent()` → 80% transfers via Stripe → ComplianceEvents row created for `payment_released_80` → `creator_payout_schedule` updates → status transitions to `DELIVERY_APPROVED` then `CAMPAIGN_LIVE` (creator's content goes live)
   - **If rejected:** brand creates `event_type: delivery_rejected` ComplianceEvent with rejection reason → `deriveDealState()` flags the breach → status flips to `BREACH_FLAGGED` → operator notified → resolution path per §2.3 (Decision A) credit-and-replacement or per §2.6 (Decision D) creator roster flagging

6. **Compliance window opens** (day 0 = brand approval timestamp). For the next 30 days, content must remain posted per §2.6
7. **Day-30 release:** operator-confirmed dashboard release per §5.5 Brief 14 Q2 — operator clicks "Release 20% hold" on the dashboard day-30 queue → `release20Percent()` fires → 20% transfers via Stripe → ComplianceEvents row created for `payment_released_20` → `creator_payout_schedule` updates → status transitions to `PAYOUT_20_RELEASED`
8. **Day-90 close:** content must remain live through day 90 per §2.6. At day 90, the deal transitions to `CAMPAIGN_COMPLETE`. If content was removed between day 30 and day 90, `roster_eligibility` flips to `flagged_breach` per §2.6 (Decision D) — no cash recovery (the 20% has already released), but future-opportunity revocation enforces

**Critical doctrine: deliverables are state transitions in the campaign lifecycle, not a separate product.**

The deliverable upload IS the event. The ComplianceEvents row IS what the compliance engine derives against. The system does NOT judge deliverable quality automatically; the brand judges via approval/rejection; the system tracks that the brand judged. This is the same separation-of-concerns as the planner/executor doctrine (§0.5.1) — the system provides structured workflow; humans make subjective judgments at the gate points.

This means Brief 15c (creator portal) does NOT need any quality-evaluation logic. The creator's role is: upload deliverable per the locked compliance_spec. The brand's role is: review and approve or reject. The system's role is: route the artifacts and derive state.

**Compliance status visibility for creators:**

The creator sees their own deal's compliance status in the Active Deals tab. This is the creator-side mirror of Decision E (process-ownership funnel) — the creator sees the same execution structure the brand sees, from their side. Specifically:
- Locked compliance_spec (what they agreed to deliver)
- Current state (delivery pending / delivery uploaded / brand approved / in 20% hold / payout complete / campaign complete)
- 80/20 payout schedule (when funds release)
- `roster_eligibility` status (active = good standing; under_review = something has been flagged; flagged_breach = breach recorded, future deal flow at risk)

This visibility is structurally required (per the 2026-05-30 strategic closure) — the guarantee model cannot function if the creator side does not see the execution structure the brand side sees.

**What the creator does NOT see:**
- The brand's full dashboard (compliance monitoring details from the brand's view, brand-side spending tracker, brand-side reporting)
- Other creators' deals or roster status
- The internal placement-status registry (operator-facing surface in Brief 15)
- Operator-facing audit logs or escalation events from the brand side

**Backend data dependencies:**
- Creator's authentication (separate auth flow from brand — Brief 15c specifies)
- Creator record + linked Deals
- ComplianceEvents scoped to the creator's deals
- `creator_payout_schedule` per deal
- `roster_eligibility` from creator record
- PandaDoc creator-side contract URLs

**File storage architecture:**

Airtable Attachment field on ComplianceEvents is the chosen pattern for deliverable file storage (per Brief 14 schema). Airtable handles upload, stores files, provides URLs. No new infrastructure. The compliance engine reads attachment metadata (file presence, file type, upload timestamp) but does NOT process file contents — content judgment is the brand's via approval/rejection.

If file size or storage cost becomes a problem at scale, migration to external storage (S3) is a future concern. Not a Brief 14 or Brief 15c concern.

**Cross-references:**
- ComplianceEvents schema: §4.1
- 80/20 payout per Decision D: §2.6
- Decision A credit-and-replacement remediation: §2.3
- compliance_engine.js: §3.2
- payment_handler.js release functions: §5.5 Brief 14 row
- Creator portal full build scope: §5.5 Brief 15c row

---

## 5. BUILT vs REMAINING

### 5.1 Built & verified `[VERBATIM]`
Transactional spine end-to-end: contract generation (PandaDoc) → signature webhooks → auto-invoice (Stripe) → payment webhook (`invoice.paid` + `invoice_payment.paid`) → operator payout alert (SendGrid HTTP API) → confirm → CAMPAIGN_LIVE. Webhook hardening (idempotency via WebhookEvents, Stripe HMAC, PandaDoc HMAC soft-fail, SendGrid ECDSA). Niche taxonomy + ingest validation. Roster portal scaffolding at `views/roster.html` (niche-match, parent fallback, 15% markup display, self-select → Deal creation; SUPERSEDED in scope by full brand portal, Brief 15b). SendGrid bounce webhook (`email_invalid` flagging). Pre-launch diagnostic (17 checks). Cleanup tooling. Operator Kanban dashboard (read + Release Payout; full rebuild scheduled Brief 15).

**Brief 14 added (DONE 2026-06-12):** `compliance_engine.js` (pure derivation, no side effects), `contract_generator.js` (dual-path: dealId-targeted + legacy batch-poll, compliance_spec merge tokens, doc ID writes), `payment_handler.js` (release80Percent + release20Percent + sendOperatorAlertForUnresolvedPayment), `server.js` Stripe lock pipeline (payment_intent.succeeded → validateLockedSpec → LOCKED → generateContracts(dealId)), PandaDoc dual-layer idempotency (ComplianceEvents existence check + WebhookEvents dedup), 5 compliance read endpoints + release-20-percent endpoint + unresolved-payments endpoint. `docs/compliance_spec_schema.md` + `docs/pandadoc_merge_tokens.md` + `scripts/verify_brief14_schema.mjs` created.

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
| **7b** | Operator | **Schema amendment 2026-05-30:** Kill `view_guarantee` on Deals. Add `compliance_spec` (Long Text, JSON), `compliance_status` (Long Text, JSON), `creator_payout_schedule` (Long Text, JSON), `escalation_events` (Long Text, JSON). On Influencers add `roster_eligibility` (enum: active / inactive / flagged_breach / flagged_quality / under_review — defaults to active), `delivery_reliability_evidence` (Long Text), `placement_history` (Long Text). | DONE |
| **7c** | Operator | **Schema migration prerequisite for Brief 11.** Brands table: `target_budget` (Number), `preferred_audience_scale` (Single Select micro/mid/macro/mega), `preferred_platform` (Single Select youtube/instagram/tiktok/podcast/multi) — all optional. Influencers table: `delivery_reliability_evidence_last_modified` (Last Modified Time, tracks ONLY `delivery_reliability_evidence`). Living doc §4.1 documents the new fields plus `placement_history` outcome enum extension with `breach_timeline_missed`. | DONE |
| **7d** | Operator | **Schema migration prerequisite for Brief 12.** New table OutreachDrafts with 26 fields covering the draft lifecycle (pending_review → sent / rejected → archived), the 8-field LLM output contract, Brief 11 scoring metadata preservation, edit-tracking snapshots, audit timestamps, SendGrid send tracking (sendgrid_message_id for Brief 13 reply matching), and reply correlation fields (created here, populated by Brief 13). Round-trip verification: create temporary test draft via SDK, read back all 26 fields, delete (try/finally cleanup). | DONE |
| **8** | Operator + chat | Intelligence spike | DONE 2026-05-30 |
| **9** | Antigravity | **LLM foundation** (permanent, separate from spike): system-prompt doctrine, tone baseline, few-shot bank, output contract, context-assembly rules. Revives the dead `chatCompletion()` as the generative call. **EXTENDED 2026-05-30 scope:** doctrine encodes the product definition (§0.5), deal-framework-first framing (§2.4 / Decision B), guarantee scope language (§2.3 / Decision A — what's covered, what's not, in non-over-promising language), curation-as-underwriting frame (§2.2 H1), escalation availability signal (§2.5 / Decision C). **Structure locked 2026-05-30 (post-7b):** **Split into Brief 9a (content) + Brief 9b (engineering).** Brief 9a produced a single artifact at `src/prompts/outreach_system.md` containing the full system prompt + the few-shot bank (Option B-flat). Brief 9b hardens `chatCompletion()`, builds the context-assembly layer that consumes 9a from disk, and enforces structured output via **Anthropic tool-use** (NOT JSON-with-fence-stripping — string manipulation of model output is a liability per the Brief 8 spike's JSON-parse failure). Output contract enforcement lives in the wrapper (`chatCompletion()` defines the tool schema; callers receive a typed object, not raw text). **9a + 9a-supplement done 2026-06-02 — Section 5 (user-message template, Path Y) added to the artifact with `{{BRAND_PAYLOAD}}`, `{{CREATOR_PAYLOAD}}`, `{{TASK_INSTRUCTION}}` substitution tokens defined under loader contract. 9b done 2026-06-02 — chatCompletion + outreach_engine.js shipped, verified against real Zapier × Nate and Chewy × Chas pairs.** | DONE 2026-06-02 |
| **10** | Antigravity | **Matching** — deterministic: niche filter + `rate_range` overlaps $5–15K + **`roster_eligibility = active` hard filter (Brief 7b)** + **delivery_reliability evidence required (Brief 7b)**. Owns the `rate_range` parsing contract (strict `"$LOW-$HIGH"` no spaces; defensive fallback regex; malformed entries set `rate_range_invalid` flag — non-matching until corrected). **Locked 2026-06-02:** five-stage filter (Stage 0 field presence + four semantic). Pure function, structured return `{ matches, rejected, flags }`. Strict niche equality (no taxonomy walk). Test-only override `ignoreEmptyDeliveryEvidence` scoped to Stage 4 only, strict `=== true` activation, WARN log per affected creator, production-path grep verification (`Select-String -Path src\server.js,src\skills\outreach_engine.js -Pattern ignoreEmptyDeliveryEvidence` must return zero hits). | DONE 2026-06-02 (+supplement) |
| **10-supp** | Antigravity | Stage 0 redesign — collapsed into per-stage missing-field guards (option ii). New rejection codes `roster_eligibility_missing`, `niche_missing`, `rate_range_missing` replace unified `creator_record_malformed`. Stage 4 defensive read via `delivery_reliability_evidence ?? ''`. §0.3 doctrine added. | DONE 2026-06-02 |
| **11** | Antigravity | **Scoring** — deterministic hybrid. **Layer 1 (curation floor):** computed from placement_history completions/breaches/recency-bonus + delivery_reliability_evidence content+recency (0-3 tier scale). Normalized 0-100 against the eligible roster. **Floor = 50** — below excluded with reason `curation_floor`. Tunable constants at file head. **Layer 2 (brand-fit multiplier):** preferred_audience_scale (bucket match), target_budget (rate-band overlap), preferred_platform (channel_url heuristic). Multiplier in `[0.6, 1.4]`; brand with no Layer 2 fields = 1.0 neutral. **finalScore = layer1 × multiplier.** Curation is gate, brand-fit is sort. Top-20 default, ties by record ID. Pure function: `scoreMatches(matchResult, brand, options) → { scoredMatches, rejected, flags, scoringMetadata }`. `withdrawn_pre_delivery` counted in metadata but neutral on score (option i — tunable when data exists). Delta tests verify causal structure with finally-block cleanup discipline. | DONE 2026-06-07 |
| **12** | Antigravity | **Production outreach orchestration** — batch generation + operator-triggered send. **DONE 2026-06-08.** Two files: `outreach_orchestration.js` (`runOutreachBatchForBrand(brandId, options)` orchestrating matchCreatorsForBrand → scoreMatches → generateOutreachDraft → persist to OutreachDrafts as pending_review; per-creator generation failures accumulate in `errors` array without halting batch) + `outreach_send.js` (`sendOutreachDraft(draftId)` status-checking pending_review load-bearing double-send protection, reads brand.contact_email, fires via `notifications.js` sendOutreachEmail, persists state transition on success or send_failure_count increment on failure). **No cross-module imports** — OutreachDrafts table is the integration contract (verified by grep). Two server routes: `POST /api/outreach/batch` + `POST /api/outreach/send/:draftId`. `notifications.js` created (new util — SendGrid REST v3, SENDGRID_OUTREACH_FROM_EMAIL env var, returns messageId from x-message-id header). Deleted `brand_outreach.js` + `influencer_outreach.js` (via git rm), resolving `[AUDIT 🟡 #11]` (nichesData.niches crash — file removed). `outreachDraftsTable` export added to `airtable.js`. Verification: 5-step e2e (batch → persist → send → state transition → double-send rejection) against live Airtable + real SendGrid; 1 draft created for Nate Herkelman with sendgridMessageId captured; cleanup deleted test draft. **Locked 2026-06-08:** `outreach_orchestration.js` + `outreach_send.js` + `notifications.js` (new) + route additions to `server.js` + `airtable.js` (outreachDraftsTable export) + brand_outreach/influencer_outreach deleted. | DONE 2026-06-08 |
| **13** | Antigravity | **Reply → classify → negotiate** — `negotiation_handler.js` extended (~330 lines). System prompt extracted to `src/prompts/negotiation_system.md` (5-label taxonomy, 5 few-shots, deal-range awareness, two new RED triggers). `src/lib/email_headers.js` created (pure header parse utility). `classifyAndExtract` replaced by `chatCompletion()` tool-use (Q5=migrate — text-output-based JSON.parse eliminated). Three-tier reply-to-draft matching: In-Reply-To → References → most-recent-sender. Deal-range context fetched from matched draft. `writeReplyCorrelationToDraft` single write path. `server.js` wired for header extraction and object-parameter call site. 8-step e2e all pass. | DONE 2026-06-10 |
| **14** | Antigravity | **Match-lock → contract handoff** — **DONE 2026-06-12** — wire new engine's `DEAL_LOCKED` output into the contract/Stripe/payout spine. Stripe `payment_intent.succeeded` triggers the lock pipeline: `validateLockedSpec()` → status `LOCKED` → `creator_payout_schedule` initialized → `generateContracts(dealId)` (dealId-targeted, compliance_spec merge tokens, doc IDs written to Deal) → status `CONTRACTS_SENT`. PandaDoc webhook extended: `document.completed` writes `contract_signed_brand` or `contract_signed_creator` ComplianceEvent; both-signed check → `CONTRACTS_SIGNED`. Legacy batch-poll path preserved with [K.6 CLEANUP CANDIDATE] annotation. 80/20 payout split: `release80Percent()` fires on brand approval (DELIVERY_APPROVED → operator-triggered); `release20Percent()` gated by `checkDay30Eligibility()` (day-30 elapsed + no active breach flags + 80% already released). **Pin 1 UnresolvedPayments:** `payment_intent.succeeded` without `deal_id` metadata fails loud with dual-surface recovery (UnresolvedPayments Airtable record + operator alert email). New endpoints: `POST /api/deals/:dealId/release-20-percent`, `GET /api/deals/:dealId/compliance-status`, `GET /api/deals/:dealId/payout-schedule`, `GET /api/deals/:dealId/compliance-events`, `GET /api/deals/:dealId/compliance-spec`, `GET /api/unresolved-payments`. Operator schema migrations required: create ComplianceEvents (10 fields) + UnresolvedPayments (7 fields) + add `pandadoc_brand_document_id` + `pandadoc_creator_document_id` to Deals. Verify: `node scripts/verify_brief14_schema.mjs`. Integration contracts: `docs/compliance_spec_schema.md`, `docs/pandadoc_merge_tokens.md`. **Dual-path pre-lock support (Brief 14-supplement):** the lock pipeline handles both `CART_DRAFT → LOCKED` (acquisition flow, §4.6 Stage A5) and `CAMPAIGN_APPROVED → LOCKED` (continuous flow, §4.7 Stage P6) identically — path-agnostic by design. `isPostLockStatus()` and `handleStripePaymentSucceeded()` in server.js treat both pre-lock states as valid inputs; the resulting LOCKED state and downstream pipeline are identical for both paths. | DONE 2026-06-12 |
**Dual-path lock pipeline (locked 2026-06-12 supplement):** the Stripe `payment_intent.succeeded` webhook handler transitions both `CART_DRAFT → LOCKED` (acquisition path, §4.6 Stage A5) and `CAMPAIGN_APPROVED → LOCKED` (continuous path, §4.7 Stage P6) identically. The pre-lock state determines which flow produced the deal; lock pipeline behavior is path-agnostic. Brief 14's code already supports both transitions because the handler reads the Deal record by `dealId` from Stripe metadata and acts on whatever pre-lock state it finds — no flow-specific branching needed.
| **14.2** | Antigravity | **Stripe Connect integration.** Provision Stripe Connect accounts for creators, route payouts via Connect (not manual transfers). Stripe runs KYC/AML on creators, handles 1099 generation, manages bank verification. Platform's liability boundary: integration correctness (§0.5.B). Creator onboarding link provisioned at deal creation; creator completes Stripe Connect onboarding before first payout. `release80Percent()` and `release20Percent()` in payment_handler.js extended to route via Stripe Connect transfer API (currently manual). | PLANNED |
| **14.3** | Antigravity | **Subscription billing infrastructure.** $2K/mo subscription charged via Stripe Subscriptions or Stripe Billing (separate from campaign payment flow). Subscription status tracked per brand record. Subscription required before brand can launch campaigns. Dashboard surfaces subscription status + next billing date. Webhook: `customer.subscription.deleted` / `invoice.payment_failed` → suspend campaign launch capability (not active deals — active deals are pre-paid). | PLANNED |
| **14.6** | Antigravity | **BYOC (Bring Your Own Creator) flow.** Creator import UI in Stage A2/A3 acquisition flow + Stage P3 continuing campaign flow. Brand provides creator email + channel URL; platform creates creator record with `byoc_source: true` flag; provisions creator dashboard invitation email; routes creator to Stripe Connect onboarding. BYOC and platform-curated creators are indistinguishable in the post-lock pipeline — the distinction is metadata on the creator record and deal. | PLANNED |
| **14.7** | Antigravity | **Brand-configurable enforcement.** Exposes payout split, release triggers, hold period, compliance criteria as brand-configurable fields in the dashboard. Default fallback: 80/20 + day-30 (Brief 14 behavior). UI: brief rules setup wizard during Stage P3 campaign creation or Settings. Storage: `enforcement_config` JSON field on Deal (locked at deal creation, immutable post-lock same as compliance_spec). `payment_handler.js` + `compliance_engine.js` extended to read deal-level enforcement_config instead of hardcoded constants. | PLANNED |
| **14.8** | Antigravity | **Comprehensive audit logging additions per §0.5.C.** Campaign creation actor logging (who, when, from what IP). Brand-configured enforcement rules snapshot at lock time. BYOC vs platform-curated creator assignment distinction in audit trail. SLA timestamps for pre-lock stages (outreach sent, reply received, match locked). Fills the coverage gap between ComplianceEvents (post-lock) + OutreachDrafts (outreach) and the missing pre-lock + actor-level audit trail. | PLANNED |
| **15** | Antigravity | **Operator dashboard rebuild.** Replaces `dashboard/app.js` + `dashboard/index.html` wholesale. Lead state board, `DEAL_INITIATED → LOCKED` approval gate, outreach draft review/edit/send panel (operator-confirmation sanitization layer), YELLOW/RED `inbound_flag` surfacing, roster interactions, revenue, pipeline health, bounce/invalid tracking. **EXTENDED 2026-05-30 scope:** `compliance_status` view per deal (each condition with timestamp evidence), `escalation_events` view per deal, `roster_eligibility` management UI + internal placement-status registry view, escalation response time as first-class metric (§0.6.2). **EXTENDED 2026-06-19 scope (Brief 14-REFRAME):** unresolved-payments queue surface (open count + link to UnresolvedPayments resolution flow); enforcement OS framing in dashboard header; subscription revenue vs campaign volume split view (subscription MRR + 3.6% transaction fee volume displayed separately as the two revenue streams). Resolves `[AUDIT 🔠 #5]` (stub handlers), `[AUDIT 🟡 #14]` (niche colors), `[AUDIT 🔠 #8]` (`follow_up_engine.js` bug surfacing). Decision in brief: `escalation_flag` stays in `tracker.js` ephemeral OR promoted to Airtable field `[AUDIT 🔠 #7]`. `pricing.json` tiered fee: deprecated — platform revenue model is subscription + 3.6% (not a percentage-of-deal fee); `payment_handler.js` hardcoded 0.15 is a ✅ CLEANUP CANDIDATE (see K.17). | EXTENDED |
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
- **`negotiation_handler.js`** — zero deal-range awareness; no `rate_range` reads; no out-of-range flag; no guarantee-scope-expansion as RED trigger. **FIXED Brief 13.**
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

**[K.6 CLEANUP CANDIDATE — Brief 14 origin]:** `server.js` + `contract_generator.js` — Pre-Brief-14 pipeline used `DEAL_LOCKED` status enum; post-Brief-14 uses `LOCKED`. Both the batch-poll path in `contract_generator.js` (queries `status = 'DEAL_LOCKED'`) and any dashboard rendering code that checks for `DEAL_LOCKED` are now legacy. **Cleanup trigger:** verify no production calls target `DEAL_LOCKED`-status deals for 14 consecutive days (check Airtable for DEAL_LOCKED-status deals going stale; check server.js for zero routes writing DEAL_LOCKED). Then: (1) remove the batch-poll `generateContracts()` code path querying DEAL_LOCKED from `contract_generator.js`, (2) remove any dashboard rendering branches for DEAL_LOCKED status. Origin: Brief 14 commit (2026-06-12). Reference: see also K.7.

**[K.7 CLEANUP CANDIDATE — Brief 14 origin]:** `server.js` PandaDoc webhook — When both parties sign, the code writes `status: 'CONTRACTS_SIGNED'` (new canonical enum) AND `contract_state: 'SIGNED'` (legacy field preserved for dashboard rendering). Pre-Brief-14 code wrote `status: 'CONTRACT_SIGNED'` (old single-signature enum). **Cleanup trigger:** verify all downstream consumers (operator dashboard rendering, contracts tab, audit queries in scripts/) read `CONTRACTS_SIGNED` (not `CONTRACT_SIGNED`), then remove the legacy `CONTRACT_SIGNED` write path (the legacy fallback block in the PandaDoc webhook that fires when `pandadoc_brand_document_id` is absent). Origin: Brief 14 commit (2026-06-12). Reference: see also K.6.

**[K.8 CLEANUP CANDIDATE — Brief 13 origin]:** `src/utils/llm.js` — `classifyAndExtract()` function has zero callers since Brief 13 migrated `negotiation_handler.js` to `chatCompletion()` tool-use (Q5=migrate). Left exported for backward compat. **Cleanup trigger:** `grep -rn classifyAndExtract src/` → zero hits (excluding the definition itself). Then remove the function. Origin: Brief 13 commit (2026-06-10).

**[K.12 — Brief 13 synthetic-test gap]:** Brief 13 e2e test (Step F.3, 8-step sequence) used a synthetic OutreachDraft created and deleted in try/finally. This means the `writeReplyCorrelationToDraft()` write path has been tested against a synthetic draft, NOT against a real operator-generated draft from the Brief 12 outreach batch flow. The gap: real drafts may have subtle field shape differences from synthetically-created ones (e.g., `scoring_metadata` field populated vs absent from SDK response). **First real outreach cycle (Brief 16 or pre-16 operator test) closes this gap.** No code action required; document for Brief 16 test planning.

**Pin 1 operational infrastructure (Brief 14):** UnresolvedPayments table + GET /api/unresolved-payments endpoint form the operator-recovery surface for `payment_intent.succeeded` events with missing `deal_id` metadata. Dual-surface recovery: (1) Airtable record written immediately, (2) operator alert email sent via SendGrid. Operator must create these records in Airtable before going live with the lock pipeline. Schema: §4.1 UnresolvedPayments table. Query surface: `GET /api/unresolved-payments` returns `{ open, resolved, total }`. Brief 15 operator dashboard surfaces the open queue. Resolution flow: look up the PI in Stripe → identify the Deal → manually trigger lock pipeline → set `resolved_at` and `resolution_notes` on the UnresolvedPayments record.

**Token approach in `contract_generator.js` (updated Brief 14):** PandaDoc templates use signer-filled fields (Signer role). Brief 14 adds `spec.*` scalar merge tokens plus repeating-region data objects. Repeating regions require template-side configuration in the PandaDoc template builder (Brief 15b/15c operator template config step). The token approach is intentional and documented in `docs/pandadoc_merge_tokens.md`.

**`view_guarantee` field on Deals (NOTE 2026-05-30):** field is defined, never written, never read. **Killed by Brief 7b.** Replaced by `compliance_spec` + `compliance_status` + `creator_payout_schedule` + `escalation_events`.

**[K.17 CLEANUP CANDIDATE — Brief 14-REFRAME origin]:** `payment_handler.js` — broker fee hardcoded `Math.round(grossAmount * 0.15)` (line 176). The 15% brokerage fee model is dead (killed 2026-06-19 Brief 14-REFRAME). Platform revenue model is now $2K/mo subscription + 3.6% transaction fee at campaign funding time (charged at Stripe Checkout, not deducted post-payment from grossAmount). **Cleanup trigger:** Brief 14.3 (subscription billing) + Brief 14.7 (brand-configurable enforcement with 3.6% fee at checkout) — once those briefs ship, remove the 0.15 multiplier entirely. Until then, the 0.15 multiply in `releasePayout()` should be understood as a legacy path that will be replaced. Origin: Brief 14-REFRAME (2026-06-19).

**[K.18 CLEANUP CANDIDATE — Brief 14-REFRAME origin]:** `config/pricing.json` — defines tiered percentage fees. This file is not consumed by any code (see §6 medium bugs). The tiered fee model is now dead. **Cleanup trigger:** after Brief 14.3 ships, delete `config/pricing.json`. Until then, do not consume it — the new model is subscription + 3.6%, not a tiered percentage of deal size. Origin: Brief 14-REFRAME (2026-06-19).

**[K.19 CLEANUP CANDIDATE — Brief 14-REFRAME origin]:** `src/views/roster.html` — contains copy that references the brokerage framing ("premium boutique brokerage," 15% fee references if any). **Cleanup trigger:** Brief 15b wholesale replacement of `roster.html` with the brand portal. Until then, `roster.html` is a known-stale placeholder. Origin: Brief 14-REFRAME (2026-06-19).

**[K.20 CLEANUP CANDIDATE — Brief 14-REFRAME origin]:** `dashboard/app.js` — niche colors + fee display logic references (if any hardcoded 15% values). The Brief 15 rebuild consumes this file wholesale. Brief 14-REFRAME kills the 15% fee reference from the rebuild scope — Brief 15 should NOT add a new 15% fee display; it should display subscription MRR + 3.6% transaction volume as the two revenue streams. Origin: Brief 14-REFRAME (2026-06-19).

**[K.21 CLEANUP CANDIDATE — Brief 14-REFRAME origin]:** `BROKERAGE_OS_LIVING_DOC_f.md` §2.3 Decision A unit economics example — line "Typical deal: brand pays $10K, creator gets $8,500, brokerage takes $1,500" uses brokerage-fee framing. Decision A's credit-and-replacement remediation doctrine is unchanged (bounded guarantee, spec+timeline, credit-and-replacement). Only the unit economics example is stale. **Cleanup trigger:** next §2 doc revision — replace example with OS-economics example (brand subscribes at $2K/mo, funds $10K campaign at checkout: $10,000 creator payout + $360 platform fee + Stripe fees = ~$10,380+ total funded; platform routes creator payout via Stripe Connect; platform retains $360; creator receives $8K on delivery + $2K on hold release under default 80/20). Origin: Brief 14-REFRAME (2026-06-19).

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
| Resolve flat-15% vs `pricing.json` tiered (pick one, apply consistently) | **Not applicable post-reframe** — 15% brokerage fee model killed 2026-06-19. Revenue model is $2K/mo subscription + 3.6% transaction fee. See K.17 + K.18 cleanup candidates |
| Confirm Airtable FK field types | **Done 2026-05-29; see §4.2** |
| **Kill `view_guarantee` field; add compliance_spec / compliance_status / creator_payout_schedule / escalation_events to Deals** | **7b** — DONE |
| **Add `roster_eligibility`, `delivery_reliability_evidence`, `placement_history` to Influencers** | **7b** — DONE |
| **Create ComplianceEvents table (10 fields: event_id Autonumber, deal_id Link to Deals, event_type Single Select, event_at Created Time, event_payload Long Text, event_attachment Attachment, event_source Single Select, event_actor Single Line, event_notes Long Text, updated_at Last Modified Time)** | **14** — DONE |
| **Create UnresolvedPayments table (7 fields: payment_intent_id Single Line, stripe_event_id Single Line, customer_email Email, amount Number/Currency, received_at Created Time, resolved_at Date optional, resolution_notes Long Text optional)** | **14** — DONE |
| **Add `pandadoc_brand_document_id` (Single Line Text) to Deals** | **14** — DONE |
| **Add `pandadoc_creator_document_id` (Single Line Text) to Deals** | **14** — DONE |
| **Revise PandaDoc templates (brand + influencer) to embed compliance_spec as structured contract terms** | **14** — DONE |
| **Extend `payment_handler.js` for 80/20 creator payout split with day-30 auto-release** | **14** — DONE |
| **Pin day-30 release mechanism — locked: operator-confirmed dashboard at early volume** | **14** — DONE |
| **Build `compliance_engine.js`** | **14** — DONE |
| **Build `support_assistant.js` + `escalation_router.js`** | **15d** — PLANNED |
| **Brand portal full build (deal-framework-first per Decision B, process-ownership funnel per Decision E)** | **15b** — PLANNED |
| **Creator portal full build (supply-side mirror)** | **15c** — PLANNED |
| **Written curation bar artifact (governance, §0.6.1)** | **18** — PLANNED |

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

> Load the `ai-first-engineering` skill. Read this entire living document. Do NOT write any brief yet. The operating doctrine in §0 is binding — especially: implementing models hallucinate identifiers, so verify everything against verbatim files; one concern per brief; real code never placeholders; sanitization = operator confirmation in the dashboard, NOT a machine layer. **Read §0.5 (product definition, OS economics, and offer structure) and §0.6 (governance doctrine) before anything else — they frame what the rest of the system serves.**
>
> **Current state:** Brief 14 done (2026-06-12). Brief 14-REFRAME done (2026-06-19, doc-only). Five strategic shifts encoded: enforcement OS positioning, $2K/mo + 3.6% fee model, brand-absorbs-costs-upstream, brand-configurable enforcement doctrine, Stream A/B/C workflow split. New sections §0.5.B (liability model) and §0.5.C (audit logging surface) added. Brief sequence extended with Briefs 14.2, 14.3, 14.6, 14.7, 14.8. Cleanup candidates K.17-K.21 surfaced. **Brief 15 unblocked.**
>
> **First move:** Read §0.5 (OS economics, $2K + 3.6% offer), §0.5.A (product positioning), §0.5.B (liability model), §0.5.C (audit logging surface). Then read the brief table in §5.5 to see what is DONE vs PLANNED. Then write the next brief.
>
> **Vocabulary discipline:** in current-state sections (architecture, code comments, PR descriptions), use "platform" not "brokerage," "creator" not "influencer," "3.6% transaction fee" not "15% fee," "enforcement and execution OS" not "boutique brokerage." Historical sections (§2.2, §2.3, Changelog) preserve the original language as historical record.

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

- **2026-05-30 (later)** — **Brief 7b done (operator task).** Schema amendment per 2026-05-30 strategic closure: `view_guarantee` killed on Deals; `compliance_spec`, `compliance_status`, `creator_payout_schedule`, `escalation_events` added to Deals (all Long Text, JSON-stringified payloads); `roster_eligibility` (Single Select, 5 options — `active` / `inactive` / `flagged_breach` / `flagged_quality` / `under_review`, default `active`), `delivery_reliability_evidence` (Long Text), `placement_history` (Long Text) added to Influencers. Round-trip verification (D.6) passed: JSON-stringify into Long Text → SDK fetch → `JSON.parse` → nested field access all clean. Brief 9 (LLM foundation) unblocked.

- **2026-06-02** — **Brief 9a done.** `src/prompts/outreach_system.md` written, operator-reviewed. Encodes strategy + 8 requirements + 3 few-shots. **Brief 9b structural decisions locked:** single brief, Anthropic tool-use enforcement, user-message template per Path Y. **Brief 9a-supplement added to do the template/Section 5 separation.**

- **2026-06-02 (later)** — **Brief 9a-supplement done.** Added Section 5 to `outreach_system.md`. **Brief 9b unblocked.**

- **2026-06-02 (later still)** — **Brief 9b done.** `llm.js` + `outreach_engine.js` shipped. Real pair tests passed. **Brief 10 unblocked.**

- **2026-06-02 (later)** — **Brief 10 + 10-supplement done.** Match-logic + Stage 0-4 defensive guards + §0.3 doctrine applied. **Brief 11 unblocked.**

- **2026-06-07** — **Brief 11 done.** Scoring engine shipped. Hybrid curation+fit logic verified. **Brief 12 unblocked.**

- **2026-06-07 (later)** — **Brief 7d done.** Schema migration for OutreachDrafts table completed. Verification passed. **Brief 12 unblocked.**

- **2026-06-08** — **Brief 12 done.** Orchestration and send engines shipped. Real e2e pass. **Brief 13 unblocked.**

- **2026-06-10** — **Brief 13 done.** Negotiation extension shipped. 5-label taxonomy, tool-use migration, header extraction/matching utility, correlation writes. **Brief 14 unblocked.**

- **2026-06-12** — **Brief 14 done.** Match-lock → contract handoff shipped. 6 files changed, 3 docs added, 1 verification script added. Full compliance object lifecycle (validate → lock → contract → sign → payout) and UnresolvedPayments recovery surface wired. **Brief 15 unblocked.**

- **2026-06-12 (supplement)** — **Brief 14-Supplement done.** Doc-only architectural precision recovery. Five new sections added: §0.5.A (Product Surface Architecture — Layer 1 economic identity vs Layer 2 software-shaped product surface; critical distinction between operator dashboard, brand portal, creator portal, Lara, and future Campaign Creation Interface), §0.5.1 (Planner/Executor Doctrine — architectural rule that planner functions never invoke executor functions and vice versa; forbids LLM-driven autonomous state changes; doctrine implications for all downstream briefs), §4.6 (Brand Experience Stages — Acquisition Flow — 6 stages A1-A6 from outreach click to dashboard landing; CART_DRAFT state, magic-link auth, Stripe checkout, Brief 14 lock trigger; canonical reference for Brief 15b + Brief 16), §4.7 (Returning-Brand Continuous Campaign Lifecycle — 7 stages P1-P7; full brand dashboard tab inventory; Campaign Creation Interface Mode 1 (structured intake, planner) + Mode 2 (contextual conversation, read-only LLM); CAMPAIGN_DRAFT/CAMPAIGN_APPROVED pre-lock states; Stage P6 in-dashboard checkout feeding identical Brief 14 lock pipeline; Lara sharp definition — NOT agent, NOT chatbot, IS natural-language routing surface over read endpoints + escalation; Lara vs Mode 2 LLM distinction), §4.8 (Creator-Side Lifecycle — 3-tab dashboard; deliverable upload flow 8-step walkthrough; brand approval/rejection gate; day-30 and day-90 closure; deliverables-as-state-transitions doctrine; Brief 15c canonical reference). §4.4 Deal state machine corrected: CAMPAIGN_DRAFT and CAMPAIGN_APPROVED added as pre-lock states for continuous path; CANCELLED state added; dual-path pre-lock explained; BREACH_FLAGGED expanded to include delivery_rejected post-lock. §5.5 Brief 14 row updated with dual-path note. No code changes. No schema migrations. Commit: `git add BROKERAGE_OS_LIVING_DOC_f.md && git commit`.

- **2026-06-19** — **Brief 14-REFRAME done (doc-only).** Founder's strategic repositioning after a week of reflection. Five strategic shifts encoded as doctrine:
  1. **Positioning → AI-native enforcement/execution OS.** Product definition (§0.5) rewritten from "dual-contract enforcement system / brokerage" to "AI-native enforcement and execution layer for creator deals and marketing campaigns at any scale." Competitive white space articulated: CreatorIQ/Impact.com are discovery + tracking; talent agencies enforce manually at $5–25K/month; nobody has packaged structured automated enforcement as SaaS. BYOC (bring-your-own-creator) unlock added as core positioning: brands import existing creator relationships; platform runs contracts, compliance, payouts for those creators too.
  2. **Offer → $2K/mo + 3.6% fee (15% brokerage fee killed).** $2,000/month subscription (system access: LLM usage, enforcement engine, dashboards, automation). 3.6% transaction fee at campaign funding (Stripe Connect infrastructure, payment routing). Brand absorbs all costs upstream at checkout: creator payout + 3.6% + Stripe processing fees = total funded. 15% brokerage-fee model formally deprecated (psychologically positions platform as middleman; $2K + 3.6% passes three psychological tests: known fixed software cost, invisible-size transaction fee, success does not penalize). K.17 + K.18 cleanup candidates surfaced for payment_handler.js hardcoded 0.15 + pricing.json.
  3. **Liability → brand configures enforcement, platform faithfully executes.** §0.5.B (Platform Liability Model) added. Stripe for payments / Shopify for commerce analogy: platform executes configured rules, does not adjudicate. Platform carries: ToS, uptime, Stripe Connect integration correctness, faithful execution of brand-configured rules, data privacy. Platform does NOT carry: KYC/AML (Stripe Connect), tax handling (Stripe Connect), dispute adjudication, campaign brief substance, brand safety judgment outside configured rules. Brand-configurable enforcement surfaces (Brief 14.7 scope): payout splits, release triggers, contract terms, breach conditions, compliance criteria.
  4. **Audit logging → comprehensive surface enumerated.** §0.5.C (Comprehensive Audit Logging Surface) added. Six categories enumerated: campaign creation logs (actor, spec snapshot, enforcement config at lock), creator assignment logs (BYOC vs curated), message logs (outreach, negotiation, LLM classification, operator overrides), payout logs (payout schedule frozen at lock, actual releases, trigger provenance), SLA timestamps (all workflow stage transitions), deliverable tracking (upload, approval, rejection, revision). Coverage gap analysis: ComplianceEvents + OutreachDrafts + Stripe logs cover much of it; gaps identified for Brief 14.8.
  5. **Workflow → Stream A/B/C split as doctrine.** (Surfaced in conversation but not yet formalized as a living doc section — Stream A = IDE implementation decision-heavy; Stream B = GitHub agentic workflow mechanical/parallel; Stream C = deferred/trigger-based. To be added as §0.7 in a future doc revision.)
  - **§0.5.A** rewritten: brokerage framing replaced with OS/SaaS framing. Competitive position table added. Critical downstream brief distinctions updated.
  - **§0.5.1** minor update: CCI Mode 1/2 note clarified (Mode 2 is read-only scoped LLM, cannot mutate brand-configured rules, only Mode 1 can).
  - **§0.6.3** updated: early-warning signal updated from "creator pushback on the 15% fee" to "creator pushback on the subscription fee or platform transaction fee."
  - **§1** system identity sentence updated: "premium boutique influencer marketing brokerage" → "AI-native enforcement and execution platform for creator deals and marketing campaigns."
  - **§4.4** minor update: post-lock state machine adds brand-configurable enforcement note; `PAYOUT_20_RELEASED` generalized to `PAYOUT_HELD_RELEASED` with transition note. 90-day compliance window generalized to "brand-configured window."
  - **§4.6** A1 copy updated (enforcement OS framing), A2 BYOC entry point added, A3 BYOC variant added + enforcement-preview note, A5 invoice breakdown transparency requirement added, A6 value-demonstration moment added.
  - **§5.5** Brief 15 description updated (15% fee reference removed, subscription MRR + 3.6% volume view added). New brief rows: 14.2 (Stripe Connect), 14.3 (subscription billing), 14.6 (BYOC flow), 14.7 (brand-configurable enforcement), 14.8 (comprehensive audit logging).
  - **§6** cleanup candidates K.17 (payment_handler.js 0.15 multiplier), K.18 (pricing.json), K.19 (roster.html stale copy), K.20 (dashboard/app.js fee display), K.21 (§2.3 unit economics example) added.
  - **§7** flat-15% pre-flight item updated: marked "not applicable post-reframe" with redirect to K.17 + K.18.
  - **§9** fresh-chat kickoff block updated to reflect current state (Brief 14-REFRAME done, Brief 15 unblocked, vocabulary discipline note added).
  - **What did NOT change:** All of §0.1–0.4 operating doctrine. All of §2 (five decisions A-E, trust stack, failure modes — doctrine unchanged; historical framing preserved). All of §3 architecture map. All of §4.2, §4.3, §4.5. All of §4.7, §4.8. All of §8 verbatim artifacts. Transactional spine unchanged. ComplianceEvents/UnresolvedPayments schema unchanged.
  - **No code changes. Doc-only. Brief 15 unblocked.**

