-- =====================================================================
-- CRM taller · Trabajar sin internet en el taller · Fases 1 y 2
-- =====================================================================
-- Fase 1 · Preparar los datos para sincronizar
-- * Cada tabla que irá a la copia local del taller lleva:
--     uid        código único (uuid). Un equipo sin internet puede crear
--                registros con su propio código sin chocar con la nube.
--                No cambia nunca (el disparador lo protege).
--     updated_at fecha del último cambio, la pone la base de datos.
--                Sirve para bajar solo lo que ha cambiado desde la última vez.
-- * public.borrados apunta qué registros se han borrado (tabla + uid), para
--   que la copia local también los borre. Solo guarda el código, ningún dato.
-- * El stock ya funciona por movimientos (las reparaciones y las compras
--   suman o restan, nunca escriben "quedan 5"), así que no hay que cambiarlo.
-- * Datos bancarios, remesas, sesiones, correos de usuarios, licencia y el
--   registro de cambios NO se preparan: no irán nunca a la copia local.
--
-- Fase 2 · Señal de vida del equipo del taller y aviso para no solapar citas
-- * public.equipos: los equipos del taller que el administrador da de alta.
-- * latido_equipo(): el equipo del taller la llama cada minuto mientras la
--   app está abierta, y al cerrarla de forma normal (cerrado = true).
-- * estado_sync(): dice a cualquier usuario si algún equipo del taller lleva
--   más de config.sync_aviso_min minutos sin dar señal (y no se cerró bien),
--   o si tiene cambios sin subir. Si todo está bien, no hay aviso.
-- * Sin DROP: todo es aditivo y se puede aplicar con la app funcionando.
-- =====================================================================

-- ---------- Fase 1 ----------
create or replace function public.tg_updated_at() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_table_name <> 'config' then new.uid := old.uid; end if; -- el código único no cambia nunca
  return new;
end $$;

create table if not exists public.borrados (
  id bigint generated always as identity primary key,
  tabla text not null,
  uid uuid not null,
  fecha timestamptz not null default now()
);
create index if not exists borrados_fecha on public.borrados (fecha);
alter table public.borrados enable row level security;
revoke all on public.borrados from public, anon, authenticated;
grant select on public.borrados to authenticated;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.borrados'::regclass and polname = 'personal_lee') then
    create policy personal_lee on public.borrados for select to authenticated using ((select public.es_personal()));
  end if;
end $$;

create or replace function public.tg_borrado() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.borrados (tabla, uid) values (tg_table_name, old.uid);
  return null;
end $$;
revoke all on function public.tg_borrado() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['citas', 'clientes', 'contactos', 'motos', 'reparaciones', 'reparacion_piezas', 'reparacion_horas',
    'piezas', 'movimientos_stock', 'proveedores', 'campos_personalizados', 'tarifas', 'impuestos', 'perfiles',
    'facturas', 'factura_lineas', 'factura_reparaciones'] loop
    execute format('alter table public.%I add column if not exists uid uuid not null default gen_random_uuid()', t);
    execute format('alter table public.%I add column if not exists updated_at timestamptz not null default now()', t);
    execute format('create unique index if not exists %I on public.%I (uid)', t || '_uid', t);
    execute format('create index if not exists %I on public.%I (updated_at)', t || '_updated_at', t);
    execute format('create or replace trigger zz_updated_at before update on public.%I for each row execute function public.tg_updated_at()', t);
    execute format('create or replace trigger zz_borrado after delete on public.%I for each row execute function public.tg_borrado()', t);
  end loop;
end $$;

alter table public.config add column if not exists updated_at timestamptz not null default now();
create or replace trigger zz_updated_at before update on public.config for each row execute function public.tg_updated_at();

-- El registro de cambios no apunta uid ni updated_at (son de la sincronización, no del usuario)
create or replace function public.tg_registro_cambios() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_ignorar text[] := string_to_array(coalesce(nullif(tg_argv[0], ''), '-'), ',') || array['uid', 'updated_at'];
  v_precios text[] := string_to_array(coalesce(nullif(tg_argv[1], ''), '-'), ',');
  v_linea boolean := coalesce(tg_argv[2], '') = 'linea';
  v_ocultar text[] := string_to_array(coalesce(nullif(tg_argv[3], ''), '-'), ',');
  v_new jsonb; v_old jsonb; v_fila jsonb;
  v_campos text[] := '{}';
  v_antes jsonb := '{}'; v_despues jsonb := '{}';
  v_k text;
  v_uid uuid := auth.uid();
  v_nombre text := 'Sistema';
  v_ref text := '';
  v_accion text;
  v_precio boolean := false;
