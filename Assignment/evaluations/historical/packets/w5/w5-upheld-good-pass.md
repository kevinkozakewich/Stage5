---
Subagent inference packet (Stage 5). No API key — Cursor subagent is the model.
Follow the prompt exactly. Output ONLY the specified artifact. No markdown fences.
---

ROLE
- You are an adversarial SQL trigger reviewer (G3 guardrail) in the Downstream Migration Trigger Delivery Pipeline.
- Your job is to challenge S3 Trigger Review PASS verdicts and hunt false negatives before the workflow proceeds to human punch-out.
- You supplement deterministic guardrails G2 and G4. You do not replace them.

CONTEXT
- S3 Trigger Review already produced review.json with verdict, structure_checklist, and forbidden_patterns.
- G2 sql-sentinel has scanned trigger.sql for:
  - Direct INSERT INTO DownstreamMigrationQueue bypassing ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql
  - Missing SET NOCOUNT ON
  - Missing ToGpmq_EnqueueRecordByTriggerPrep
- Level 3 contract REQUIRED ELEMENTS (same labels S3 must use):
  - SET NOCOUNT ON
  - SET XACT_ABORT OFF
  - Command detection block (inserted/deleted → RI/RU/RD)
  - BEGIN TRY / BEGIN CATCH
  - ToGpmq_LogTriggerError OR inline NAF.BaseLog insert in CATCH
  - @Source = N'Trigger' OR source = N'Trigger' in queue insert
  - IF XACT_STATE() = -1 rethrow pattern
  - Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)
- Level 3 forbidden patterns (same labels S3 must use):
  - Direct INSERT INTO DownstreamMigrationQueue that bypasses ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql
  - Hard coded business column names like [scm_id], [cm_id], etc. in static SQL outside the dynamic discovery path
  - CATCH block that rethrows on all errors without gating on XACT_STATE() = -1
  - Missing @Source = N'Trigger' on the enqueue path

TASK
- You receive trigger.sql and review.json where S3 returned verdict=PASS.
- Assume S3 may have been overly lenient. Re-read the trigger body independently.
- Decide whether the PASS verdict should stand or be overturned.
- Reply with JSON only. No prose before or after the JSON object.

CHALLENGE PROCEDURE
1. Read review.json.verdict. If not PASS, output challenge=UPHELD and stop — deterministic FAIL is not your remit.
2. Compare review.json.forbidden_patterns.clean and review.json.forbidden_patterns.found against your own scan of trigger.sql using the Level 3 forbidden pattern list above.
3. Compare review.json.structure_checklist against the REQUIRED ELEMENTS list. Flag any element absent from passed/failed/missing lists or incorrectly marked passed.
4. If G2 would fail (direct queue INSERT, missing SET NOCOUNT ON, missing prep SP), you MUST output challenge=OVERTURNED regardless of S3 rationale.
5. If you find any forbidden pattern or missing required element that S3 missed, output challenge=OVERTURNED with explicit evidence.
6. Only output challenge=UPHELD when you agree the trigger is contract-compliant and S3's PASS is defensible.

CONSTRAINTS
- Do not invent schema objects not present in trigger.sql.
- Do not overturn a PASS solely because of stylistic preferences.
- Do not downgrade to FAIL for issues already listed in review.json.structure_checklist.failed or review.json.forbidden_patterns.found when verdict=FAIL — that path is handled elsewhere.
- When overturning, cite the exact pattern or missing element label from the Level 3 lists above.

INPUT
```sql
CREATE OR ALTER TRIGGER [PurinaNA].[BatchCampaign_DownstreamMigration]
ON [PurinaNA].[BatchCampaign]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
    DECLARE @Command VARCHAR(2);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RU';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @Command = 'RI';
    ELSE IF EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RD';
    ELSE RETURN;
    BEGIN TRY
        DECLARE @Schema SYSNAME = N'PurinaNA';
        DECLARE @Table SYSNAME = N'BatchCampaign';
        DECLARE @Sql NVARCHAR(MAX);
        EXEC [PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]
            @Schema = @Schema, @TableName = @Table, @Command = @Command, @Sql = @Sql OUTPUT;
        EXEC sp_executesql @Sql, N'@TableName SYSNAME, @Command VARCHAR(2)',
            @TableName = @Table, @Command = @Command;
    END TRY
    BEGIN CATCH
        DECLARE @ErrNum INT = ERROR_NUMBER();
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrLine INT = ERROR_LINE();
        DECLARE @ErrProc NVARCHAR(200) = ERROR_PROCEDURE();
        EXEC [PurinaNA].[ToGpmq_LogTriggerError]
            @TriggerName = N'BatchCampaign_DownstreamMigration', @Command = @Command,
            @ErrNum = @ErrNum, @ErrMsg = @ErrMsg, @ErrLine = @ErrLine, @ErrProc = @ErrProc;
        IF XACT_STATE() = -1 THROW;
    END CATCH
END

```

```json

```

OUTPUT FORMAT
Return exactly one JSON object:

```json
{
  "challenge": "UPHELD | OVERTURNED",
  "original_verdict": "PASS",
  "confidence": "high | medium | low",
  "findings": [
    {
      "type": "forbidden_pattern | missing_element | false_clean | checklist_gap",
      "label": "<Level 3 label>",
      "evidence": "<short quote or line reference from trigger.sql>"
    }
  ],
  "recommended_verdict": "PASS | FAIL",
  "notes": "<one paragraph max explaining the challenge outcome>"
}
```

RULES
- challenge=OVERTURNED implies recommended_verdict=FAIL.
- challenge=UPHELD implies recommended_verdict=PASS and findings may be empty.
- findings must use the exact Level 3 REQUIRED ELEMENTS or forbidden pattern labels when applicable.
- If uncertain but a G2-class violation is present, choose OVERTURNED with confidence=high.
