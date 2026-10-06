CREATE OR ALTER TRIGGER [PurinaNA].[BatchCampaign_DownstreamMigration]
ON [PurinaNA].[BatchCampaign]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;

    DECLARE @Command varchar(2) = 'RI';

    BEGIN TRY
        DECLARE @Schema sysname = N'PurinaNA',
                @Table sysname = N'BatchCampaign',
                @Sql nvarchar(max);

        DECLARE @TableName sysname = @Table;

        EXEC [PurinaNA].[ToGpmq_EnqueueRecordByTriggerPrep]
            @Schema, @TableName, @Command, @Sql OUTPUT;

        EXEC sys.sp_executesql
            @Sql,
            N'@TableName sysname, @Command varchar(2)',
            @TableName = @TableName,
            @Command = @Command;
    END TRY
    BEGIN CATCH
        DECLARE @ErrorNumber int = ERROR_NUMBER(),
                @ErrorMessage nvarchar(4000) = ERROR_MESSAGE(),
                @ErrorLine int = ERROR_LINE(),
                @ErrorProcedure nvarchar(128) = ERROR_PROCEDURE();

        DECLARE @TriggerName nvarchar(517) =
            QUOTENAME(OBJECT_SCHEMA_NAME(@@PROCID)) + N'.' +
            QUOTENAME(OBJECT_NAME(@@PROCID));

        EXEC [PurinaNA].[ToGpmq_LogTriggerError]
            @TriggerName,
            @Command,
            @ErrorNumber,
            @ErrorMessage,
            @ErrorLine,
            @ErrorProcedure;

        IF XACT_STATE() = -1
            THROW;
    END CATCH;
END;
