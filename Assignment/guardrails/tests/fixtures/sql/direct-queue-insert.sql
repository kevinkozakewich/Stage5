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
            (SchemaName, TableName, Command, PayloadJson, CreatedUtc)
        SELECT N'PurinaNA', N'CampaignMember', @Command, NULL, SYSUTCDATETIME()
        FROM inserted;
    END TRY
    BEGIN CATCH
        IF XACT_STATE() = -1 THROW;
    END CATCH
END