begin
  if tg_op = 'INSERT' then v_accion := 'alta'; v_new := to_jsonb(new);
  elsif tg_op = 'UPDATE' then v_accion := 'cambio'; v_new := to_jsonb(new); v_old := to_jsonb(old);
  else v_accion := 'borrado'; v_old := to_jsonb(old);
  end if;
  v_fila := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    for v_k in select jsonb_object_keys(v_new) loop
      if v_k = any (v_ignorar) then continue; end if;
      if (v_new -> v_k) is distinct from (v_old -> v_k) then
        v_campos := v_campos || v_k;
        if v_k = any (v_ocultar) then
          v_antes := v_antes || jsonb_build_object(v_k, '(oculto)');
          v_despues := v_despues || jsonb_build_object(v_k, '(oculto)');
        else
          v_antes := v_antes || jsonb_build_object(v_k, v_old -> v_k);
          v_despues := v_despues || jsonb_build_object(v_k, v_new -> v_k);
        end if;
        if v_k = any (v_precios) then v_precio := true; end if;
      end if;
    end loop;
    if cardinality(v_campos) = 0 then return null; end if; -- no ha cambiado nada que interese
  else
    -- altas y borrados: la fila entera, sin lo que no interesa ni lo sensible
    v_fila := v_fila - v_ignorar - v_ocultar;
    if tg_table_name = 'reparaciones' then v_fila := v_fila - 'firma'; end if; -- la firma es una imagen grande
    if tg_op = 'INSERT' then v_despues := v_fila; v_antes := null; else v_antes := v_fila; v_despues := null; end if;
  end if;

  if v_uid is not null then
    select p.nombre into v_nombre from public.perfiles p where p.id = v_uid;
    v_nombre := coalesce(v_nombre, 'Usuario desconocido');
  end if;

  -- Referencia legible (qué cita, qué factura, qué orden...)
  begin
    v_ref := case tg_table_name
      when 'citas' then to_char((v_fila ->> 'inicio')::timestamptz at time zone 'Atlantic/Canary', 'DD/MM/YYYY HH24:MI') || ' · ' || coalesce(v_fila ->> 'servicio', '')
      when 'factura_lineas' then coalesce((select 'Factura ' || f.numero from public.facturas f where f.id = (v_fila ->> 'factura_id')::bigint), 'Factura')
        || ' · ' || coalesce(v_fila ->> 'concepto', '')
      when 'reparacion_piezas' then coalesce((select 'Orden ' || r.numero from public.reparaciones r where r.id = (v_fila ->> 'reparacion_id')::bigint), 'Orden')
        || ' · ' || coalesce((select coalesce(pz.referencia || ' ', '') || pz.nombre from public.piezas pz where pz.id = (v_fila ->> 'pieza_id')::bigint), 'pieza')
      when 'reparacion_horas' then coalesce((select 'Orden ' || r.numero from public.reparaciones r where r.id = (v_fila ->> 'reparacion_id')::bigint), 'Orden')
        || ' · horas' || coalesce(' · ' || nullif(v_fila ->> 'descripcion', ''), '')
      when 'facturas' then 'Factura ' || coalesce(v_fila ->> 'numero', '')
      when 'reparaciones' then 'Orden ' || coalesce(v_fila ->> 'numero', '')
      when 'piezas' then coalesce(v_fila ->> 'referencia' || ' ', '') || coalesce(v_fila ->> 'nombre', '')
      when 'clientes' then coalesce(v_fila ->> 'nombre', '')
      when 'contactos' then coalesce(v_fila ->> 'nombre', '')
      when 'motos' then concat_ws(' ', v_fila ->> 'matricula', v_fila ->> 'marca', v_fila ->> 'modelo')
      when 'perfiles' then concat_ws(' · ', v_fila ->> 'nombre', v_fila ->> 'usuario')
      when 'tarifas' then coalesce(v_fila ->> 'nombre', '')
      when 'impuestos' then concat_ws(' ', v_fila ->> 'nombre', (v_fila ->> 'porcentaje') || ' %')
      when 'config' then 'Datos del taller'
      when 'datos_bancarios' then 'Datos bancarios'
      when 'remesas' then 'Remesa ' || coalesce(v_fila ->> 'numero', v_fila ->> 'id', '')
      else '' end;
  exception when others then v_ref := ''; -- la referencia nunca debe impedir guardar
  end;

  insert into public.registro_cambios
    (usuario_id, usuario_nombre, tabla, accion, registro_id, referencia, campos, antes, despues, es_linea, precio_cambiado)
  values
    (v_uid, v_nombre, tg_table_name, v_accion,
     coalesce(v_fila ->> 'id', v_fila ->> 'cliente_id'), left(coalesce(v_ref, ''), 200),
     v_campos, v_antes, v_despues, v_linea, v_precio);
  return null;
