# Compliance Spec — JSON Schema Definition

> **Integration contract.** This document is the source of truth for the `compliance_spec` JSON object stored on Deal records in Airtable. Brief 14 owns the schema. Downstream briefs that read compliance_spec (Brief 15b brand portal, Brief 15c creator portal, Brief 16 equivalence test) **must validate against this document before implementation**.
>
> Source-tagging per §0.1 doctrine: this is `[SPEC]` — derived from the locked 2026-05-30 strategic decisions (§2.3, §2.6, §4.1, §8.3/§8.4) and the Brief 14 implementation. The `validateLockedSpec()` function in `src/skills/compliance_engine.js` enforces required fields at lock time.
>
> **Immutability rule:** Once a deal transitions to `LOCKED` status (triggered by `payment_intent.succeeded`), the `compliance_spec` is frozen. No field may be modified post-lock. Any required change requires creating a new deal.

---

## Root Object

```json
{
  "deliverables": [ ... ],
  "timeline": { ... },
  "scope": { ... },
  "compliance_criteria": [ ... ],
  "payout_terms": { ... }
}
```

All five top-level keys are required. The object is stored as a JSON-stringified Long Text on the `compliance_spec` field of the Deals table. Defensive read per §0.3: `JSON.parse(deal.compliance_spec ?? '{}')`.

---

## deliverables — Array (required, non-empty)

Each element describes one deliverable unit.

