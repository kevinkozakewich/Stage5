# Migration Brief — AuditEvent Insert-Only Downstream Trigger

**Fixture ID:** `fixture-05-insert-only`  
**Purpose:** Insert-only trigger with RI command detection (Level 3: `03-insert-only-good`)

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `AuditEvent` |
| Primary key | `event_id` |
| Trigger name | `AuditEvent_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT` only
- **Command:** Derive `RI` from `inserted` rows
- **Enqueue pattern:** Dynamic via `[PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]` + `sp_executesql`
- **Error handling:** Full TRY/CATCH with `[PurinaNA].[ToGpmq_LogTriggerError]`
- **Source parameter:** `@Source = N'Trigger'`

## Constraints

- No IUD branching beyond insert-only workload
- No direct queue INSERT

## Expected Delivery

Clean pass; 0 remediate cycles; pause at P1.
