-- Tabla principal: "Consulta Solicitudes Aprobadas Informa.sql" con la ventana de meses del módulo.
-- Del 1 al 5 de cada mes también trae el mes anterior (APROBADO INFORMA en ese mes).
SET NOCOUNT ON;
DECLARE @hoy date = CAST(GETDATE() AS date);
DECLARE @inicio_mes date = DATEFROMPARTS(YEAR(@hoy), MONTH(@hoy), 1);
DECLARE @desde date = CASE WHEN DAY(@hoy) <= 5 THEN DATEADD(MONTH, -1, @inicio_mes) ELSE @inicio_mes END;
DECLARE @hasta date = DATEADD(MONTH, 1, @inicio_mes);

WITH Historico AS (
    SELECT DISTINCT
        [SOLICITUD]
    FROM [GENESIS_REGIONAL].[dwh].[vw_historico_solicitud_pais]
    WHERE ESTADO = 'APROBADO INFORMA'
      AND ID_PAIS = 2
      AND [FECHA MODIFICACION] >= @desde
      AND [FECHA MODIFICACION] < @hasta
),
Colocaciones AS (
    SELECT
        B.[Num_Solicitud],
        CONCAT(B.[Comprobante], '_', B.[Consecutivo]) AS [Llave],
        B.[Tipo_Credito],
        B.[Promotor],
        B.[Estado],
        B.[Categorizacion],
        ROW_NUMBER() OVER (
            PARTITION BY B.[Num_Solicitud]
            ORDER BY B.[Num_Solicitud]
        ) AS RN
    FROM [GENESIS_REGIONAL].[dwh].[V_BIT_REGIONAL_COLOCACION_new] AS B
    INNER JOIN Historico AS H
        ON B.[Num_Solicitud] = H.[SOLICITUD]
    WHERE B.IdPais = 2
      AND B.[Estado] IN (
          'AUDITADO',
          'APROBADO INFORMA',
          'EXPEDIENTE COMPLETO',
          'EXPEDIENTE INCOMPLETO',
          'EXPEDIENTE CORREGIDO ASESOR',
          'EXPEDIENTE DIGITALIZADO',
          'EXPEDIENTE INSCRIPCIÓN PRENDARIA',
          'REVISADO',
          'FORMALIZADO'
      )
)
SELECT
    [Num_Solicitud],
    [Llave],
    [Tipo_Credito],
    [Promotor],
    [Estado],
    [Categorizacion]
FROM Colocaciones
WHERE RN = 1;
