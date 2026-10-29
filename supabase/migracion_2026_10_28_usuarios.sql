-- Módulo de Auditores con usuarios (28-oct). Ejecutar una vez en el SQL Editor, después de schema.sql.
-- Perfiles propios del módulo (aud_perfiles), separados de Tiempos DAC: un auditor entra solo aquí.
-- Quien ya tiene usuario en Tiempos DAC (jefas, gerente, administrador) entra con la misma clave.
-- Roles: admin (administra todos los usuarios), jefe (Jefe DAC; solo puede crear auditores), gerente (Gerente DAC), auditor.
-- Todos ven todo y pueden actualizar.

create table if not exists public.aud_perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  usuario text not null unique,          -- "hilcia.paola.morales.mendez" (correo interno usuario@tiemposdac.local)
  nombre text not null,
  rol text not null check (rol in ('admin','jefe','gerente','auditor')),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.aud_rol() returns text
language sql stable security definer set search_path = public as $$
  select rol from public.aud_perfiles where id = auth.uid() and activo
$$;
create or replace function public.aud_es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.aud_rol() = 'admin', false)
$$;

-- Usuarios iniciales, tomados de Tiempos DAC
insert into public.aud_perfiles (id, usuario, nombre, rol)
select id, usuario, nombre,
       case usuario when 'carlos.manuel.alvarez.gutierrez' then 'admin'
                    when 'karen.maritza.arana.melendez' then 'gerente'
                    else 'jefe' end
from public.dac_perfiles
where usuario in ('carlos.manuel.alvarez.gutierrez', 'hilcia.paola.morales.mendez',
                  'katherine.gissell.mora.garcia', 'karen.maritza.arana.melendez')
on conflict (id) do nothing;

-- ---------- Seguridad: la app deja de ser abierta ----------
alter table public.aud_perfiles enable row level security;
drop policy if exists leer on public.aud_perfiles;
create policy leer on public.aud_perfiles for select to authenticated using (id = auth.uid() or public.aud_rol() in ('admin','jefe'));

do $$
declare t text;
begin
  foreach t in array array['aud_solicitudes','aud_actualizaciones','aud_config'] loop
    execute format('drop policy if exists leer on public.%I', t);
    -- el proceso de carga (usuario sistema de Tiempos DAC) también lee las solicitudes de actualización
    execute format('create policy leer on public.%I for select to authenticated using (public.aud_rol() is not null or public.dac_rol() = ''sistema'')', t);
  end loop;
end $$;

alter table public.aud_actualizaciones add column if not exists solicitado_nombre text;
drop policy if exists pedir on public.aud_actualizaciones;
create policy pedir on public.aud_actualizaciones for insert to authenticated
  with check (public.aud_rol() is not null and estado = 'pendiente' and iniciado_en is null and terminado_en is null and mensaje is null);

revoke all on public.aud_solicitudes, public.aud_actualizaciones, public.aud_config, public.aud_perfiles from anon;
grant select on public.aud_perfiles to authenticated;

-- ---------- Administración de usuarios (admin; las jefas DAC solo crean auditores) ----------
-- Si la persona ya tiene usuario (p. ej. de Tiempos DAC) solo se le da acceso al módulo; si no, se crea con la clave dada.
create or replace function public.aud_crear_usuario(p_usuario text, p_nombre text, p_rol text, p_password text)
returns uuid language plpgsql security definer set search_path = public, extensions as $$
declare uid uuid; u text := lower(trim(p_usuario)); correo text := lower(trim(p_usuario)) || '@tiemposdac.local';
begin
  if not (public.aud_es_admin() or public.dac_es_sql() or (public.aud_rol() = 'jefe' and p_rol = 'auditor')) then
    raise exception 'Solo el administrador puede crear este usuario (las jefas DAC crean auditores)';
  end if;
  if u !~ '^[a-z0-9._-]+$' then raise exception 'Usuario inválido'; end if;
  if p_rol not in ('admin','jefe','gerente','auditor') then raise exception 'Rol inválido'; end if;
  if exists (select 1 from public.aud_perfiles where usuario = u) then raise exception 'Ese usuario ya existe'; end if;
  select id into uid from auth.users where email = correo;
  if uid is null then
    if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
    uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', uid, 'authenticated', 'authenticated', correo,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}', jsonb_build_object('nombre', p_nombre), now(), now(), '', '', '', '');
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (uid::text, uid, jsonb_build_object('sub', uid::text, 'email', correo, 'email_verified', true), 'email', now(), now(), now());
  end if;
  insert into public.aud_perfiles (id, usuario, nombre, rol) values (uid, u, trim(p_nombre), p_rol);
  return uid;
end $$;

create or replace function public.aud_editar_usuario(p_id uuid, p_rol text, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.aud_es_admin() then raise exception 'Solo el administrador puede editar usuarios'; end if;
  if p_rol not in ('admin','jefe','gerente','auditor') then raise exception 'Rol inválido'; end if;
  if p_id = auth.uid() and (p_rol <> 'admin' or not p_activo) then raise exception 'No puede quitarse a sí mismo el rol de administrador'; end if;
  update public.aud_perfiles set rol = p_rol, activo = p_activo where id = p_id;
end $$;

-- Solo para usuarios exclusivos del módulo: la clave de quien también usa Tiempos DAC se administra allá
create or replace function public.aud_restablecer_clave(p_id uuid, p_password text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.aud_es_admin() then raise exception 'Solo el administrador puede restablecer contraseñas'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'La contraseña debe tener al menos 8 caracteres'; end if;
  if exists (select 1 from public.dac_perfiles where id = p_id) then
    raise exception 'Este usuario también entra a Tiempos DAC: su contraseña se restablece desde Tiempos DAC';
  end if;
  update auth.users set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at = now()
  where id = p_id and id in (select id from public.aud_perfiles);
end $$;

revoke execute on function public.aud_crear_usuario(text, text, text, text), public.aud_editar_usuario(uuid, text, boolean),
  public.aud_restablecer_clave(uuid, text) from public, anon;
grant execute on function public.aud_crear_usuario(text, text, text, text), public.aud_editar_usuario(uuid, text, boolean),
  public.aud_restablecer_clave(uuid, text) to authenticated;

-- Debe mostrar 4 filas: el administrador, las dos jefas y la gerente
select usuario, nombre, rol from public.aud_perfiles order by rol, nombre;
