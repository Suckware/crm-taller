-- =====================================================================
-- Roles configurables y permiso de entrada por dispositivo
-- =====================================================================
-- * Roles: cada rol tiene un nombre, unas VENTANAS que ve (agenda,
--   reparaciones, clientes, almacén, facturación) y un TIPO de permisos:
--     admin   -> todo (solo el rol Administrador, no se puede cambiar)
--     oficina -> puede cambiar precios, stock, proveedores y facturar
--     taller  -> trabajo de taller; consulta el almacén, no factura
--   Los 4 roles de siempre se crean igual que funcionaban hasta hoy.
-- * Dispositivos: en cada usuario, si puede entrar desde iPhone/iPad,
--   Android, Windows u otros equipos (Mac, Linux). Lo decide la base de
--   datos con el navegador que hace la petición (cabecera User-Agent), al
--   entrar y en cada operación: si el administrador quita un dispositivo,
--   el que está conectado desde él queda fuera al momento.
-- * Facturación: además del tipo "oficina", hace falta que el rol tenga la
--   ventana Facturación (política restrictiva en las tablas de facturas).
-- * Seguridad: nadie puede cambiarse a sí mismo el rol, el acceso ni los
--   dispositivos, y siempre queda al menos un administrador activo.
-- * Todo cambio en roles y usuarios queda en el Registro de cambios.
-- Se puede ejecutar más de una vez.
-- =====================================================================

-- ---------- Roles ----------
create table if not exists public.roles (
  clave      text primary key check (clave ~ '^[a-z0-9_]{2,30}$'),
  nombre     text not null check (length(btrim(nombre)) between 2 and 40),
  nivel      text not null default 'taller' check (nivel in ('admin', 'oficina', 'taller')),
  ventanas   text[] not null default '{}',
  tecnico    boolean not null default true,   -- aparece para asignar citas y horas
  sistema    boolean not null default false,  -- de serie: no se puede borrar
  created_at timestamptz not null default now()
);
alter table public.roles drop constraint if exists roles_ventanas_validas;
alter table public.roles add constraint roles_ventanas_validas
  check (ventanas <@ array['agenda', 'rep', 'clientes', 'almacen', 'fact']::text[]);
create unique index if not exists roles_nombre_unico on public.roles (lower(nombre));
-- Número del rol (para el Registro de cambios)
alter table public.roles add column if not exists id bigint generated always as identity;
create unique index if not exists roles_id on public.roles (id);


-- Reglas de los roles que no dependen de la pantalla
create or replace function public.tg_roles_reglas()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.sistema then raise exception 'Los roles de serie no se pueden borrar'; end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.clave is distinct from old.clave then
    raise exception 'La clave del rol no se puede cambiar';
  end if;
  -- "De serie" solo lo marca la base de datos (desde la app no se puede)
  if auth.uid() is not null then
    if tg_op = 'UPDATE' then new.sistema := old.sistema; else new.sistema := false; end if;
  end if;
  -- El Administrador lo ve todo siempre (nadie se queda fuera)
  if new.clave = 'admin' then
    new.nivel := 'admin';
    new.ventanas := array['agenda','rep','clientes','almacen','fact'];
  elsif new.nivel = 'admin' then
    raise exception 'Solo el rol Administrador tiene permisos de administrador';
  end if;
  -- Facturar es cosa de oficina
  if new.nivel = 'taller' then new.ventanas := array_remove(new.ventanas, 'fact'); end if;
  select coalesce(array_agg(distinct v order by v), '{}') into new.ventanas from unnest(new.ventanas) v;
  new.nombre := btrim(new.nombre);
  return new;
end $$;
drop trigger if exists roles_reglas on public.roles;
create trigger roles_reglas before insert or update or delete on public.roles
  for each row execute function public.tg_roles_reglas();

-- Los 4 roles de siempre, con lo que veían hasta hoy
insert into public.roles (clave, nombre, nivel, ventanas, tecnico, sistema) values
  ('admin',     'Administrador', 'admin',   array['agenda','rep','clientes','almacen','fact'], true,  true),
  ('recepcion', 'Recepción',     'oficina', array['agenda','rep','clientes','almacen','fact'], true,  true),
  ('comercial', 'Comercial',     'oficina', array['agenda','rep','clientes','almacen','fact'], false, true),
  ('mecanico',  'Mecánico',      'taller',  array['agenda','rep','clientes','almacen'],        true,  true)
