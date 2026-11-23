-- =====================================================================
-- CRM taller · Licencia desde la consola de proveedor (nube del TPV)
-- =====================================================================
-- * public.licencia (una sola fila): lo último que dijo la consola.
--   Todo el personal la lee; nadie la escribe salvo el servidor (Edge Function
--   "licencia" con la clave de servicio).
-- * privado.licencia_token: el token del CRM ante la consola. Esquema no
--   publicado en la API; solo lo leen funciones que exigen la clave de servicio.
-- * Mientras no se active ninguna licencia (controlada = false) el CRM
--   funciona sin límites, como hasta ahora.
-- * Con licencia: módulos y número de usuarios se comprueban en la base de
--   datos (disparadores), no solo en pantalla. Caducada (pasados los días de
--   gracia), bloqueada o sin hablar con la consola más de esos días = modo
--   consulta: se ve todo pero no se crea ni se cambia nada.
-- =====================================================================

create table public.licencia (
  id int primary key default 1 check (id = 1),
  controlada boolean not null default false,
  cliente text not null default '',
  tipo text not null default '',
  empieza date,
  termina date,
  dias_gracia int not null default 15,
  bloqueada boolean not null default false,
  max_usuarios int,             -- null = sin límite
  max_sedes int not null default 1,
  modulos text[] not null default '{}',
  activada_en timestamptz,
  ultima_consulta timestamptz,
  ultima_ok timestamptz,
  ultimo_error text not null default ''
);
insert into public.licencia (id) values (1);
alter table public.licencia enable row level security;
alter table public.licencia force row level security;
revoke all on public.licencia from anon, authenticated;
grant select on public.licencia to authenticated;
create policy licencia_lectura on public.licencia for select to authenticated using (public.es_personal());

create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;
create table privado.licencia_token (
  id int primary key default 1 check (id = 1),
  token text not null
);
alter table privado.licencia_token enable row level security;
alter table privado.licencia_token force row level security;
revoke all on privado.licencia_token from public, anon, authenticated;

-- ---------- Estado de la licencia ----------
-- libre: sin licencia activada (como hasta ahora) · activa · gracia: pasada la
-- fecha de fin pero dentro de los días de gracia · consulta: bloqueada,
-- caducada o sin hablar con la consola más de los días de gracia.
create or replace function public.licencia_estado() returns text
  language sql stable security definer set search_path = '' as $$
  select case
    when l.id is null or not l.controlada then 'libre'
    when l.bloqueada then 'consulta'
    when l.termina is null or current_date > l.termina + l.dias_gracia then 'consulta'
    when l.ultima_ok is null or l.ultima_ok < now() - make_interval(days => l.dias_gracia) then 'consulta'
    when current_date > l.termina then 'gracia'
    else 'activa' end
  from (select 1) x left join public.licencia l on l.id = 1
$$;

