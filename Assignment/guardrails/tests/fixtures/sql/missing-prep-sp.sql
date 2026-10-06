CREATE OR ALTER TRIGGER [PurinaNA].[BatchCampaign_DownstreamMigration]
ON [PurinaNA].[BatchCampaign]
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT OFF;
    DECLARE @Command VARCHAR(2) = 'RI';
    BEGIN TRY
        DECLARE @Sql NVARCHAR(MAX) = N'SELECT 1';
        EXEC sp_executesql @Sql;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() = -1 THROW;
    END CATCH
END
