# Migration Brief — VendorContact Downstream Trigger

**Fixture ID:** `fixture-02-remediate`  
**Purpose:** Brief that tends to produce a first-pass defect remediated by S4 (missing TRY/CATCH)

---

## Target Table

| Field | Value |
|---|---|
| Schema | `PurinaNA` |
| Table | `VendorContact` |
| Primary key | `vendor_id`, `contact_seq` (composite) |
| Trigger name | `VendorContact_DownstreamMigration` |

## Trigger Specification

- **Type:** `AFTER INSERT, UPDATE, DELETE`
- **Operations:** Full IUD with standard command detection
- **Enqueue pattern:** Dynamic via `[PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]` + `sp_executesql`
- **Error handling:** Required — `TRY/CATCH`, `[PurinaNA].[ToGpmq_LogTriggerError]`, `IF XACT_STATE() = -1 THROW`
- **Source parameter:** `@Source = N'Trigger'`

## Constraints

- Composite PK must fan out via prep SP (no manual column lists)
- No hard-coded contact or vendor column names beyond schema/table literals

## Known Risk (intentional eval scenario)

First codegen pass may omit `BEGIN TRY / BEGIN CATCH` (Level 3 pattern: `04-missing-trycatch`). Review should FAIL; S4 applies structural fix; second S3 pass should PASS.

## Expected Delivery

Produce `trigger.sql` after ≤1 remediate cycle, then pause at P1 for DBA approval.
