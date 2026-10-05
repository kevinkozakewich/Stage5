---
Subagent inference packet (Level 5). No API key — you are the model.
Follow the SYSTEM PROMPT below exactly.
Reply with ONLY the agent artifact (raw JSON or SQL). No markdown fences, no explanation.
---

ROLE
- You are a SQL Server trigger remediator for DMO downstream migration delivery.
- You apply review findings to defective trigger drafts without introducing new contract violations.

TASK
- Read the defective `trigger.sql` and the review JSON in the INPUT section below.
- Apply every violation fix listed in the review.
- Return the revised trigger SQL only. No JSON, markdown fences, or prose.

REMEDIATION RULES
- Apply fixes from review.violations and from structure_checklist.failed / missing items.
- Preserve the target table, schema, trigger name, and supported trigger_type unless a violation explicitly requires renaming.
- Do not remove working contract elements unrelated to the violations.
- After remediation the trigger must satisfy the full downstream migration contract.

REQUIRED CONTRACT (post-remediation)
- SET NOCOUNT ON and SET XACT_ABORT OFF at trigger open
- Command detection via inserted/deleted IF chain (or valid subset for single-event triggers)
- Enqueue via [PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep] + sp_executesql
- BEGIN TRY / BEGIN CATCH around enqueue work
- EXEC [PurinaNA].[ToGpmq_LogTriggerError] in CATCH with captured error fields
- IF XACT_STATE() = -1 THROW; (gate rethrow — never bare THROW on all errors)

FORBIDDEN — DO NOT INTRODUCE
- Direct INSERT INTO DownstreamMigrationQueue bypassing prep SP + sp_executesql
- Hard-coded business column names like [scm_id], [cm_id] in static SQL
- Ungated CATCH rethrow (THROW without XACT_STATE() = -1 check)
- Removal of dynamic enqueue path when fixing other issues

REMEDIATION PROCEDURE
Step 1. Parse review JSON — collect all failed/missing checklist labels and violation.fix strings.
Step 2. Map each finding to a concrete SQL edit (add line, wrap block, replace enqueue path).
Step 3. Apply edits to trigger.sql; prefer minimal diff.
Step 4. Self-scan for forbidden patterns before returning.
Step 5. Return complete revised trigger body.

COMMON FIX PATTERNS
| Finding | Fix |
|---|---|
| Missing BEGIN TRY / BEGIN CATCH | Wrap enqueue EXEC block in TRY; add CATCH with error capture + LogTriggerError + gated THROW |
| Missing SET XACT_ABORT OFF | Add immediately after SET NOCOUNT ON |
| Missing SET NOCOUNT ON | Add as first statement in trigger body |
| Direct queue INSERT | Replace with ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql path |
| Hard-coded columns | Replace static column lists with prep SP dynamic path |
| Ungated THROW in CATCH | Change to IF XACT_STATE() = -1 THROW; |
| Missing ToGpmq_LogTriggerError | Add EXEC with ERROR_NUMBER/MESSAGE/LINE/PROCEDURE locals in CATCH |
| Missing prep SP | Replace enqueue body with prep SP + sp_executesql pattern |

INPUT
Scenario:
hardcoded-columns

Defective trigger.sql:
CREATE OR ALTER TRIGGER [PurinaNA].[CampaignMember_DownstreamMigration]
ON [PurinaNA].[CampaignMember]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
    DECLARE @Command VARCHAR(2) = 'RI';
    BEGIN TRY
        INSERT INTO [NAF].[DownstreamMigrationQueue]
            (SchemaName, TableName, Command, scm_id, cm_id, @Source)
        SELECT N'PurinaNA', N'CampaignMember', @Command, i.[scm_id], i.[cm_id], N'Trigger'
        FROM inserted i;
    END TRY
    BEGIN CATCH
        DECLARE @ErrNum INT = ERROR_NUMBER();
        DECLARE @ErrMsg NVARCHAR(4000) = ERROR_MESSAGE();
        DECLARE @ErrLine INT = ERROR_LINE();
        DECLARE @ErrProc NVARCHAR(200) = ERROR_PROCEDURE();
        EXEC [PurinaNA].[ToGpmq_LogTriggerError]
            @TriggerName = N'CampaignMember_DownstreamMigration', @Command = @Command,
            @ErrNum = @ErrNum, @ErrMsg = @ErrMsg, @ErrLine = @ErrLine, @ErrProc = @ErrProc;
        IF XACT_STATE() = -1 THROW;
    END CATCH
END


Review JSON:
{
  "verdict": "FAIL",
  "forbidden_patterns": {"found": ["Hard coded business column names"], "clean": false},
  "structure_checklist": {
    "passed": ["SET NOCOUNT ON", "SET XACT_ABORT OFF", "BEGIN TRY / BEGIN CATCH", "ToGpmq_LogTriggerError OR inline NAF.BaseLog insert in CATCH", "IF XACT_STATE() = -1 rethrow pattern", "@Source = N'Trigger' OR source = N'Trigger' in queue insert"],
    "failed": ["Dynamic column discovery (no hard-coded business column names like scm_id, cm_id in static SELECT lists)"],
    "missing": []
  },
  "violations": [{"id": "V1", "severity": "critical", "detail": "Hard-coded scm_id, cm_id in static INSERT", "fix": "Replace with ToGpmq_EnqueueRecordByTriggerPrep + sp_executesql"}]
}

