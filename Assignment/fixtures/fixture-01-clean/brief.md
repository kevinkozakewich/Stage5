# Migration Brief — BatchCampaign Downstream Trigger

**Fixture ID:** `fixture-01-clean`  
**Purpose:** Happy-path brief; should reach P1 with S3 PASS (≤0 remediate cycles)

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `BatchCampaign` |
| Primary key | `scm_id` (single column) |
| Trigger name | `BatchCampaign_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT, UPDATE, DELETE`
- **Operations:** Full IUD — derive command from `inserted` / `deleted` (`RI` / `RU` / `RD`)
- **Enqueue pattern:** Dynamic via `[PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]` + `sp_executesql`
- **Error handling:** `SET NOCOUNT ON`, `SET XACT_ABORT OFF`, `TRY/CATCH`, `[PurinaNA].[ToGpmq_LogTriggerError]`
- **Source parameter:** `@Source = N'Trigger'` on all enqueue paths

## Constraints

- No hard-coded business column names in static SQL
- No direct `INSERT` into `[NAF].[DownstreamMigrationQueue]`
- Composite PK: **not applicable**

## Expected Delivery

Produce `trigger.sql` suitable for DBA review and deployment to the DMO schema.
