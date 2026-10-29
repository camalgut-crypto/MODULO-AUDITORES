-- Módulo de Auditores: tablas en el proyecto Supabase de Tiempos DAC (prefijo aud_).
-- Ejecutar una vez en el SQL Editor. Requiere schema.sql de Tiempos DAC (función dac_rol y usuario "sistema").
-- No guarda historia: cada carga reemplaza toda la tabla con la ventana vigente (mes actual; del 1 al 5 también el anterior).
-- La app es abierta con el enlace: cualquiera puede leer y pedir una actualización; solo el proceso carga datos.

create table if not exists public.aud_solicitudes (
  solicitud bigint primary key,
  periodo text not null,                 -- 'YYYY-MM' del último APROBADO INFORMA
  llave text,
  estado text,
  tipo_credito text,
  categorizacion text,
  promotor text,
  fecha_aprobado_informa timestamp,      -- hora local del DWH, sin zona
  fecha_formalizado timestamp,
  usuario_formaliza text,
  fecha_digitalizado timestamp,
  usuario_digitaliza text,
  fecha_auditado timestamp,
  usuario_audita text
);
create index if not exists aud_solicitudes_periodo on public.aud_solicitudes (periodo);

create table if not exists public.aud_actualizaciones (
  id bigint generated always as identity primary key,
  solicitado_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente','procesando','ok','error')),
  iniciado_en timestamptz,
  terminado_en timestamptz,
  mensaje text
);

create table if not exists public.aud_config (
  clave text primary key,
  valor jsonb
);

alter table public.aud_solicitudes enable row level security;
alter table public.aud_actualizaciones enable row level security;
alter table public.aud_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array['aud_solicitudes','aud_actualizaciones','aud_config'] loop
    execute format('drop policy if exists leer on public.%I', t);
    execute format('create policy leer on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- Botón "Actualizar": cualquiera con el enlace puede pedirla; solo el proceso (rol sistema) la atiende
drop policy if exists pedir on public.aud_actualizaciones;
create policy pedir on public.aud_actualizaciones for insert to anon, authenticated
  with check (estado = 'pendiente' and iniciado_en is null and terminado_en is null and mensaje is null);
drop policy if exists atender on public.aud_actualizaciones;
create policy atender on public.aud_actualizaciones for update to authenticated
  using (public.dac_rol() in ('sistema','admin')) with check (true);

grant select on public.aud_solicitudes, public.aud_actualizaciones, public.aud_config to anon, authenticated;
grant insert on public.aud_actualizaciones to anon, authenticated;
grant update on public.aud_actualizaciones to authenticated;

-- Reemplaza todas las solicitudes con las de la carga y anota la hora
create or replace function public.aud_cargar(p_filas jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if coalesce(public.dac_rol(), '') not in ('sistema','admin') then
    raise exception 'Solo el proceso de carga puede actualizar los datos';
  end if;
  delete from public.aud_solicitudes where true;
  insert into public.aud_solicitudes
  select * from jsonb_populate_recordset(null::public.aud_solicitudes, p_filas);
  get diagnostics n = row_count;
  insert into public.aud_config (clave, valor) values ('ultima_actualizacion', to_jsonb(now()))
    on conflict (clave) do update set valor = excluded.valor;
  -- Las solicitudes de actualización atendidas de más de 7 días se borran
  delete from public.aud_actualizaciones where solicitado_en < now() - interval '7 days' and estado <> 'pendiente';
  return n;
end $$;
revoke execute on function public.aud_cargar(jsonb) from public, anon;
grant execute on function public.aud_cargar(jsonb) to authenticated;
