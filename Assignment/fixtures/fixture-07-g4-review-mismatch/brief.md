# Migration Brief — G4 Review JSON Cross-Check Failure

**Fixture ID:** `fixture-07-g4-review-mismatch`  
**Purpose:** S3 returns PASS but `forbidden_patterns.clean=false`; G4 blocks handoff

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
- **Enqueue pattern:** Standard prep SP + `sp_executesql`
- **Error handling:** Full TRY/CATCH

## Known Risk (intentional eval scenario)

Review agent may return `verdict=PASS` while `forbidden_patterns.clean=false` (dirty SQL not flagged). **G4 must block** regardless of S3 verdict.

## Expected Delivery

Workflow **fails at G4** with origin step S3. No punch-out.
