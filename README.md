# Módulo de Auditores

Vista en línea de las solicitudes aprobadas por Informa (Nicaragua) y su avance hasta la auditoría:
**Por auditar** (estado actual distinto de AUDITADO) y **Auditadas** (con fecha y usuario de auditoría).

- App: https://camalgut-crypto.github.io/MODULO-AUDITORES/ (abierta con el enlace)
- Datos: Supabase de Tiempos DAC (`lzgteejsjxrbadsqlpnd`), tablas `aud_*`. No guarda historia: cada carga reemplaza la tabla.

## Reglas

- Tabla principal: `Consulta Solicitudes Aprobadas Informa.sql`; fechas y usuarios: `Consultas Estados.sql`.
  El worker usa copias en `worker/sql/` con la ventana de meses parametrizada (los originales no se tocan).
- Mes de una solicitud: el de su último APROBADO INFORMA dentro de la ventana.
- Ventana: el mes en curso; **del 1 al 5 de cada mes también el mes anterior**, y la app abre ese mes por defecto.
  Desde el día 6 el mes anterior deja de cargarse.
- Si una solicitud tiene varios registros del mismo estado se toma **el último** (fecha y usuario).

## Actualización

El DWH (`SRV-TORTUGUERO\DATAWAREHOUSE`, IP privada 10.160.252.82) solo se alcanza desde la red interna, así que un
proceso en una PC de la red lee el DWH con el usuario SQL y sube los datos. Atiende el botón **Actualizar** y actualiza
solo cada hora (`cada_minutos` en `worker/config.toml`).

- `Ejecutar actualizacion.bat` → `worker/actualizar.py --escuchar` (tarea programada "Modulo Auditores - Actualizacion").
- `worker/actualizar.py --una-vez` actualiza una vez; `--local` genera `public/local/datos.json` (abrir la app con `?local`).
- Credenciales: SQL en keyring `modulo_garantias_sql`; Supabase con el usuario `sistema` de Tiempos DAC (keyring `tiempos_dac_supabase`).

Para no depender de esta PC basta con copiar la carpeta a un servidor de la red, crear la `.venv`
(`py -m venv .venv` y `pip install pandas pyodbc keyring requests`), guardar las dos credenciales y crear la tarea ahí.

## Puesta en marcha

1. Ejecutar `supabase/schema.sql` en el SQL Editor del proyecto de Tiempos DAC.
2. `worker/actualizar.py --una-vez` para la primera carga.
3. Crear la tarea programada que ejecuta `Ejecutar actualizacion.bat` al iniciar sesión.
