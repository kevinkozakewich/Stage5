# Migration Brief — Persistent Review FAIL (Retries Exhausted)

**Fixture ID:** `fixture-08-retries-exhausted`  
**Purpose:** S3 always FAILs; remediate loop exhausts max 2 cycles; terminal failure

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `BatchCampaign` |
| Primary key | `scm_id` |
| Trigger name | `BatchCampaign_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT, UPDATE, DELETE`
- **Enqueue pattern:** Standard prep SP (S2 passes G2)
- **Error handling:** Required

## Known Risk (intentional eval scenario)

Review persistently returns FAIL (direct queue INSERT pattern). S4 remediate cannot fix within 2 cycles. Workflow terminates at S3 with retries exhausted.

## Expected Delivery

Workflow **fails at S3** after 2 remediate cycles. No punch-out.
