# Migration Brief — OrderLine Composite PK Downstream Trigger

**Fixture ID:** `fixture-04-composite-pk`  
**Purpose:** Composite PK table; happy path with prep SP fan-out (Level 3: `02-composite-pk-good`)

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `OrderLine` |
| Primary key | `order_id`, `line_seq` (composite) |
| Trigger name | `OrderLine_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT, UPDATE, DELETE`
- **Enqueue pattern:** Dynamic via `[PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]` + `sp_executesql`
- **Error handling:** `SET NOCOUNT ON`, `TRY/CATCH`, `[PurinaNA].[ToGpmq_LogTriggerError]`
- **Source parameter:** `@Source = N'Trigger'`

## Constraints

- Composite PK must use prep SP (no hard-coded column lists)
- No direct `INSERT` into `[NAF].[DownstreamMigrationQueue]`

## Expected Delivery

Clean pass through S3 with 0 remediate cycles; pause at P1.
