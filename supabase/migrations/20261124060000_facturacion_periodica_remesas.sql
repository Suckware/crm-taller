-- Facturación periódica de albaranes (órdenes sin facturar) y remesas bancarias SEPA.
--
-- 1) Cada cliente tiene su periodicidad de facturación: en el momento, cada 10 días,
--    cada 15 días o mensual. Las órdenes terminadas (lista / entregada) que no se facturan
--    en el momento quedan como albarán pendiente y se agrupan después en una factura
--    recapitulativa por cliente y mes (art. 13 del Reglamento de facturación: una factura
--    recapitulativa solo puede agrupar operaciones del mismo mes natural).
-- 2) Con las facturas emitidas, el administrador genera remesas de adeudos directos SEPA
--    (Core o B2B). El fichero XML (pain.008.001.02, el que piden los bancos españoles en
--    sustitución del antiguo Cuaderno 19) se genera en el navegador del administrador con
--    los datos que devuelve la base de datos. Los IBAN de los clientes solo los ve el admin.
--
-- Todo lo que crea facturas o remesas pasa por funciones con permisos comprobados;
-- las tablas nuevas no se pueden escribir directamente desde la aplicación.

-- ---------------------------------------------------------------------------
-- Ajustes
-- ---------------------------------------------------------------------------
alter table public.clientes
  add column if not exists periodo_facturacion text not null default 'inmediata'
    check (periodo_facturacion in ('inmediata', 'decenal', 'quincenal', 'mensual'));

alter table public.config
  add column if not exists zona_horaria text not null default 'Atlantic/Canary',
  add column if not exists sepa_iban text,
  add column if not exists sepa_bic text,
  add column if not exists sepa_sufijo text not null default '000',
  add column if not exists serie_remesa text not null default 'REM-',
  add column if not exists siguiente_remesa integer not null default 1;

alter table public.config
  add constraint config_sepa_sufijo_check check (sepa_sufijo ~ '^[0-9A-Z]{3}$'),
  add constraint config_sepa_iban_check check (sepa_iban is null or sepa_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$'),
  add constraint config_sepa_bic_check check (sepa_bic is null or sepa_bic ~ '^[A-Z0-9]{8}([A-Z0-9]{3})?$'),
  add constraint config_serie_remesa_check check (serie_remesa ~ '^[A-Za-z0-9-]{1,12}$');

-- Día local del taller (la base de datos trabaja en UTC)
create or replace function public.dia_taller(p_ts timestamptz) returns date
language sql stable set search_path = public as $$
  select (p_ts at time zone coalesce((select zona_horaria from config where id = 1), 'Atlantic/Canary'))::date
$$;
create or replace function public.hoy_taller() returns date
language sql stable set search_path = public as $$ select public.dia_taller(now()) $$;

-- ---------------------------------------------------------------------------
-- Fecha en que termina la orden (fecha de la operación a efectos de factura)
-- ---------------------------------------------------------------------------
alter table public.reparaciones add column if not exists fecha_fin timestamptz;
update public.reparaciones set fecha_fin = fecha_entrada
  where estado in ('lista', 'entregada') and fecha_fin is null;

create or replace function public.tg_fecha_fin_reparacion() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.estado in ('lista', 'entregada') then
    if new.fecha_fin is null then new.fecha_fin := now(); end if;
  else
    new.fecha_fin := null; -- se ha reabierto
  end if;
  return new;
end $$;
drop trigger if exists fecha_fin_reparacion on public.reparaciones;
create trigger fecha_fin_reparacion before insert or update of estado on public.reparaciones
  for each row execute function public.tg_fecha_fin_reparacion();

-- ---------------------------------------------------------------------------
-- Una factura puede recoger varias órdenes
-- ---------------------------------------------------------------------------
create table if not exists public.factura_reparaciones (
  factura_id bigint not null references public.facturas(id) on delete cascade,
  reparacion_id bigint not null references public.reparaciones(id) on delete cascade,
  primary key (factura_id, reparacion_id)
);
create index if not exists factura_reparaciones_rep on public.factura_reparaciones(reparacion_id);
insert into public.factura_reparaciones (factura_id, reparacion_id)
  select id, reparacion_id from public.facturas where reparacion_id is not null and tipo = 'ordinaria'
  on conflict do nothing;

alter table public.factura_lineas add column if not exists reparacion_id bigint references public.reparaciones(id) on delete set null;
update public.factura_lineas l set reparacion_id = f.reparacion_id
  from public.facturas f where f.id = l.factura_id and f.reparacion_id is not null and l.reparacion_id is null;

-- Periodo de las operaciones que recoge la factura (útil también para VeriFactu: FechaOperacion)
alter table public.facturas
  add column if not exists periodo_desde date,
  add column if not exists periodo_hasta date;

alter table public.factura_reparaciones enable row level security;
create policy oficina_lee on public.factura_reparaciones for select to authenticated using ((select public.es_oficina()));
revoke insert, update, delete, truncate on public.factura_reparaciones from anon, authenticated;
grant select on public.factura_reparaciones to authenticated;
create trigger licencia_factura_reparaciones before insert or update or delete on public.factura_reparaciones
  for each row execute function public.tg_licencia('FACTURACION', 'la facturación');

-- ¿La orden ya está en una factura válida?
create or replace function public.reparacion_facturada(p_reparacion bigint) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from factura_reparaciones fr join facturas f on f.id = fr.factura_id
                 where fr.reparacion_id = p_reparacion and f.tipo = 'ordinaria' and f.estado <> 'anulada')