-- ¿Se puede escribir en algo del módulo indicado? (varios separados por |, vale cualquiera)
create or replace function public.licencia_permite(p_modulos text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select case public.licencia_estado()
    when 'libre' then true
    when 'consulta' then false
    else exists (select 1 from public.licencia l where l.id = 1 and l.modulos && string_to_array(p_modulos, '|')) end
$$;

-- ---------- Disparador genérico: módulo de la tabla y modo consulta ----------
create or replace function public.tg_licencia() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_estado text := public.licencia_estado();
  v_nombre text := coalesce(tg_argv[1], tg_argv[0]);
begin
  if v_estado = 'libre' then return coalesce(new, old); end if;
  if v_estado = 'consulta' then
    raise exception 'Licencia: el programa está en modo consulta. Puedes ver los datos, pero no crear ni cambiar nada. Habla con tu proveedor.'
      using errcode = 'P0001';
  end if;
  if not public.licencia_permite(tg_argv[0]) then
    raise exception 'Licencia: tu plan no incluye %.', v_nombre using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger licencia_citas before insert or update or delete on public.citas
  for each row execute function public.tg_licencia('AGENDA', 'la agenda');
create trigger licencia_clientes before insert or update or delete on public.clientes
  for each row execute function public.tg_licencia('CLIENTES', 'clientes');
create trigger licencia_contactos before insert or update or delete on public.contactos
  for each row execute function public.tg_licencia('CLIENTES', 'clientes');
create trigger licencia_datos_bancarios before insert or update or delete on public.datos_bancarios
  for each row execute function public.tg_licencia('CLIENTES', 'clientes');
create trigger licencia_motos before insert or update or delete on public.motos
  for each row execute function public.tg_licencia('VEHICULOS', 'vehículos');
create trigger licencia_reparaciones before insert or update or delete on public.reparaciones
  for each row execute function public.tg_licencia('AUTORIZACION|REPARACIONES', 'la recepción de vehículos');
create trigger licencia_reparacion_horas before insert or update or delete on public.reparacion_horas
  for each row execute function public.tg_licencia('REPARACIONES', 'reparaciones');
create trigger licencia_reparacion_piezas before insert or update or delete on public.reparacion_piezas
  for each row execute function public.tg_licencia('REPARACIONES', 'reparaciones');
create trigger licencia_piezas before insert or update or delete on public.piezas
  for each row execute function public.tg_licencia('ALMACEN', 'el almacén');
create trigger licencia_movimientos_stock before insert or update or delete on public.movimientos_stock
  for each row execute function public.tg_licencia('ALMACEN', 'el almacén');
create trigger licencia_facturas before insert or update or delete on public.facturas
  for each row execute function public.tg_licencia('FACTURACION', 'la facturación');
create trigger licencia_factura_lineas before insert or update or delete on public.factura_lineas
  for each row execute function public.tg_licencia('FACTURACION', 'la facturación');

-- ---------- Usuarios: no pasar del máximo de la licencia ----------
create or replace function public.tg_licencia_usuarios() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare v_max int;
begin
  if not new.activo or (tg_op = 'UPDATE' and old.activo) then return new; end if;
  if public.licencia_estado() = 'libre' then return new; end if;
  select max_usuarios into v_max from public.licencia where id = 1;
  if v_max is not null and (select count(*) from public.perfiles p where p.activo and p.id <> new.id) >= v_max then
    raise exception 'Licencia: tu plan permite % usuarios activos. Desactiva uno o amplía el plan.', v_max using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger licencia_usuarios before insert or update of activo on public.perfiles
  for each row execute function public.tg_licencia_usuarios();

-- ---------- Solo para el servidor (Edge Function con la clave de servicio) ----------
create or replace function public.licencia_guardar(p_estado jsonb, p_token text default null, p_error text default null)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_token is not null then
    if p_token !~ '^[0-9a-f]{64}$' then raise exception 'Token no válido'; end if;
    insert into privado.licencia_token (id, token) values (1, p_token)
    on conflict (id) do update set token = excluded.token;
    update public.licencia set controlada = true, activada_en = now() where id = 1;
  end if;
  if p_estado is not null then
    update public.licencia set
      cliente = coalesce(p_estado ->> 'cliente', ''),
      tipo = coalesce(p_estado ->> 'tipo', ''),
      empieza = (p_estado ->> 'empieza')::date,
      termina = (p_estado ->> 'termina')::date,
      dias_gracia = coalesce((p_estado ->> 'dias_gracia')::int, 15),
      bloqueada = coalesce((p_estado ->> 'bloqueada')::boolean, false),
      max_usuarios = (p_estado ->> 'max_usuarios')::int,
      max_sedes = coalesce((p_estado ->> 'max_sedes')::int, 1),
      modulos = coalesce((select array_agg(x) from jsonb_array_elements_text(p_estado -> 'modulos') x), '{}'),
      ultima_consulta = now(), ultima_ok = now(), ultimo_error = ''
    where id = 1;
  else
    update public.licencia set ultima_consulta = now(), ultimo_error = left(coalesce(p_error, ''), 300) where id = 1;
  end if;
end $$;

create or replace function public.licencia_token() returns text
  language sql stable security definer set search_path = '' as $$
  select token from privado.licencia_token where id = 1
$$;

-- Nadie salvo service_role ejecuta estas; las de estado, el personal
revoke all on function public.licencia_guardar(jsonb, text, text) from public, anon, authenticated;
revoke all on function public.licencia_token() from public, anon, authenticated;
grant execute on function public.licencia_guardar(jsonb, text, text) to service_role;
grant execute on function public.licencia_token() to service_role;
revoke all on function public.tg_licencia() from public, anon, authenticated;
revoke all on function public.tg_licencia_usuarios() from public, anon, authenticated;
revoke all on function public.licencia_estado() from public, anon;
revoke all on function public.licencia_permite(text) from public, anon;
grant execute on function public.licencia_estado() to authenticated;
grant execute on function public.licencia_permite(text) to authenticated;
