# PandaDoc Merge Token Naming Convention

> **Integration contract.** This document defines how `compliance_spec` JSON fields are encoded as PandaDoc merge tokens by `contract_generator.js`. Brief 15b (brand portal) and Brief 15c (creator portal) must produce the same structured terms from the same `compliance_spec` source — this document is the equivalence anchor that Brief 16's portal/contract equivalence test validates.
>
> **Source:** Brief 14 implementation. All token names used verbatim in `contract_generator.js` `specTokens` array.

---

## Naming Convention

All merge tokens derived from `compliance_spec` use the prefix `spec.` followed by a path encoding:

```
spec.<section>_<field>
```

- Section separator: `_` (underscore)
- CamelCase fields are converted to `snake_case`
- Array fields (deliverables, compliance_criteria) use **repeating regions** in PandaDoc templates — not scalar tokens
- Dollar amounts are formatted as `$N,NNN.NN` (USD) before tokenization

Examples:
- `spec.timeline_delivery_due_date` ← `compliance_spec.timeline.delivery_due_date`
- `spec.payout_terms_split_80_amount` ← `compliance_spec.payout_terms.split_80_amount` (formatted as currency)

---

## Scalar Merge Tokens

These are set as `tokens[]` in the PandaDoc API call and can be placed anywhere in a template with `{{token_name}}` syntax.

| Token Name | Source Path | Format |
|---|---|---|
| `spec.timeline_delivery_due_date` | `timeline.delivery_due_date` | ISO date string as-is |
| `spec.timeline_live_content_window_days` | `timeline.live_content_window_days` | String representation of number |
| `spec.timeline_creator_acceptance_deadline` | `timeline.creator_acceptance_deadline` | ISO date string, or empty string if absent |
| `spec.scope_exclusivity` | `scope.exclusivity` | String (`none`, `category`, `full`) — defaults to `"none"` |
| `spec.scope_usage_rights` | `scope.usage_rights` | String |
| `spec.scope_revisions_allowed` | `scope.revisions_allowed` | String representation of number |
| `spec.scope_geographic_scope` | `scope.geographic_scope` | String — defaults to `"global"` |
| `spec.payout_terms_total_creator_payout_amount` | `payout_terms.total_creator_payout_amount` | USD formatted: `"$8,500.00"` |
| `spec.payout_terms_split_80_amount` | `payout_terms.split_80_amount` | USD formatted: `"$6,800.00"` |
| `spec.payout_terms_split_20_amount` | `payout_terms.split_20_amount` | USD formatted: `"$1,700.00"` |
| `spec.payout_terms_split_20_release_method` | `payout_terms.split_20_release_method` | String — defaults to `"operator_confirmed_dashboard"` |

### Legacy / pre-Brief-14 scalar tokens (unchanged)

These tokens pre-existed Brief 14 and are populated from Deal + Brand + Creator records directly:

| Token Name | Source |
|---|---|
| `Brand.Name` | `brand.company_name` |
| `Brand.ContactEmail` | `brand.contact_email` |
| `Creator.Name` | `influencer.name` |
| `Creator.Email` | `influencer.email` |
| `Creator.ChannelURL` | `influencer.channel_url` |
| `Deal.AgreedRate` | `deal.agreed_rate` |
| `Deal.Deliverables` | `quote_terms.deliverable_type` or `deal.deliverables` |
| `Deal.ID` | `deal.deal_id` |
| `Agreement.Date` | Current date (ISO 8601) |

---

## Array / Repeating Region Data

PandaDoc supports **repeating regions** for rendering tables from array data. These are configured in the PandaDoc template builder by the operator (Brief 15b/15c template configuration step), not in the API call tokens.

The data is passed as `metadata.fields` in the PandaDoc document creation payload, or embedded in template placeholders per PandaDoc's documented repeating-region API.

### Region: `deliverables`

One row per element of `compliance_spec.deliverables[]`.

| Column Variable | Source Field | Format |
|---|---|---|
| `deliverable_platform` | `deliverables[i].platform` | String |
| `deliverable_format` | `deliverables[i].format` | String |
| `deliverable_duration_seconds` | `deliverables[i].duration_seconds` | String, or `"N/A"` if absent |
| `deliverable_count` | `deliverables[i].count` | String |
| `deliverable_notes` | `deliverables[i].notes` | String, or empty |

### Region: `compliance_criteria`

One row per element of `compliance_spec.compliance_criteria[]`.

| Column Variable | Source Field | Format |
|---|---|---|
| `criterion_id` | `compliance_criteria[i].criterion_id` | String |
| `criterion_definition` | `compliance_criteria[i].definition` | String (appears verbatim in contract) |
| `criterion_verification_method` | `compliance_criteria[i].verification_method` | String |

---

## Brief 14 Implementation Note

In `contract_generator.js`, the repeating region data objects (`deliverablesRegionData`, `complianceCriteriaRegionData`) are computed and logged but are not yet attached via the PandaDoc API call — PandaDoc's repeating region API requires template-side configuration that the operator does in the template builder.

**Brief 15b/15c operator template configuration step:**

1. Open the PandaDoc brand template (`PANDADOC_BRAND_TEMPLATE_ID`) and creator template (`PANDADOC_INFLUENCER_TEMPLATE_ID`) in the PandaDoc template builder.
2. Add a repeating region for deliverables with the column variables listed above.
3. Add a repeating region for compliance_criteria with the column variables listed above.
4. Verify that the scalar tokens (`spec.*`) appear in the correct sections of the contract.
5. After configuration, run `node scripts/verify_brief14_schema.mjs` to confirm the templates render correctly against a test deal.

The equivalence test in Brief 16 validates that the rendered contract and the brand portal display show the same data in the same structure — this is the §2.3 "no drift between portal and contract" commitment made manifest as a test.

---

## Brand Portal / Creator Portal Rendering (Brief 15b/15c)

The portals render `compliance_spec` directly from the Deal record via `GET /api/deals/:dealId/compliance-spec`. They must use the same field paths and display the same values as the PandaDoc tokens above. The mapping is:

| Portal Display | API Field Path |
|---|---|
| "Delivery by" | `spec.timeline.delivery_due_date` |
| "Content live until" | `spec.timeline.remains_live_until` OR computed from `delivery_due_date + live_content_window_days` |
| "Usage rights" | `spec.scope.usage_rights` |
| "Creator payout (80%)" | `spec.payout_terms.split_80_amount` |
| "Compliance hold (20%)" | `spec.payout_terms.split_20_amount` |
| "Hold release method" | `spec.payout_terms.split_20_release_method` |
| Deliverables table | `spec.deliverables[]` (all fields) |
| Compliance criteria table | `spec.compliance_criteria[]` (`criterion_id`, `definition`, `verification_method`) |

Brief 16 equivalence test: render a test deal's `compliance_spec` via the portal endpoint and the PandaDoc contract, then assert field-by-field equality.
