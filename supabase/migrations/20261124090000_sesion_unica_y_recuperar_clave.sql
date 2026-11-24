-- =====================================================================
-- CRM taller · Una sola sesión por usuario + recuperar la contraseña
-- =====================================================================
-- Sesión única (manda el primero que entró)
-- * public.sesiones guarda, por usuario, la sesión que vale ahora mismo
--   (session_id del token de Supabase Auth), desde qué dispositivo y cuándo
--   dio la última señal de vida (la app la da cada minuto mientras está abierta).
-- * Si alguien intenta entrar con un usuario que ya está abierto en otro
--   dispositivo, NO se le deja entrar: se le dice en qué dispositivo está
--   abierto. Al que ya estaba dentro no se le echa nunca.
-- * Sesiones colgadas (se apagó el equipo, se cerró el navegador sin salir):
--   pasados 10 minutos sin señal de vida, la siguiente entrada puede ocuparla.
--   Además el administrador puede cerrar la sesión de cualquiera desde
--   Configuración > Usuarios. Al pulsar "Cerrar sesión" se libera al momento.
-- * Se comprueba en la base de datos, no solo en pantalla: mi_rol() y
--   es_personal() (de las que dependen todas las políticas RLS) solo dan
--   permiso a la sesión vigente.
--
-- Recuperar la contraseña
-- * public.usuarios_correo: el correo real de cada persona (los usuarios
--   entran con un correo interno que no existe). Lo ve y cambia el
--   administrador; cada persona ve y cambia el suyo. El resto, nada.
-- * privado.recuperaciones: intentos de "He olvidado mi contraseña", para
--   limitar abusos (3 por usuario y 10 por IP cada hora).
-- * recuperacion_destino(): solo la Edge Function "recuperar-clave" (clave
--   de servicio) la usa para saber a qué correo mandar el enlace.
-- =====================================================================

-- ---------- Sesión única ----------
create table if not exists public.sesiones (
  user_id uuid primary key references auth.users (id) on delete cascade,
  session_id uuid not null,
  dispositivo text not null default '',
  desde timestamptz not null default now(),
  ultimo timestamptz not null default now()
);
alter table public.sesiones enable row level security;
revoke all on public.sesiones from public, anon, authenticated;
-- Nadie la lee ni escribe directamente: solo a través de las funciones de abajo.

-- Minutos sin señal de vida para dar una sesión por abandonada
create or replace function public.sesion_minutos_caducidad()
returns int language sql immutable as $$ select 10 $$;

-- Esta petición viene de la sesión que tiene el usuario ocupado.
create or replace function public.sesion_vigente()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.sesiones s
    where s.user_id = auth.uid()
      and s.session_id::text = (auth.jwt() ->> 'session_id')
  )
$$;

create or replace function public.mi_rol()
returns text
language sql stable security definer set search_path = public
as $$
  select rol from perfiles where id = auth.uid() and activo and public.sesion_vigente()
$$;

create or replace function public.es_personal()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from perfiles where id = auth.uid() and activo) and public.sesion_vigente()
$$;

-- Ocupar el usuario con esta sesión. Devuelve:
--   {estado:'ok'}                                -> adelante
--   {estado:'ocupada', dispositivo, ultimo}      -> abierto en otro dispositivo; no se entra
--   {estado:'cerrada'}                           -> esta sesión ya no existe (la cerró el administrador)
create or replace function public.reclamar_sesion(p_dispositivo text default '')
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_s public.sesiones;
begin
  if auth.uid() is null or v_sid is null then
    raise exception 'Sin sesión';
  end if;
  if not exists (select 1 from perfiles where id = auth.uid() and activo) then
    raise exception 'Este usuario no tiene acceso al taller';
  end if;
  if not exists (select 1 from auth.sessions where id = v_sid and user_id = auth.uid()) then
    return jsonb_build_object('estado', 'cerrada');
  end if;
  select * into v_s from public.sesiones where user_id = auth.uid() for update;
  if found and v_s.session_id <> v_sid
     and v_s.ultimo > now() - make_interval(mins => public.sesion_minutos_caducidad())
     and exists (select 1 from auth.sessions where id = v_s.session_id) then
    return jsonb_build_object('estado', 'ocupada', 'dispositivo', v_s.dispositivo, 'ultimo', v_s.ultimo);
  end if;
  insert into public.sesiones (user_id, session_id, dispositivo, desde, ultimo)
  values (auth.uid(), v_sid, left(coalesce(p_dispositivo, ''), 80), now(), now())
  on conflict (user_id) do update
    set session_id = excluded.session_id, dispositivo = excluded.dispositivo, desde = excluded.desde, ultimo = excluded.ultimo;
  return jsonb_build_object('estado', 'ok');
end;
$$;

-- Señal de vida de la sesión que tiene el usuario. Si ya no es la buena,
-- intenta ocuparlo otra vez (por si quedó libre) y devuelve lo mismo que reclamar_sesion.
create or replace function public.latido_sesion(p_dispositivo text default '')
returns jsonb
language plpgsql volatile security definer set search_path = public
as $$
begin
  update public.sesiones set ultimo = now()
  where user_id = auth.uid() and session_id::text = (auth.jwt() ->> 'session_id');
  if found then return jsonb_build_object('estado', 'ok'); end if;
  return public.reclamar_sesion(p_dispositivo);