on conflict (clave) do nothing;

-- El rol de cada usuario pasa a ser uno de la tabla (antes, una lista fija)
alter table public.perfiles drop constraint if exists perfiles_rol_check;
alter table public.perfiles drop constraint if exists perfiles_rol_fkey;
alter table public.perfiles add constraint perfiles_rol_fkey
  foreign key (rol) references public.roles (clave) on update cascade on delete restrict;

-- ---------- Dispositivos de cada usuario ----------
alter table public.perfiles add column if not exists acceso_ios     boolean not null default true;
alter table public.perfiles add column if not exists acceso_android boolean not null default true;
alter table public.perfiles add column if not exists acceso_windows boolean not null default true;
alter table public.perfiles add column if not exists acceso_otros   boolean not null default true;

alter table public.sesiones add column if not exists plataforma text;

-- Sistema del dispositivo que hace ESTA petición, según su navegador.
-- p_pista solo se usa para distinguir un iPad (Safari dice "Macintosh").
create or replace function public.plataforma_peticion(p_pista text default '')
returns text language plpgsql stable set search_path = public as $$
declare
  v_ua text := coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', '');
begin
  if v_ua ~* '(iphone|ipad|ipod)' then return 'ios'; end if;
  if v_ua ~* 'android' then return 'android'; end if;
  if v_ua ~* 'windows' then return 'windows'; end if;
  if v_ua ~* 'macintosh' and p_pista = 'ios' then return 'ios'; end if;
  return 'otros';
end $$;

create or replace function public.plataforma_permitida(p public.perfiles, p_plataforma text)
returns boolean language sql immutable as $$
  select case p_plataforma
    when 'ios' then p.acceso_ios
    when 'android' then p.acceso_android
    when 'windows' then p.acceso_windows
    when 'otros' then p.acceso_otros
    else false end
$$;

-- La sesión vale si es la que tiene el usuario y su dispositivo sigue permitido
create or replace function public.sesion_vigente()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.sesiones s join public.perfiles p on p.id = s.user_id
    where s.user_id = auth.uid()
      and s.session_id::text = (auth.jwt() ->> 'session_id')
      and public.plataforma_permitida(p, coalesce(s.plataforma, public.plataforma_peticion()))
  )
$$;

-- Tipo de permisos del usuario conectado
create or replace function public.mi_nivel()
returns text language sql stable security definer set search_path = public as $$
  select r.nivel from public.perfiles p join public.roles r on r.clave = p.rol
  where p.id = auth.uid() and p.activo and public.sesion_vigente()
$$;
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_nivel() = 'admin', false)
$$;
create or replace function public.es_oficina()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.mi_nivel() in ('admin', 'oficina'), false)
$$;
-- ¿El rol del usuario conectado tiene esta ventana?
create or replace function public.puede_ventana(p_ventana text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.nivel = 'admin' or p_ventana = any (r.ventanas)
    from public.perfiles p join public.roles r on r.clave = p.rol
    where p.id = auth.uid() and p.activo and public.sesion_vigente()
  ), false)
$$;

