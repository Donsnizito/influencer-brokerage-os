# Engineering Implementation Spec

## Phase 2: Multi-Deal Capacity Model for Influencers

**Problem**: Current MVP uses a single global status field on the Influencer record. When a brand selects an influencer via the roster portal, the influencer's status mutates to `DEAL_INITIATED`, removing them from all future roster views for other brands. This conflicts with the business model, which allows influencers to take on multiple concurrent sponsorship deals.

**Phase 2 Fix**:
This will be addressed via three components:
1. Decouple the Influencer's global status from per-Deal state. The Influencer's status should reflect their lifecycle position (e.g., `QUOTE_RECEIVED`) and remain stable when individual deals are initiated.
2. Add a `concurrent_deal_capacity` integer field on the Influencer table (default value to be determined; reasonable starting default: 3).
3. Modify the roster query to dynamically filter against the Deals table: an influencer is hidden from a roster only if their count of active deals (status `DEAL_INITIATED`, `DEAL_LOCKED`, or any non-terminal Deal state) equals or exceeds their `concurrent_deal_capacity`.

**Implementation Status**: Deferred to Phase 2. Not in scope for Brief 1.
