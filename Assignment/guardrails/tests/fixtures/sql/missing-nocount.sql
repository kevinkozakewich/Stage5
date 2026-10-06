CREATE OR ALTER TRIGGER [PurinaNA].[BatchCampaign_DownstreamMigration]
ON [PurinaNA].[BatchCampaign]
AFTER INSERT
AS
BEGIN
    SET XACT_ABORT OFF;
    DECLARE @Command VARCHAR(2) = 'RI';
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
        IF XACT_STATE() = -1 THROW;
    END CATCH
END