```json
{
  "platform": "youtube",
  "format": "integration",
  "duration_seconds": 45,
  "min_video_length_seconds": 480,
  "count": 1,
  "required_talking_points": ["point 1", "point 2", "point 3"],
  "required_disclosures": ["FTC", "platform_specific"],
  "pre_post_approval": true,
  "notes": "Must be a dedicated brand segment, not a mention."
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `platform` | string | yes | `youtube` \| `instagram` \| `tiktok` \| `podcast` \| `blog` |
| `format` | string | yes | `integration` \| `dedicated` \| `mention` \| `post` \| `story` \| `reel` \| `episode_segment` |
| `duration_seconds` | number | no | Minimum dedicated brand segment length in seconds |
| `min_video_length_seconds` | number | no | Minimum total content length in seconds (YouTube) |
| `count` | number | yes | Number of units of this deliverable type (typically 1) |
| `required_talking_points` | string[] | no | Ordered list of required talking points. Empty array or absent = no requirement |
| `required_disclosures` | string[] | no | Disclosure requirements. Values: `"FTC"`, `"platform_specific"`, `"paid_partnership"`. Empty array = none |
| `pre_post_approval` | boolean | no | Whether the creator must submit content for brand approval before publishing. Default: `false` |
| `notes` | string | no | Free-text operator notes. Not surfaced in contracts. |

---

## timeline — Object (required)

```json
{
  "delivery_due_date": "2026-07-15",
  "remains_live_until": "2026-10-13",
  "live_content_window_days": 90,
  "creator_acceptance_deadline": "2026-06-20"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `delivery_due_date` | string (ISO 8601 date) | **yes** | Content must be live by this date |
| `remains_live_until` | string (ISO 8601 date) | no | Content must remain posted until this date. If absent, computed as `delivery_due_date + live_content_window_days` |
| `live_content_window_days` | number | **yes** | Minimum live-content window in days (90 per Decision A/D). Must be 90 unless operator explicitly overrides |
| `creator_acceptance_deadline` | string (ISO 8601 date) | no | Creator must counter-sign by this date. Optional; if absent, no automated enforcement |

**Invariant:** `remains_live_until` ≥ `delivery_due_date + live_content_window_days` (days). The system validates this at lock time if both are present.

---

## scope — Object (required)

```json
{
  "exclusivity": "none",
  "exclusivity_window_days": null,
  "usage_rights": "standard_promotional",
  "revisions_allowed": 1,
  "geographic_scope": "global"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `exclusivity` | string | no | `none` \| `category` \| `full`. Default: `none` |
| `exclusivity_window_days` | number or null | no | Exclusivity window if `exclusivity != "none"`. Must be specified when exclusivity is non-none |
| `usage_rights` | string | **yes** | `standard_promotional` \| `white_label` \| `buyout`. Determines what brand can do with content post-campaign |
| `revisions_allowed` | number | no | Number of revision rounds permitted before content is approved. Default: `1` |
| `geographic_scope` | string | no | `global` \| `us_only` \| `north_america` \| `eu`. Default: `global` |

---

## compliance_criteria — Array (required, non-empty)

Each element defines one verifiable condition the compliance engine evaluates.

```json
[
  {
    "criterion_id": "cr_ftc_disclosure",
    "definition": "Content must include an explicit FTC #ad or #sponsored disclosure within the first three seconds of the segment or in the post caption.",
    "verification_method": "brand_approval",
    "auto_verifiable": false
  },
  {
    "criterion_id": "cr_talking_points_covered",
    "definition": "All three required talking points must be verbally mentioned in the dedicated brand segment.",
    "verification_method": "brand_approval",
    "auto_verifiable": false
  },
  {
    "criterion_id": "cr_content_live",
    "definition": "Content must remain publicly accessible (not deleted, not made private) until 2026-10-13.",
    "verification_method": "system_link_check",
    "auto_verifiable": true
  }
]
```

| Field | Type | Required | Description |
|---|---|---|---|
| `criterion_id` | string | **yes** | Unique identifier for this criterion. Used as key in `conditionsMet` and `evidence` maps returned by `deriveDealState()`. Convention: `cr_` prefix + snake_case |
| `definition` | string | **yes** | Human-readable, unambiguous definition of the condition. This text appears verbatim in PandaDoc contracts and brand/creator portals |
| `verification_method` | string | **yes** | `brand_approval` \| `system_link_check` \| `manual_review`. Determines how `deriveDealState()` evaluates the criterion |
| `auto_verifiable` | boolean | no | Whether the condition can be verified without operator intervention. Informational only — Brief 16 uses for test planning |

### verification_method dispatch (as implemented in compliance_engine.js)

| Method | Satisfied by |
|---|---|
| `brand_approval` | A `brand_approval` ComplianceEvent exists for this deal |
| `system_link_check` | Placeholder for Brief 16 automated link checking; currently treated as `manual_review` |
| `manual_review` | A `compliance_event_manual` ComplianceEvent exists whose `event_payload.criterion_id` matches this `criterion_id` |

---

## payout_terms — Object (required)

```json
{
  "total_creator_payout_amount": 8500,
  "split_80_amount": 6800,
  "split_20_amount": 1700,
  "split_20_release_method": "operator_confirmed_dashboard"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `total_creator_payout_amount` | number | **yes** | Total payout to creator in USD (not including brokerage fee). Example: brand pays $10K, broker takes 15% ($1,500), creator receives $8,500 |
| `split_80_amount` | number | **yes** | 80% split in USD (`total_creator_payout_amount * 0.80`, rounded to nearest cent) |
| `split_20_amount` | number | **yes** | 20% compliance-validation hold in USD (`total_creator_payout_amount * 0.20`, rounded to nearest cent). Must satisfy `split_80_amount + split_20_amount == total_creator_payout_amount` ±$0.01 |
| `split_20_release_method` | string | no | `operator_confirmed_dashboard` (only supported value at early volume). Future: `auto_scheduled` when deal volume exceeds ~30/month |

**Invariant enforced by `validateLockedSpec()`:** `split_80_amount + split_20_amount ≈ total_creator_payout_amount` (within $0.01 rounding tolerance).

---

## Full Example (all fields)

```json
{
  "deliverables": [
    {
      "platform": "youtube",
      "format": "integration",
      "duration_seconds": 45,
      "min_video_length_seconds": 480,
      "count": 1,
      "required_talking_points": [
        "Product reduces joint pain within 2 weeks of daily use",
        "Made with only 3 ingredients, all USDA certified organic",
        "Subscription saves 20% — reference the link in the description"
      ],
      "required_disclosures": ["FTC", "platform_specific"],
      "pre_post_approval": true,
      "notes": "Brand requires a 15-second \"hero shot\" of the product packaging at segment open."
    }
  ],
  "timeline": {
    "delivery_due_date": "2026-07-15",
    "remains_live_until": "2026-10-13",
    "live_content_window_days": 90,
    "creator_acceptance_deadline": "2026-06-20"
  },
  "scope": {
    "exclusivity": "category",
    "exclusivity_window_days": 30,
    "usage_rights": "standard_promotional",
    "revisions_allowed": 2,
    "geographic_scope": "global"
  },
  "compliance_criteria": [
    {
      "criterion_id": "cr_ftc_disclosure",
      "definition": "Content must include an explicit FTC #ad or #sponsored disclosure within the first three seconds of the segment or in the post caption.",
      "verification_method": "brand_approval",
      "auto_verifiable": false
    },
    {
      "criterion_id": "cr_talking_points_covered",
      "definition": "All three required talking points must be verbally mentioned in the dedicated brand segment.",
      "verification_method": "brand_approval",
      "auto_verifiable": false
    },
    {
      "criterion_id": "cr_content_live",
      "definition": "Content must remain publicly accessible (not deleted, not made private) until 2026-10-13.",
      "verification_method": "system_link_check",
      "auto_verifiable": true
    }
  ],
  "payout_terms": {
    "total_creator_payout_amount": 8500,
    "split_80_amount": 6800,
    "split_20_amount": 1700,
    "split_20_release_method": "operator_confirmed_dashboard"
  }
}
```

---

## Relationship to Other Data Contracts

| Contract | Location | Relationship |
|---|---|---|
| `creator_payout_schedule` JSON | Deal record, Long Text field | Initialized from `payout_terms` at lock time. Written by `handleStripePaymentSucceeded()` in server.js. Tracks actual release dates and transfer IDs |
| ComplianceEvents table | Airtable | Events that `deriveDealState()` evaluates against this schema. Event types are an implementation concern of compliance_engine.js |
| PandaDoc merge tokens | `docs/pandadoc_merge_tokens.md` | Flattened scalar/array encoding of this schema for PandaDoc template rendering |
| `compliance_status` read object | `GET /api/deals/:dealId/compliance-status` | Derived from `deriveDealState(deal, events)` — not stored, always re-derived |

---

## Validation Function Reference

```js
import { validateLockedSpec } from '../src/skills/compliance_engine.js';

const { valid, errors } = validateLockedSpec(spec);
// valid: false if any required field is missing or payout split doesn't add up
// errors: array of human-readable error strings
```

Called at lock time in `handleStripePaymentSucceeded()` in `server.js`. If invalid, the deal is marked `BREACH_FLAGGED` and the operator is alerted.
