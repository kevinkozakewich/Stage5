/**
 * Builds deterministic golden trigger.sql from requirements fixture vars.
 */

function parseRequirements(vars) {
  const raw = vars.requirements_json;
  if (typeof raw === 'object') return raw;
  return JSON.parse(String(raw));
}

function normalizePk(pk) {
  if (Array.isArray(pk)) return pk;
  return [String(pk)];
}

function buildCommandBlock(triggerType) {
  if (/AFTER INSERT, UPDATE, DELETE/i.test(triggerType)) {
    return `    DECLARE @Command VARCHAR(2);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RU';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @Command = 'RI';
    ELSE IF EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RD';
    ELSE RETURN;`;
  }
  if (/AFTER INSERT$/i.test(String(triggerType).trim())) {
    return `    DECLARE @Command VARCHAR(2) = 'RI';`;
  }
  if (/AFTER UPDATE$/i.test(String(triggerType).trim())) {
    return `    DECLARE @Command VARCHAR(2) = 'RU';`;
  }
  if (/AFTER DELETE$/i.test(String(triggerType).trim())) {
    return `    DECLARE @Command VARCHAR(2) = 'RD';`;
  }
  return `    DECLARE @Command VARCHAR(2);
    IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RU';
    ELSE IF EXISTS (SELECT 1 FROM inserted)
        SET @Command = 'RI';
    ELSE IF EXISTS (SELECT 1 FROM deleted)
        SET @Command = 'RD';
    ELSE RETURN;`;
}

function buildGoldenOutput(vars) {
  const req = parseRequirements(vars);
  const schema = req.schema || 'PurinaNA';
  const table = req.table;
  const triggerType = req.trigger_type;
  const triggerName = `${table}_DownstreamMigration`;
  normalizePk(req.pk);

  return `CREATE OR ALTER TRIGGER [${schema}].[${triggerName}]
ON [${schema}].[${table}]
${triggerType}
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
${buildCommandBlock(triggerType)}
    BEGIN TRY
        DECLARE @Schema SYSNAME = N'${schema}';
        DECLARE @Table SYSNAME = N'${table}';
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
            @TriggerName = N'${triggerName}', @Command = @Command,
            @ErrNum = @ErrNum, @ErrMsg = @ErrMsg, @ErrLine = @ErrLine, @ErrProc = @ErrProc;
        IF XACT_STATE() = -1 THROW;
    END CATCH
END`;
}

module.exports = { buildGoldenOutput, buildCommandBlock };
