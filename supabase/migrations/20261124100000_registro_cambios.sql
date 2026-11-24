-- =====================================================================
-- CRM taller · Registro de cambios (auditoría) para el administrador
-- =====================================================================
-- * public.registro_cambios guarda quién, cuándo y qué cambió: altas,
--   cambios y borrados de citas, líneas de factura, piezas y horas de las
--   órdenes, precios, clientes, vehículos, usuarios, configuración, etc.
-- * Lo escribe la base de datos con disparadores (triggers) AFTER en cada
--   tabla: da igual desde dónde se haga el cambio (pantalla, importador,
--   otra herramienta), queda apuntado. No se puede saltar desde la app.
-- * No se puede modificar ni borrar: nadie tiene permiso de escritura sobre
--   la tabla (ni siquiera la clave de servicio) y además un disparador
--   rechaza cualquier UPDATE, DELETE o TRUNCATE.
-- * Solo lo lee el administrador, y solo si la licencia incluye el módulo
--   AUDITORIA (sin licencia activada, como ahora, lo ve siempre). El registro
--   se guarda siempre, tenga o no el módulo: si el taller amplía el plan,
--   ya tiene el historial.
-- * Velocidad: una fila por cambio, sin consultas pesadas en el disparador
--   (como mucho una búsqueda por clave primaria para el nombre del usuario
--   y el número de la factura/orden). En los cambios solo se guardan los
--   campos que han cambiado. Índices para los informes más usados.
-- =====================================================================

create table if not exists public.registro_cambios (
  id bigint generated always as identity primary key,
  fecha timestamptz not null default now(),
  usuario_id uuid,
  usuario_nombre text not null default '',
  tabla text not null,
  accion text not null check (accion in ('alta', 'cambio', 'borrado')),
  registro_id text,
  referencia text not null default '',
  campos text[] not null default '{}',   -- campos que cambiaron (en altas y borrados, vacío)
  antes jsonb,                           -- valores anteriores (solo los campos cambiados; en borrados, la fila entera)
  despues jsonb,                         -- valores nuevos (solo los campos cambiados; en altas, la fila entera)
  es_linea boolean not null default false,      -- línea de factura, pieza u horas de una orden
  precio_cambiado boolean not null default false
);

create index if not exists registro_cambios_fecha on public.registro_cambios (fecha desc);
create index if not exists registro_cambios_usuario on public.registro_cambios (usuario_id, fecha desc);
create index if not exists registro_cambios_tabla on public.registro_cambios (tabla, accion, fecha desc);
create index if not exists registro_cambios_lineas on public.registro_cambios (accion, fecha desc) where es_linea;
create index if not exists registro_cambios_precios on public.registro_cambios (fecha desc) where precio_cambiado;

alter table public.registro_cambios enable row level security;
revoke all on public.registro_cambios from public, anon, authenticated, service_role;
grant select on public.registro_cambios to authenticated;

-- ¿La licencia incluye el módulo? Para LEER: en modo consulta también se puede ver.
create or replace function public.licencia_incluye(p_modulo text) returns boolean
  language sql stable security definer set search_path = '' as $$
  select case public.licencia_estado()
    when 'libre' then true
    else exists (select 1 from public.licencia l where l.id = 1 and p_modulo = any (l.modulos)) end
$$;
revoke all on function public.licencia_incluye(text) from public, anon;
grant execute on function public.licencia_incluye(text) to authenticated;

create policy registro_solo_admin on public.registro_cambios for select to authenticated
  using (public.es_admin() and public.licencia_incluye('AUDITORIA'));

-- ---------- No se puede modificar ni borrar ----------
create or replace function public.tg_registro_inmutable() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception 'El registro de cambios no se puede modificar ni borrar.' using errcode = 'P0001';
end $$;

create or replace trigger registro_inmutable before update or delete on public.registro_cambios
  for each row execute function public.tg_registro_inmutable();
create or replace trigger registro_inmutable_truncate before truncate on public.registro_cambios
  for each statement execute function public.tg_registro_inmutable();

-- ---------- Disparador que apunta los cambios ----------
-- Argumentos: 0 = campos que no se apuntan (separados por coma; ruido como
-- created_at o el stock que ya lleva su propio registro), 1 = campos de precio,
-- 2 = 'linea' si la tabla son líneas (factura, piezas u horas de una orden),
-- 3 = campos sensibles: se apunta que cambiaron, pero no su valor.
create or replace function public.tg_registro_cambios() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_ignorar text[] := string_to_array(coalesce(nullif(tg_argv[0], ''), '-'), ',');
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
revoke all on function public.tg_registro_cambios() from public, anon, authenticated;
revoke all on function public.tg_registro_inmutable() from public, anon, authenticated;

-- ---------- Tablas vigiladas ----------
-- Se ponen solo en las que existan (así sirve también si la facturación
-- periódica y las remesas se publican antes o después).
do $$
declare
  t record;
begin
  for t in select * from (values
    -- tabla,               ignorar,                                         precios,                         linea,   ocultar
    ('citas',               'created_at',                                    '',                              '',      ''),
    ('factura_lineas',      '',                                              'precio,dto_pct,importe',        'linea', ''),
    ('reparacion_piezas',   'created_at',                                    'pvp',                           'linea', ''),
    ('reparacion_horas',    'created_at',                                    'precio_hora',                   'linea', ''),
    ('facturas',            'created_at',                                    'base,cuota,total,impuesto_pct', '',      ''),
    ('reparaciones',        'created_at,firma',                              'importe_max_autorizado',        '',      ''),
    ('piezas',              'created_at,stock',                              'pvp,precio_compra',             '',      ''),
    ('clientes',            'created_at',                                    'descuento_pct,tarifa_id',       '',      ''),
    ('contactos',           'created_at',                                    '',                              '',      ''),
    ('datos_bancarios',     'updated_at',                                    '',                              '',      'titular,iban,bic,banco,mandato_sepa,fecha_mandato'),
    ('motos',               'created_at',                                    '',                              '',      ''),
    ('perfiles',            '',                                              'precio_hora',                   '',      ''),
    ('tarifas',             '',                                              'descuento_pct,precio_hora',     '',      ''),
    ('impuestos',           '',                                              'porcentaje',                    '',      ''),
    ('config',              'siguiente_factura,siguiente_rectificativa',     'precio_hora',                   '',      ''),
    ('factura_reparaciones', '',                                             '',                              '',      ''),
    ('remesas',             'created_at',                                    '',                              '',      ''),
    ('remesa_recibos',      '',                                              '',                              '',      '')
  ) as x(tabla, ignorar, precios, linea, ocultar)
  loop
    if to_regclass('public.' || t.tabla) is null then continue; end if;
    execute format(
      'create or replace trigger registro_cambios after insert or update or delete on public.%I
         for each row execute function public.tg_registro_cambios(%L, %L, %L, %L)',
      t.tabla, t.ignorar, t.precios, t.linea, t.ocultar);
  end loop;
end $$;
