-- "Consultas Estados.sql" (Aprobado Informa, Formalizado, Expediente Digitalizado y Auditado) en una sola lectura,
-- con la misma ventana de meses que principal.sql. El worker toma el último registro de cada estado por solicitud;
-- para APROBADO INFORMA solo cuentan los de la ventana, como en la consulta original.
SET NOCOUNT ON;
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @inicio_mes date = DATEFROMPARTS(YEAR(@hoy), MONTH(@hoy), 1);
DECLARE @desde date = CASE WHEN DAY(@hoy) <= 5 THEN DATEADD(MONTH, -1, @inicio_mes) ELSE @inicio_mes END;
DECLARE @hasta date = DATEADD(MONTH, 1, @inicio_mes);

SELECT
    H.[SOLICITUD],
    H.[ESTADO],
    H.[FECHA MODIFICACION],
    H.[USUARIO MODIFICA],
    @desde AS [DESDE],
    @hasta AS [HASTA]
FROM dwh.vw_historico_solicitud_pais AS H
WHERE H.ID_PAIS = 2
    AND H.ESTADO IN ('APROBADO INFORMA', 'FORMALIZADO', 'EXPEDIENTE DIGITALIZADO', 'AUDITADO')
    AND EXISTS (
        SELECT 1
        FROM dwh.vw_historico_solicitud_pais AS A
        WHERE A.ID_PAIS = H.ID_PAIS
            AND A.SOLICITUD = H.SOLICITUD
            AND A.ESTADO = 'APROBADO INFORMA'
            AND A.[FECHA MODIFICACION] >= @desde
            AND A.[FECHA MODIFICACION] < @hasta
    )
ORDER BY H.[FECHA CREACION], H.[FECHA MODIFICACION];