end $$;

-- ---------- Fase 2 ----------
alter table public.config add column if not exists sync_aviso_min integer not null default 3;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'config_sync_aviso_min_rango') then
    alter table public.config add constraint config_sync_aviso_min_rango check (sync_aviso_min between 1 and 120);
  end if;
end $$;

create table if not exists public.equipos (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(btrim(nombre)) between 1 and 60),
  activo boolean not null default true,
  alta timestamptz not null default now(),
  alta_por uuid default auth.uid() references public.perfiles (id) on delete set null,
  ultimo_latido timestamptz,
  ultima_sync timestamptz,
  pendientes integer not null default 0 check (pendientes >= 0),
  cerrado boolean not null default true,   -- la app se cerró de forma normal: no hace falta avisar
  ultimo_usuario uuid references public.perfiles (id) on delete set null
);
alter table public.equipos enable row level security;
revoke all on public.equipos from public, anon, authenticated;
grant select, insert, update, delete on public.equipos to authenticated;
do $$ begin
  if not exists (select 1 from pg_policy where polrelid = 'public.equipos'::regclass and polname = 'personal_lee') then
    create policy personal_lee on public.equipos for select to authenticated using ((select public.es_personal()));
    create policy admin_inserta on public.equipos for insert to authenticated with check ((select public.es_admin()));
    create policy admin_modifica on public.equipos for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
    create policy admin_borra on public.equipos for delete to authenticated using ((select public.es_admin()));
  end if;
end $$;

-- Señal de vida. Cualquier usuario del taller puede darla, pero solo para un
-- equipo dado de alta y activo. Devuelve false si el equipo ya no existe o se
-- retiró: entonces la app deja de comportarse como equipo del taller.
create or replace function public.latido_equipo(p_equipo uuid, p_pendientes integer default 0, p_cerrado boolean default false)
  returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.es_personal() then raise exception 'No autorizado' using errcode = '42501'; end if;
  update public.equipos set
    ultimo_latido = now(),
    pendientes = greatest(coalesce(p_pendientes, 0), 0),
    ultima_sync = case when coalesce(p_pendientes, 0) = 0 then now() else ultima_sync end,
    cerrado = coalesce(p_cerrado, false),
    ultimo_usuario = auth.uid()
  where id = p_equipo and activo;
  return found;
end $$;
revoke all on function public.latido_equipo(uuid, integer, boolean) from public, anon;
grant execute on function public.latido_equipo(uuid, integer, boolean) to authenticated;

-- ¿Hay que avisar? Se calcula con la hora del servidor, no la del móvil.
create or replace function public.estado_sync()
  returns table (id uuid, nombre text, ultimo_latido timestamptz, ultima_sync timestamptz, pendientes integer, aviso boolean)
  language sql stable security invoker set search_path = '' as $$
  select e.id, e.nombre, e.ultimo_latido, e.ultima_sync, e.pendientes,
    (not e.cerrado and coalesce(e.ultimo_latido, '-infinity') < now() - make_interval(mins => c.sync_aviso_min))
    or (e.pendientes > 0 and coalesce(e.ultima_sync, '-infinity') < now() - make_interval(mins => c.sync_aviso_min)) as aviso
  from public.equipos e cross join public.config c
  where e.activo and c.id = 1
  order by e.nombre
$$;
revoke all on function public.estado_sync() from public, anon;
grant execute on function public.estado_sync() to authenticated;

-- El alta y la retirada de equipos queda en el registro de cambios (sin la señal de vida, que es ruido)
do $$ begin
  if to_regproc('public.tg_registro_cambios') is not null then
    create or replace trigger registro_cambios after insert or update or delete on public.equipos
      for each row execute function public.tg_registro_cambios('ultimo_latido,ultima_sync,pendientes,cerrado,ultimo_usuario', '', '', '');
  end if;
end $$;
