-- =====================================================================
-- CRM taller · Una sola sesión por usuario + recuperar la contraseña
-- =====================================================================
-- Sesión única
-- * public.sesiones guarda, por usuario, la sesión que vale ahora mismo
--   (session_id del token de Supabase Auth) y desde qué dispositivo.
-- * Al entrar con usuario y contraseña la app llama a reclamar_sesion():
--   esa sesión pasa a ser la buena y la del otro dispositivo deja de valer.
-- * Se comprueba en la base de datos, no solo en pantalla: mi_rol() y
--   es_personal() (de las que dependen todas las políticas RLS) solo dan
--   permiso a la sesión vigente. El otro dispositivo deja de ver datos al
--   instante y la app le muestra el aviso.
-- * Si un usuario aún no tiene fila (las sesiones abiertas antes de este
--   cambio) se le deja pasar hasta que reclame una.
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
  desde timestamptz not null default now()
);
alter table public.sesiones enable row level security;
revoke all on public.sesiones from public, anon, authenticated;
-- Nadie la lee ni escribe directamente: solo a través de las funciones de abajo.

create or replace function public.sesion_vigente()
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from public.sesiones s
    where s.user_id = auth.uid()
      and s.session_id::text is distinct from (auth.jwt() ->> 'session_id')
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

-- La sesión con la que se acaba de entrar pasa a ser la única válida.
create or replace function public.reclamar_sesion(p_dispositivo text default '')
returns void
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
begin
  if auth.uid() is null or v_sid is null then
    raise exception 'Sin sesión';
  end if;
  if not exists (select 1 from perfiles where id = auth.uid() and activo) then
    raise exception 'Este usuario no tiene acceso al taller';
  end if;
  insert into public.sesiones (user_id, session_id, dispositivo, desde)
  values (auth.uid(), v_sid, left(coalesce(p_dispositivo, ''), 80), now())
  on conflict (user_id) do update
    set session_id = excluded.session_id, dispositivo = excluded.dispositivo, desde = excluded.desde;
end;
$$;

-- Para la app: 'ok' (esta sesión vale), 'libre' (aún no hay ninguna reclamada)
-- u 'otra' (el usuario ha entrado desde otro dispositivo, que se indica).
create or replace function public.sesion_estado()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case
    when s.user_id is null then jsonb_build_object('estado', 'libre')
    when s.session_id::text = (auth.jwt() ->> 'session_id') then jsonb_build_object('estado', 'ok')
    else jsonb_build_object('estado', 'otra', 'dispositivo', s.dispositivo, 'desde', s.desde)
  end
  from (select auth.uid() as uid) u
  left join public.sesiones s on s.user_id = u.uid
  where u.uid is not null
$$;

revoke all on function public.sesion_vigente() from public, anon;
revoke all on function public.reclamar_sesion(text) from public, anon;
revoke all on function public.sesion_estado() from public, anon;
grant execute on function public.sesion_vigente() to authenticated;
grant execute on function public.reclamar_sesion(text) to authenticated;
grant execute on function public.sesion_estado() to authenticated;

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
