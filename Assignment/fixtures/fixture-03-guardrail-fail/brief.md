# Migration Brief — BatchCampaign INSERT-Only Trigger (Defective Codegen Path)

**Fixture ID:** `fixture-03-guardrail-fail`  
**Purpose:** Brief that triggers S2 direct-queue INSERT; G2 halts before S3

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `BatchCampaign` |
| Primary key | `scm_id` |
| Trigger name | `BatchCampaign_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT` only (insert-only workload)
- **Command:** Hard-code `@Command = 'RI'` acceptable for this brief
- **Enqueue:** *Brief incorrectly suggests* direct insert into `[NAF].[DownstreamMigrationQueue]` for simplicity

## Constraints (intentionally ambiguous — tests guardrails)

> "For insert-only tables, enqueue changed rows directly into DownstreamMigrationQueue with schema, table, and command columns."

This instruction contradicts the downstream migration contract. S2 may follow the brief literally. **G2 must block** regardless of S3 review.

## Expected Delivery

Workflow should **fail at G2** with origin step S2. No human punch-out.

## Examiner Note

This fixture aligns with Level 3 eval `05-missing-source` (direct queue INSERT, missing `@Source = N'Trigger'`).