-- Entrar: además de "una sola sesión", se mira el dispositivo
create or replace function public.reclamar_sesion(p_dispositivo text default '', p_pista text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sid uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_s public.sesiones;
  v_p public.perfiles;
  v_pl text := public.plataforma_peticion(p_pista);
begin
  if auth.uid() is null or v_sid is null then
    raise exception 'Sin sesión';
  end if;
  select * into v_p from perfiles where id = auth.uid() and activo;
  if not found then
    raise exception 'Este usuario no tiene acceso al taller';
  end if;
  if not public.plataforma_permitida(v_p, v_pl) then
    delete from public.sesiones where user_id = auth.uid() and session_id = v_sid;
    return jsonb_build_object('estado', 'dispositivo', 'plataforma', v_pl);
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
  insert into public.sesiones (user_id, session_id, dispositivo, plataforma, desde, ultimo)
  values (auth.uid(), v_sid, left(coalesce(p_dispositivo, ''), 80), v_pl, now(), now())
  on conflict (user_id) do update
    set session_id = excluded.session_id, dispositivo = excluded.dispositivo, plataforma = excluded.plataforma,
        desde = excluded.desde, ultimo = excluded.ultimo;
  return jsonb_build_object('estado', 'ok');
end $$;

create or replace function public.latido_sesion(p_dispositivo text default '', p_pista text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  update public.sesiones s set ultimo = now()
  from public.perfiles p
  where s.user_id = auth.uid() and p.id = s.user_id and p.activo
    and s.session_id::text = (auth.jwt() ->> 'session_id')
    and public.plataforma_permitida(p, coalesce(s.plataforma, public.plataforma_peticion(p_pista)));
  if found then return jsonb_build_object('estado', 'ok'); end if;
  return public.reclamar_sesion(p_dispositivo, p_pista);
end $$;

-- Las versiones antiguas (un solo parámetro) se quitan para que no queden dos
drop function if exists public.reclamar_sesion(text);
drop function if exists public.latido_sesion(text);

revoke all on function public.reclamar_sesion(text, text) from public, anon;
revoke all on function public.latido_sesion(text, text) from public, anon;
grant execute on function public.reclamar_sesion(text, text) to authenticated;
grant execute on function public.latido_sesion(text, text) to authenticated;
revoke all on function public.plataforma_peticion(text) from public, anon;
revoke all on function public.mi_nivel() from public, anon;
revoke all on function public.puede_ventana(text) from public, anon;
grant execute on function public.plataforma_peticion(text), public.mi_nivel(), public.puede_ventana(text) to authenticated;
revoke all on function public.tg_roles_reglas() from public, anon, authenticated;

-- ---------- Nadie se cambia a sí mismo los permisos; siempre hay un administrador ----------
create or replace function public.tg_perfiles_protege()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and tg_op = 'UPDATE' and new.id = auth.uid() and (
       new.rol is distinct from old.rol or new.activo is distinct from old.activo
    or new.acceso_ios is distinct from old.acceso_ios or new.acceso_android is distinct from old.acceso_android
    or new.acceso_windows is distinct from old.acceso_windows or new.acceso_otros is distinct from old.acceso_otros) then
    raise exception 'No puedes cambiar tu propio rol, acceso ni dispositivos. Pídeselo a otro administrador.';
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.rol = 'admin' and old.activo
     and (tg_op = 'DELETE' or new.rol <> 'admin' or not new.activo)
     and not exists (select 1 from public.perfiles x where x.rol = 'admin' and x.activo and x.id <> old.id) then
    raise exception 'Tiene que quedar al menos un administrador activo';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists perfiles_protege on public.perfiles;
create trigger perfiles_protege before update or delete on public.perfiles
  for each row execute function public.tg_perfiles_protege();
revoke all on function public.tg_perfiles_protege() from public, anon, authenticated;

-- ---------- Permisos de la tabla de roles ----------
alter table public.roles enable row level security;
revoke all on public.roles from anon;
grant select, insert, update, delete on public.roles to authenticated;
drop policy if exists personal_lee on public.roles;
drop policy if exists admin_crea on public.roles;
drop policy if exists admin_edita on public.roles;
drop policy if exists admin_borra on public.roles;
create policy personal_lee on public.roles for select to authenticated using ((select public.es_personal()));
create policy admin_crea on public.roles for insert to authenticated with check ((select public.es_admin()));
create policy admin_edita on public.roles for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy admin_borra on public.roles for delete to authenticated using ((select public.es_admin()));

-- ---------- Facturación: hace falta la ventana Facturación en el rol ----------
do $$
declare t text;
begin
  foreach t in array array['facturas', 'factura_lineas', 'factura_reparaciones', 'remesas', 'remesa_recibos'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists ventana_facturacion on public.%I', t);
    execute format('create policy ventana_facturacion on public.%I as restrictive for all to authenticated
                      using ((select public.puede_ventana(''fact''))) with check ((select public.puede_ventana(''fact'')))', t);
  end loop;
end $$;

-- ---------- Registro de cambios ----------
create or replace trigger registro_cambios after insert or update or delete on public.roles
  for each row execute function public.tg_registro_cambios('created_at', '', '', '');