end;
$$;

-- Al pulsar "Cerrar sesión": el usuario queda libre al momento.
create or replace function public.liberar_sesion()
returns void
language sql volatile security definer set search_path = public
as $$
  delete from public.sesiones where user_id = auth.uid() and session_id::text = (auth.jwt() ->> 'session_id')
$$;

-- Administrador: ver quién está conectado y desde dónde.
create or replace function public.sesiones_abiertas()
returns table (user_id uuid, dispositivo text, desde timestamptz, ultimo timestamptz, activa boolean)
language sql stable security definer set search_path = public
as $$
  select s.user_id, s.dispositivo, s.desde, s.ultimo,
         s.ultimo > now() - make_interval(mins => public.sesion_minutos_caducidad())
  from public.sesiones s
  where public.es_admin()
$$;

-- Administrador: cerrar la sesión de otra persona (equipo perdido, sesión colgada).
-- Se borra también la sesión de Supabase Auth, así ese dispositivo no puede volver a ocuparla.
create or replace function public.cerrar_sesion_de(p_user uuid)
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare v_sid uuid;
begin
  if not public.es_admin() then raise exception 'Solo el administrador'; end if;
  if p_user = auth.uid() then raise exception 'No puedes cerrar tu propia sesión desde aquí'; end if;
  delete from public.sesiones where user_id = p_user returning session_id into v_sid;
  if v_sid is not null then delete from auth.sessions where id = v_sid; end if;
end;
$$;

revoke all on function public.sesion_vigente() from public, anon;
revoke all on function public.reclamar_sesion(text) from public, anon;
revoke all on function public.latido_sesion(text) from public, anon;
revoke all on function public.liberar_sesion() from public, anon;
revoke all on function public.sesiones_abiertas() from public, anon;
revoke all on function public.cerrar_sesion_de(uuid) from public, anon;
grant execute on function public.sesion_vigente() to authenticated;
grant execute on function public.reclamar_sesion(text) to authenticated;
grant execute on function public.latido_sesion(text) to authenticated;
grant execute on function public.liberar_sesion() to authenticated;
grant execute on function public.sesiones_abiertas() to authenticated;
grant execute on function public.cerrar_sesion_de(uuid) to authenticated;

-- ---------- Correo para recuperar la contraseña ----------
create table if not exists public.usuarios_correo (
  user_id uuid primary key references public.perfiles (id) on delete cascade,
  correo text not null check (correo ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(correo) <= 120)
);
alter table public.usuarios_correo enable row level security;
revoke all on public.usuarios_correo from public, anon, authenticated;
grant select, insert, update, delete on public.usuarios_correo to authenticated;

create policy correo_ver on public.usuarios_correo for select to authenticated
  using (public.es_admin() or (user_id = auth.uid() and public.es_personal()));
create policy correo_alta on public.usuarios_correo for insert to authenticated
  with check (public.es_admin() or (user_id = auth.uid() and public.es_personal()));
create policy correo_cambia on public.usuarios_correo for update to authenticated
  using (public.es_admin() or (user_id = auth.uid() and public.es_personal()))
  with check (public.es_admin() or (user_id = auth.uid() and public.es_personal()));
create policy correo_borra on public.usuarios_correo for delete to authenticated
  using (public.es_admin());

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table if not exists privado.recuperaciones (
  id bigserial primary key,
  usuario text not null,
  ip text not null default '',
  creado timestamptz not null default now()
);
create index if not exists recuperaciones_creado on privado.recuperaciones (creado);
alter table privado.recuperaciones enable row level security;
alter table privado.recuperaciones force row level security;
revoke all on privado.recuperaciones from public, anon, authenticated;

-- Apunta el intento y, si no se pasa del límite y el usuario está activo y
-- tiene correo, devuelve a quién escribir. Si no, no devuelve nada (la Edge
-- Function contesta siempre lo mismo para no revelar qué usuarios existen).
create or replace function public.recuperacion_destino(p_usuario text, p_ip text)
returns table (user_id uuid, correo text, nombre text)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_u text := lower(trim(coalesce(p_usuario, '')));
  v_ip text := left(coalesce(p_ip, ''), 64);
begin
  delete from privado.recuperaciones where creado < now() - interval '1 day';
  if (select count(*) from privado.recuperaciones where usuario = v_u and creado > now() - interval '1 hour') >= 3
     or (v_ip <> '' and (select count(*) from privado.recuperaciones where ip = v_ip and creado > now() - interval '1 hour') >= 10) then
    return;
  end if;
  insert into privado.recuperaciones (usuario, ip) values (v_u, v_ip);
  return query
    select p.id, c.correo, p.nombre
    from perfiles p join public.usuarios_correo c on c.user_id = p.id
    where lower(p.usuario) = v_u and p.activo;
end;
$$;
revoke all on function public.recuperacion_destino(text, text) from public, anon, authenticated;
grant execute on function public.recuperacion_destino(text, text) to service_role;
