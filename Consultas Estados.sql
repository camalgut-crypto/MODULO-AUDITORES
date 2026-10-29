'''Consulta Aprobado Informa'''
SELECT *
FROM dwh.vw_historico_solicitud_pais
WHERE ID_PAIS = 2
    AND ESTADO = 'APROBADO INFORMA'
    AND [FECHA MODIFICACION] >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
    AND [FECHA MODIFICACION] < DATEADD(
        MONTH, 1,
        DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
    )
ORDER BY [FECHA CREACION], [FECHA MODIFICACION];
'''Consulta Formalizado'''
SELECT H.*
FROM dwh.vw_historico_solicitud_pais AS H
WHERE H.ID_PAIS = 2
    AND H.ESTADO = 'FORMALIZADO'
    AND EXISTS (
        SELECT 1
        FROM dwh.vw_historico_solicitud_pais AS A
        WHERE A.ID_PAIS = H.ID_PAIS
            AND A.SOLICITUD = H.SOLICITUD
            AND A.ESTADO = 'APROBADO INFORMA'
            AND A.[FECHA MODIFICACION] >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            AND A.[FECHA MODIFICACION] < DATEADD(
                MONTH, 1,
                DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            )
    )
ORDER BY H.[FECHA CREACION], H.[FECHA MODIFICACION];
'''Consulta Expediente Digitalizado'''
SELECT H.*
FROM dwh.vw_historico_solicitud_pais AS H
WHERE H.ID_PAIS = 2
    AND H.ESTADO = 'EXPEDIENTE DIGITALIZADO'
    AND EXISTS (
        SELECT 1
        FROM dwh.vw_historico_solicitud_pais AS A
        WHERE A.ID_PAIS = H.ID_PAIS
            AND A.SOLICITUD = H.SOLICITUD
            AND A.ESTADO = 'APROBADO INFORMA'
            AND A.[FECHA MODIFICACION] >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            AND A.[FECHA MODIFICACION] < DATEADD(
                MONTH, 1,
                DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            )
    )
ORDER BY H.[FECHA CREACION], H.[FECHA MODIFICACION];
'''Consulta Auditado'''
SELECT H.*
FROM dwh.vw_historico_solicitud_pais AS H
WHERE H.ID_PAIS = 2
    AND H.ESTADO = 'AUDITADO'
    AND EXISTS (
        SELECT 1
        FROM dwh.vw_historico_solicitud_pais AS A
        WHERE A.ID_PAIS = H.ID_PAIS
            AND A.SOLICITUD = H.SOLICITUD
            AND A.ESTADO = 'APROBADO INFORMA'
            AND A.[FECHA MODIFICACION] >= DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            AND A.[FECHA MODIFICACION] < DATEADD(
                MONTH, 1,
                DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1)
            )
    )
ORDER BY H.[FECHA CREACION], H.[FECHA MODIFICACION];