$$;

-- ---------------------------------------------------------------------------
-- Piezas internas (no se pueden llamar desde la aplicación)
-- ---------------------------------------------------------------------------
create or replace function public._siguiente_factura() returns text
language plpgsql security definer set search_path = public as $$
declare cfg config%rowtype;
begin
  select * into cfg from config where id = 1 for update;
  update config set siguiente_factura = siguiente_factura + 1 where id = 1;
  return cfg.serie_factura || lpad(cfg.siguiente_factura::text, 4, '0');
end $$;

create or replace function public._lineas_reparacion(p_factura bigint, p_reparacion bigint, p_orden integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into factura_lineas (factura_id, reparacion_id, tipo, concepto, cantidad, precio, importe, orden)
  select p_factura, p_reparacion, 'mano_obra', 'Mano de obra' || coalesce(' · ' || h.descripcion, '') || coalesce(' (' || p.nombre || ')', ''),
         h.horas, h.precio_hora, round(h.horas * h.precio_hora, 2), p_orden + 1
  from reparacion_horas h left join perfiles p on p.id = h.tecnico_id where h.reparacion_id = p_reparacion order by h.fecha, h.id;
  insert into factura_lineas (factura_id, reparacion_id, tipo, concepto, cantidad, precio, importe, orden)
  select p_factura, p_reparacion, 'pieza', pz.nombre || ' · ' || pz.referencia, rp.cantidad, rp.pvp, round(rp.cantidad * rp.pvp, 2), p_orden + 2
  from reparacion_piezas rp join piezas pz on pz.id = rp.pieza_id where rp.reparacion_id = p_reparacion order by rp.id;
end $$;

-- Descuento del cliente (o de su tarifa) sobre el total y cálculo de base, cuota y total
create or replace function public._cerrar_factura(p_factura bigint) returns void
language plpgsql security definer set search_path = public as $$
declare f facturas%rowtype; cli clientes%rowtype; v_base numeric(12,2); v_dto numeric(5,2); v_tarifa text;
begin
  select * into f from facturas where id = p_factura;
  select * into cli from clientes where id = f.cliente_id;
  v_dto := coalesce(nullif(cli.descuento_pct, 0), (select descuento_pct from tarifas where id = cli.tarifa_id), 0);
  select nombre into v_tarifa from tarifas where id = cli.tarifa_id;
  select coalesce(sum(importe), 0) into v_base from factura_lineas where factura_id = p_factura;
  if v_dto > 0 and v_base > 0 then
    insert into factura_lineas (factura_id, tipo, concepto, cantidad, precio, importe, orden)
      values (p_factura, 'otro', 'Descuento ' || trim(to_char(v_dto, 'FM990D##')) || ' %' || coalesce(' (tarifa ' || v_tarifa || ')', ''),
              1, -round(v_base * v_dto / 100, 2), -round(v_base * v_dto / 100, 2), 999999);
    v_base := v_base - round(v_base * v_dto / 100, 2);
  end if;
  update facturas set base = v_base, cuota = round(v_base * f.impuesto_pct / 100, 2),
    total = v_base + round(v_base * f.impuesto_pct / 100, 2) where id = p_factura;
end $$;

revoke all on function public._siguiente_factura() from public, anon, authenticated;
revoke all on function public._lineas_reparacion(bigint, bigint, integer) from public, anon, authenticated;
revoke all on function public._cerrar_factura(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Facturar una orden en el momento (misma función de antes, ahora con el enlace)
-- ---------------------------------------------------------------------------
create or replace function public.facturar_reparacion(p_reparacion bigint, p_impuesto integer) returns bigint
language plpgsql security definer set search_path = public as $$
declare r reparaciones%rowtype; imp impuestos%rowtype; fid bigint; v_dia date;
begin
  if not public.es_oficina() then raise exception 'No tienes permiso para facturar'; end if;
  perform 1 from config where id = 1 for update; -- una facturación a la vez
  select * into r from reparaciones where id = p_reparacion;
  if not found then raise exception 'Reparación no encontrada'; end if;
  if public.reparacion_facturada(p_reparacion) then raise exception 'Esta reparación ya tiene factura'; end if;
  select * into imp from impuestos where id = p_impuesto and activo;
  if not found then select * into imp from impuestos where por_defecto limit 1; end if;
  if imp.id is null then raise exception 'No hay impuesto configurado'; end if;
  v_dia := coalesce(public.dia_taller(r.fecha_fin), public.hoy_taller());
  insert into facturas (numero, fecha, cliente_id, reparacion_id, impuesto_nombre, impuesto_pct, periodo_desde, periodo_hasta)
    values (public._siguiente_factura(), public.hoy_taller(), r.cliente_id, r.id, imp.nombre, imp.porcentaje, v_dia, v_dia)
    returning id into fid;
  insert into factura_reparaciones (factura_id, reparacion_id) values (fid, r.id);
  perform public._lineas_reparacion(fid, r.id, 0);
  perform public._cerrar_factura(fid);
  return fid;
end $$;

-- ---------------------------------------------------------------------------
-- Albaranes pendientes de facturar (respeta los permisos del usuario)
-- ---------------------------------------------------------------------------
create or replace function public.por_facturar()
returns table (id bigint, numero text, estado text, cliente_id bigint, cliente text, periodo text,
               fecha_entrada timestamptz, fecha_fin timestamptz, dia_fin date, moto text, lineas integer, base numeric)
language sql stable set search_path = public as $$
  select r.id, r.numero, r.estado, r.cliente_id, c.nombre, c.periodo_facturacion,
         r.fecha_entrada, r.fecha_fin, public.dia_taller(r.fecha_fin),
         nullif(trim(coalesce(m.marca, '') || ' ' || coalesce(m.modelo, '') || coalesce(' · ' || m.matricula, '')), ''),
         ((select count(*) from reparacion_horas h where h.reparacion_id = r.id) + (select count(*) from reparacion_piezas p where p.reparacion_id = r.id))::integer,
         coalesce((select sum(round(h.horas * h.precio_hora, 2)) from reparacion_horas h where h.reparacion_id = r.id), 0)
       + coalesce((select sum(round(p.cantidad * p.pvp, 2)) from reparacion_piezas p where p.reparacion_id = r.id), 0)
  from reparaciones r join clientes c on c.id = r.cliente_id left join motos m on m.id = r.moto_id
  where public.es_oficina() and r.estado in ('lista', 'entregada', 'en_reparacion') and not public.reparacion_facturada(r.id)
  order by c.nombre, r.fecha_fin nulls last, r.id
$$;

-- ---------------------------------------------------------------------------
-- Facturación periódica: se factura exactamente lo que se ha marcado en pantalla
-- (las órdenes de su periodo y, si se quiere, otras que aún no tocaban).
-- Sale una factura por cliente y mes. Devuelve los ids de las facturas creadas.
-- ---------------------------------------------------------------------------
create or replace function public.facturar_albaranes(p_reparaciones bigint[], p_impuesto integer) returns bigint[]
language plpgsql security definer set search_path = public as $$
declare
  imp impuestos%rowtype; r reparaciones%rowtype; g record; rep record; fid bigint; k integer; v_ids bigint[] := '{}'; v_sel bigint[];
begin
  if not public.es_oficina() then raise exception 'No tienes permiso para facturar'; end if;
  select array_agg(distinct x) into v_sel from unnest(p_reparaciones) x where x is not null;
  if coalesce(array_length(v_sel, 1), 0) = 0 then raise exception 'Marca al menos un albarán'; end if;
  if array_length(v_sel, 1) > 2000 then raise exception 'Demasiados albaranes de una vez (máximo 2000)'; end if;
  select * into imp from impuestos where id = p_impuesto and activo;
  if not found then select * into imp from impuestos where por_defecto limit 1; end if;
  if imp.id is null then raise exception 'No hay impuesto configurado'; end if;
  perform 1 from config where id = 1 for update; -- una facturación a la vez: nada se factura dos veces

  -- comprobar cada orden antes de emitir nada (o se hace todo o nada)
  for r in select * from reparaciones where id = any (v_sel) loop
    if r.estado not in ('lista', 'entregada') or r.fecha_fin is null then raise exception 'La orden % todavía no está terminada', r.numero; end if;
    if public.reparacion_facturada(r.id) then raise exception 'La orden % ya está facturada', r.numero; end if;
    if not exists (select 1 from reparacion_horas h where h.reparacion_id = r.id) and not exists (select 1 from reparacion_piezas p where p.reparacion_id = r.id) then
      raise exception 'La orden % no tiene piezas ni horas', r.numero;
    end if;
  end loop;
  if (select count(*) from reparaciones where id = any (v_sel)) <> array_length(v_sel, 1) then raise exception 'Alguna orden no existe'; end if;

  for g in
    select r2.cliente_id, date_trunc('month', public.dia_taller(r2.fecha_fin))::date as mes,
           min(public.dia_taller(r2.fecha_fin)) as desde, max(public.dia_taller(r2.fecha_fin)) as hasta
    from reparaciones r2 where r2.id = any (v_sel) group by 1, 2 order by 1, 2
  loop
    insert into facturas (numero, fecha, cliente_id, reparacion_id, impuesto_nombre, impuesto_pct, periodo_desde, periodo_hasta)
      values (public._siguiente_factura(), public.hoy_taller(), g.cliente_id, null, imp.nombre, imp.porcentaje, g.desde, g.hasta)
      returning id into fid;
    k := 0;
    for rep in
      select r2.id from reparaciones r2
      where r2.id = any (v_sel) and r2.cliente_id = g.cliente_id and date_trunc('month', public.dia_taller(r2.fecha_fin))::date = g.mes
      order by r2.fecha_fin, r2.id
    loop
      insert into factura_reparaciones (factura_id, reparacion_id) values (fid, rep.id);
      perform public._lineas_reparacion(fid, rep.id, k * 10);
      k := k + 1;
    end loop;
    -- con una sola orden, queda enlazada como siempre
    if k = 1 then update facturas set reparacion_id = (select reparacion_id from factura_reparaciones where factura_id = fid) where id = fid; end if;
    perform public._cerrar_factura(fid);
    v_ids := v_ids || fid;
  end loop;
  return v_ids;
end $$;

-- La rectificativa también copia a qué orden pertenece cada línea
create or replace function public.rectificar_factura(p_factura bigint, p_motivo text) returns bigint
language plpgsql security definer set search_path = public as $$
declare f facturas%rowtype; cfg config%rowtype; rid bigint; num text;
begin
  if not public.es_oficina() then raise exception 'No tienes permiso para anular facturas'; end if;
  select * into f from facturas where id = p_factura for update;
  if not found then raise exception 'Factura no encontrada'; end if;
  if f.tipo <> 'ordinaria' then raise exception 'Una factura rectificativa no se puede anular'; end if;
  if f.estado = 'anulada' then raise exception 'Esta factura ya está anulada'; end if;
  if exists (select 1 from remesa_recibos rr join remesas re on re.id = rr.remesa_id
             where rr.factura_id = f.id and rr.estado = 'incluido' and re.estado in ('generada', 'enviada')) then
    raise exception 'Esta factura está en una remesa que aún no se ha cobrado. Anula la remesa o espera a que se cobre.';
  end if;
  select * into cfg from config where id = 1 for update;
  num := cfg.serie_rectificativa || lpad(cfg.siguiente_rectificativa::text, 4, '0');
  update config set siguiente_rectificativa = siguiente_rectificativa + 1 where id = 1;
  insert into facturas (numero, fecha, cliente_id, reparacion_id, impuesto_nombre, impuesto_pct, base, cuota, total, estado, tipo, rectifica_id, motivo_rectificacion, periodo_desde, periodo_hasta)
    values (num, public.hoy_taller(), f.cliente_id, null, f.impuesto_nombre, f.impuesto_pct, -f.base, -f.cuota, -f.total, 'emitida', 'rectificativa', f.id,
            nullif(trim(coalesce(p_motivo, '')), ''), f.periodo_desde, f.periodo_hasta)
    returning id into rid;
  insert into factura_lineas (factura_id, reparacion_id, tipo, concepto, cantidad, precio, dto_pct, orden)
    select rid, reparacion_id, tipo, concepto, cantidad, -precio, dto_pct, orden from factura_lineas where factura_id = f.id;
  update facturas set estado = 'anulada', motivo_rectificacion = nullif(trim(coalesce(p_motivo, '')), '') where id = f.id;
  return rid;
end $$;

-- ---------------------------------------------------------------------------
-- Remesas SEPA (solo administrador)
-- ---------------------------------------------------------------------------
create table if not exists public.remesas (
  id bigserial primary key,
  numero text not null unique,
  creada_en timestamptz not null default now(),
  creada_por uuid default auth.uid(),
  fecha_cargo date not null,
  esquema text not null default 'CORE' check (esquema in ('CORE', 'B2B')),
  estado text not null default 'generada' check (estado in ('generada', 'enviada', 'cobrada', 'anulada')),
  n_recibos integer not null default 0,
  total numeric(12,2) not null default 0,
  -- datos del acreedor en el momento de generarla (el fichero se puede volver a descargar igual)
  acreedor_nombre text not null,
  acreedor_id text not null,
  acreedor_iban text not null,
  acreedor_bic text,
  notas text
);

create table if not exists public.remesa_recibos (
  id bigserial primary key,
  remesa_id bigint not null references public.remesas(id) on delete cascade,
  factura_id bigint not null references public.facturas(id),
  cliente_id bigint not null references public.clientes(id),
  referencia text not null,
  importe numeric(12,2) not null check (importe > 0),
  titular text not null,
  iban text not null,
  bic text,
  mandato text not null,
  fecha_mandato date not null,
  secuencia text not null check (secuencia in ('FRST', 'RCUR')),
  estado text not null default 'incluido' check (estado in ('incluido', 'cobrado', 'devuelto', 'anulado')),
  motivo_devolucion text,
  devuelto_en timestamptz
);
create index if not exists remesa_recibos_remesa on public.remesa_recibos(remesa_id);
-- una factura solo puede estar en un recibo vivo a la vez
create unique index if not exists remesa_recibos_factura_viva on public.remesa_recibos(factura_id) where estado in ('incluido', 'cobrado');

alter table public.remesas enable row level security;
alter table public.remesa_recibos enable row level security;
create policy admin_lee on public.remesas for select to authenticated using ((select public.es_admin()));
create policy admin_lee on public.remesa_recibos for select to authenticated using ((select public.es_admin()));
revoke insert, update, delete, truncate on public.remesas, public.remesa_recibos from anon, authenticated;
revoke all on public.remesas, public.remesa_recibos from anon;
grant select on public.remesas, public.remesa_recibos to authenticated;
create trigger licencia_remesas before insert or update or delete on public.remesas
  for each row execute function public.tg_licencia('FACTURACION', 'la facturación');
create trigger licencia_remesa_recibos before insert or update or delete on public.remesa_recibos
  for each row execute function public.tg_licencia('FACTURACION', 'la facturación');

-- Identificador de acreedor SEPA español (AT-02): ES + dígitos de control + sufijo + NIF
create or replace function public.sepa_id_acreedor(p_nif text, p_sufijo text default '000') returns text
language plpgsql immutable set search_path = public as $$
declare n text := upper(regexp_replace(coalesce(p_nif, ''), '[^A-Za-z0-9]', '', 'g')); s text := ''; c text; i integer; resto integer := 0;
begin
  if n = '' then return null; end if;
  for i in 1 .. length(n || 'ES00') loop
    c := substr(n || 'ES00', i, 1);
    s := s || case when c ~ '[A-Z]' then (ascii(c) - 55)::text else c end;
  end loop;
  for i in 1 .. length(s) loop resto := (resto * 10 + substr(s, i, 1)::integer) % 97; end loop;
  return 'ES' || lpad((98 - resto)::text, 2, '0') || coalesce(p_sufijo, '000') || n;
end $$;

create or replace function public.crear_remesa(p_facturas bigint[], p_fecha_cargo date, p_esquema text default 'CORE') returns bigint
language plpgsql security definer set search_path = public as $$
declare
  cfg config%rowtype; v_id bigint; fid bigint; f facturas%rowtype; b datos_bancarios%rowtype; cli clientes%rowtype; v_seq text;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede generar remesas'; end if;
  if p_esquema not in ('CORE', 'B2B') then raise exception 'Tipo de adeudo no válido'; end if;
  if p_fecha_cargo is null or p_fecha_cargo <= public.hoy_taller() then raise exception 'La fecha de cargo tiene que ser posterior a hoy'; end if;
  if p_fecha_cargo > public.hoy_taller() + 90 then raise exception 'La fecha de cargo no puede pasar de 90 días'; end if;
  if coalesce(array_length(p_facturas, 1), 0) = 0 then raise exception 'Elige al menos una factura'; end if;
  if array_length(p_facturas, 1) > 2000 then raise exception 'Demasiadas facturas en una remesa (máximo 2000)'; end if;
  select * into cfg from config where id = 1 for update;
  if cfg.sepa_iban is null then raise exception 'Falta la cuenta de cobro (IBAN) del taller en Configuración'; end if;
  if public.sepa_id_acreedor(cfg.cif, cfg.sepa_sufijo) is null then raise exception 'Falta el CIF del taller en Configuración'; end if;
  update config set siguiente_remesa = siguiente_remesa + 1 where id = 1;
  insert into remesas (numero, fecha_cargo, esquema, acreedor_nombre, acreedor_id, acreedor_iban, acreedor_bic)
    values (cfg.serie_remesa || lpad(cfg.siguiente_remesa::text, 4, '0'), p_fecha_cargo, p_esquema,
            coalesce(nullif(cfg.razon_social, ''), cfg.nombre_taller), public.sepa_id_acreedor(cfg.cif, cfg.sepa_sufijo), cfg.sepa_iban, cfg.sepa_bic)
    returning id into v_id;

  foreach fid in array (select array_agg(distinct x) from unnest(p_facturas) x) loop
    select * into f from facturas where id = fid for update;
    if not found then raise exception 'Factura no encontrada'; end if;
    if f.tipo <> 'ordinaria' or f.estado <> 'pendiente' or f.total <= 0 then
      raise exception 'La factura % no está pendiente de cobro', f.numero;
    end if;
    if exists (select 1 from remesa_recibos where factura_id = fid and estado in ('incluido', 'cobrado')) then
      raise exception 'La factura % ya está en otra remesa', f.numero;
    end if;
    select * into cli from clientes where id = f.cliente_id;
    select * into b from datos_bancarios where cliente_id = f.cliente_id;
    if b.iban is null or b.mandato_sepa is null or b.fecha_mandato is null then
      raise exception 'A % le falta el IBAN, la referencia o la fecha del mandato SEPA', cli.nombre;
    end if;
    -- primer adeudo de ese mandato: FRST; los siguientes: RCUR
    v_seq := case when exists (select 1 from remesa_recibos rr join remesas re on re.id = rr.remesa_id
                               where rr.mandato = b.mandato_sepa and rr.cliente_id = f.cliente_id and rr.remesa_id <> v_id
                                 and rr.estado in ('incluido', 'cobrado') and re.estado <> 'anulada')
                  then 'RCUR' else 'FRST' end;
    insert into remesa_recibos (remesa_id, factura_id, cliente_id, referencia, importe, titular, iban, bic, mandato, fecha_mandato, secuencia)
      values (v_id, fid, f.cliente_id, f.numero, f.total, coalesce(nullif(b.titular, ''), cli.nombre), b.iban, nullif(b.bic, ''),
              b.mandato_sepa, b.fecha_mandato, v_seq);
    update facturas set forma_pago = 'Domiciliación SEPA' where id = fid;
  end loop;
  update remesas set n_recibos = (select count(*) from remesa_recibos where remesa_id = v_id),
                     total = (select coalesce(sum(importe), 0) from remesa_recibos where remesa_id = v_id) where id = v_id;
  return v_id;
end $$;

-- enviada (ya está en el banco) · cobrada (el banco la ha abonado: las facturas quedan cobradas) · anulada
create or replace function public.remesa_cambiar_estado(p_remesa bigint, p_estado text) returns void
language plpgsql security definer set search_path = public as $$
declare re remesas%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede gestionar remesas'; end if;
  select * into re from remesas where id = p_remesa for update;
  if not found then raise exception 'Remesa no encontrada'; end if;
  if p_estado = 'enviada' and re.estado = 'generada' then
    update remesas set estado = 'enviada' where id = p_remesa;
  elsif p_estado = 'cobrada' and re.estado in ('generada', 'enviada') then
    update facturas f set estado = 'cobrada', cobrada_en = (re.fecha_cargo::timestamp + time '12:00'), forma_pago = 'Domiciliación SEPA'
      from remesa_recibos rr where rr.remesa_id = p_remesa and rr.estado = 'incluido' and f.id = rr.factura_id and f.estado = 'pendiente';
    update remesa_recibos set estado = 'cobrado' where remesa_id = p_remesa and estado = 'incluido';
    update remesas set estado = 'cobrada' where id = p_remesa;
  elsif p_estado = 'anulada' and re.estado in ('generada', 'enviada') then
    update remesa_recibos set estado = 'anulado' where remesa_id = p_remesa and estado = 'incluido';
    update remesas set estado = 'anulada' where id = p_remesa;
  else
    raise exception 'No se puede pasar la remesa de % a %', re.estado, p_estado;
  end if;
end $$;

-- El banco devuelve un recibo: la factura vuelve a quedar pendiente de cobro
create or replace function public.devolver_recibo(p_recibo bigint, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare rr remesa_recibos%rowtype; re remesas%rowtype;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede gestionar remesas'; end if;
  select * into rr from remesa_recibos where id = p_recibo for update;
  if not found then raise exception 'Recibo no encontrado'; end if;
  select * into re from remesas where id = rr.remesa_id;
  if re.estado not in ('enviada', 'cobrada') or rr.estado not in ('incluido', 'cobrado') then
    raise exception 'Solo se puede devolver un recibo de una remesa enviada o cobrada';
  end if;
  update remesa_recibos set estado = 'devuelto', devuelto_en = now(), motivo_devolucion = left(nullif(trim(coalesce(p_motivo, '')), ''), 300) where id = p_recibo;
  update facturas set estado = 'pendiente', cobrada_en = null where id = rr.factura_id and estado = 'cobrada';
end $$;

revoke all on function public.facturar_reparacion(bigint, integer) from public, anon;
revoke all on function public.facturar_albaranes(bigint[], integer) from public, anon;
revoke all on function public.rectificar_factura(bigint, text) from public, anon;
revoke all on function public.por_facturar() from public, anon;
revoke all on function public.crear_remesa(bigint[], date, text) from public, anon;
revoke all on function public.remesa_cambiar_estado(bigint, text) from public, anon;
revoke all on function public.devolver_recibo(bigint, text) from public, anon;
revoke all on function public.reparacion_facturada(bigint) from public, anon;
grant execute on function public.facturar_reparacion(bigint, integer), public.facturar_albaranes(bigint[], integer),
  public.rectificar_factura(bigint, text), public.por_facturar(), public.crear_remesa(bigint[], date, text),
  public.remesa_cambiar_estado(bigint, text), public.devolver_recibo(bigint, text), public.reparacion_facturada(bigint),
  public.sepa_id_acreedor(text, text), public.dia_taller(timestamptz), public.hoy_taller() to authenticated;
