-- =====================================================================
-- Artículos NO INVENTARIABLE, unidad de venta, cajas y líneas editables
-- =====================================================================
-- * Artículos (tabla piezas):
--     inventariable = false  -> NO INVENTARIABLE (horas de trabajo, banco de
--                               potencia, reprogramación…): no tiene stock,
--                               no suma ni resta y no avisa de stock mínimo.
--     unidad                 -> cómo se vende: unidad, hora, litro, metro,
--                               kg, juego o servicio. El PVP es por esa unidad.
--     unidades_caja          -> si viene en cajas, cuántas unidades trae
--                               (ej. 100 bridas). El stock siempre va en unidades.
-- * Líneas de piezas de la orden (reparacion_piezas):
--     descripcion (texto propio de la línea), dto_pct (descuento de la línea),
--     en_cajas (se vende por cajas) y unidades_stock (lo que ha salido del
--     almacén). La cantidad admite decimales (1,5 h); en artículos con stock
--     lo que sale del almacén tiene que ser un número entero de unidades.
--     Al cambiar la cantidad, el stock se ajusta con la diferencia.
-- * Horas (reparacion_horas): pieza_id = artículo NO INVENTARIABLE de mano de
--   obra ("Hora mecánica", "Hora banco de potencia"…), opcional.
-- * Permiso por rol "Puede cambiar precios" (roles.cambia_precios): sin él,
--   el precio y el descuento de las líneas no se pueden cambiar (lo comprueba
--   la base de datos). Al crear la columna se da a los roles de oficina,
--   que eran los que ya podían cambiar el precio de las horas.
-- * Una orden ya facturada no deja cambiar sus líneas (hay que anular la
--   factura antes).
-- Solo añade columnas y cambia funciones: no borra datos. Se puede ejecutar
-- más de una vez.
-- =====================================================================

-- ---------- Artículos ----------
alter table public.piezas add column if not exists inventariable boolean not null default true;
alter table public.piezas add column if not exists unidad text not null default 'unidad';
alter table public.piezas add column if not exists unidades_caja integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'piezas_unidad_valida' and conrelid = 'public.piezas'::regclass) then
    alter table public.piezas add constraint piezas_unidad_valida
      check (unidad in ('unidad', 'hora', 'litro', 'metro', 'kg', 'juego', 'servicio'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'piezas_unidades_caja_valida' and conrelid = 'public.piezas'::regclass) then
    alter table public.piezas add constraint piezas_unidades_caja_valida
      check (unidades_caja is null or unidades_caja between 2 and 100000);
  end if;
end $$;

-- Un artículo NO INVENTARIABLE no tiene stock. Si se pasa a NO INVENTARIABLE
-- con stock, queda un ajuste en Movimientos para que cuadre.
create or replace function public.tg_piezas_inventario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.inventariable then
    if tg_op = 'UPDATE' and old.inventariable and old.stock <> 0 then
      insert into movimientos_stock (pieza_id, tipo, cantidad, nota)
        values (new.id, 'ajuste', -old.stock, 'Pasa a NO INVENTARIABLE: stock a 0');
    end if;
    new.stock := 0;
    new.stock_minimo := 0;
    new.unidades_caja := null;
  end if;
  return new;
end $$;
create or replace trigger piezas_inventario before insert or update on public.piezas
  for each row execute function public.tg_piezas_inventario();

-- Las compras solo valen para artículos con stock
create or replace function public.registrar_compra(p_pieza bigint, p_cantidad integer, p_precio numeric, p_proveedor bigint, p_fecha date default current_date, p_nota text default null)
returns void language plpgsql set search_path = public as $$
begin
  if auth.uid() is not null and not public.es_oficina() then raise exception 'No tienes permiso para registrar compras'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'La cantidad debe ser mayor que cero'; end if;
  if p_precio is not null and p_precio < 0 then raise exception 'Precio no válido'; end if;
  if exists (select 1 from piezas where id = p_pieza and not inventariable) then
    raise exception 'Es un artículo NO INVENTARIABLE: no lleva stock';
  end if;
  update piezas set stock = stock + p_cantidad, precio_compra = coalesce(p_precio, precio_compra),
    fecha_compra = coalesce(p_fecha, current_date), proveedor_id = coalesce(p_proveedor, proveedor_id)
  where id = p_pieza;
  insert into movimientos_stock (pieza_id, tipo, cantidad, precio, proveedor_id, nota, fecha)
    values (p_pieza, 'entrada', p_cantidad, p_precio, p_proveedor, coalesce(left(p_nota,300),'Compra a proveedor'), coalesce(p_fecha, current_date)::timestamptz + (now()::time));
end $$;

-- ---------- Permiso por rol: cambiar precios ----------
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'roles' and column_name = 'cambia_precios') then
    alter table public.roles add column cambia_precios boolean not null default false;
    update public.roles set cambia_precios = true where nivel in ('admin', 'oficina');
  end if;
end $$;

create or replace function public.puede_cambiar_precios()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.nivel = 'admin' or r.cambia_precios
    from public.perfiles p join public.roles r on r.clave = p.rol
    where p.id = auth.uid() and p.activo and public.sesion_vigente()
  ), false)
$$;

-- ---------- Líneas de piezas de la orden ----------
alter table public.reparacion_piezas alter column cantidad type numeric(12,3);
alter table public.reparacion_piezas add column if not exists descripcion text;
alter table public.reparacion_piezas add column if not exists dto_pct numeric(5,2) not null default 0;
alter table public.reparacion_piezas add column if not exists en_cajas boolean not null default false;
alter table public.reparacion_piezas add column if not exists unidades_stock integer;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'reparacion_piezas_valores' and conrelid = 'public.reparacion_piezas'::regclass) then
    alter table public.reparacion_piezas add constraint reparacion_piezas_valores
      check (cantidad > 0 and pvp >= 0 and dto_pct between 0 and 100 and (descripcion is null or length(descripcion) <= 200));
  end if;
end $$;
-- Las líneas que ya había salieron del stock tal cual
update public.reparacion_piezas set unidades_stock = cantidad::integer where unidades_stock is null;

create or replace function public.tg_reparacion_piezas()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pz piezas%rowtype; v_factor integer; v_unid numeric; v_dif integer; v_stock integer; v_rep bigint;
begin
  if auth.uid() is not null and not public.es_personal() then raise exception 'No autorizado'; end if;
  v_rep := case when tg_op = 'DELETE' then old.reparacion_id else new.reparacion_id end;
  if public.reparacion_facturada(v_rep) then
    raise exception 'Esta orden ya está facturada: para cambiar sus líneas hay que anular la factura';
  end if;

  if tg_op = 'DELETE' then
    if coalesce(old.unidades_stock, 0) <> 0 and exists (select 1 from piezas where id = old.pieza_id and inventariable) then
      update piezas set stock = stock + old.unidades_stock where id = old.pieza_id;
      insert into movimientos_stock (pieza_id, tipo, cantidad, precio, reparacion_id, nota)
        values (old.pieza_id, 'devolucion', old.unidades_stock, old.pvp, old.reparacion_id, 'Devuelta al almacén');
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and (new.pieza_id <> old.pieza_id or new.reparacion_id <> old.reparacion_id or new.en_cajas <> old.en_cajas) then
    raise exception 'Para cambiar el artículo o la unidad, quita la línea y añádela de nuevo';
  end if;

  select * into pz from piezas where id = new.pieza_id for update;
  if not found then raise exception 'Artículo no encontrado'; end if;
  if new.en_cajas and pz.unidades_caja is null then raise exception 'Este artículo no se vende por cajas'; end if;
  v_factor := case when new.en_cajas then pz.unidades_caja else 1 end;
  new.descripcion := nullif(btrim(coalesce(new.descripcion, '')), '');
  if new.descripcion = pz.nombre then new.descripcion := null; end if;
  new.dto_pct := coalesce(new.dto_pct, 0);
  if new.pvp is null then new.pvp := round(pz.pvp * v_factor, 2); end if;

  -- Precio y descuento: solo quien tiene el permiso en su rol
  if auth.uid() is not null and not public.puede_cambiar_precios() then
    if tg_op = 'INSERT' and (new.pvp <> round(pz.pvp * v_factor, 2) or new.dto_pct <> 0) then
      raise exception 'Tu rol no permite cambiar precios ni descuentos';
    end if;
    if tg_op = 'UPDATE' and (new.pvp <> old.pvp or new.dto_pct <> old.dto_pct) then
      raise exception 'Tu rol no permite cambiar precios ni descuentos';
    end if;
  end if;

  -- Stock: solo los artículos inventariables, y en unidades enteras
  if pz.inventariable then
    v_unid := new.cantidad * v_factor;
    if v_unid <> trunc(v_unid) then
      raise exception 'De un artículo con stock solo pueden salir unidades enteras';
    end if;
    new.unidades_stock := v_unid::integer;
  else
    -- NO INVENTARIABLE: no mueve stock (si antes lo tuvo, la línea se queda como estaba)
    new.unidades_stock := case when tg_op = 'UPDATE' then old.unidades_stock else null end;
  end if;
  v_dif := coalesce(new.unidades_stock, 0) - case when tg_op = 'UPDATE' then coalesce(old.unidades_stock, 0) else 0 end;

  if v_dif <> 0 then
    update piezas set stock = stock - v_dif where id = new.pieza_id returning stock into v_stock;
    if v_dif > 0 and v_stock < 0 then raise exception 'No hay stock suficiente de ese artículo'; end if;
    insert into movimientos_stock (pieza_id, tipo, cantidad, precio, reparacion_id, nota)
      values (new.pieza_id, case when v_dif > 0 then 'salida' else 'devolucion' end, abs(v_dif), new.pvp, new.reparacion_id,
              case when tg_op = 'INSERT' then 'Usada en reparación' when v_dif > 0 then 'Más cantidad en la orden' else 'Menos cantidad en la orden' end);
  end if;
  return new;
end $$;
drop trigger if exists reparacion_piezas_stock on public.reparacion_piezas;
create trigger reparacion_piezas_stock before insert or update or delete on public.reparacion_piezas
  for each row execute function public.tg_reparacion_piezas();

-- ---------- Horas ----------
alter table public.reparacion_horas add column if not exists pieza_id bigint references public.piezas (id) on delete restrict;
create index if not exists reparacion_horas_pieza on public.reparacion_horas (pieza_id);

create or replace function public.tg_reparacion_horas_reglas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rep bigint; v_ok boolean;
begin
  v_rep := case when tg_op = 'DELETE' then old.reparacion_id else new.reparacion_id end;
  if public.reparacion_facturada(v_rep) then
    raise exception 'Esta orden ya está facturada: para cambiar sus líneas hay que anular la factura';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.pieza_id is not null and exists (select 1 from piezas where id = new.pieza_id and inventariable) then
    raise exception 'Para las horas se elige un artículo NO INVENTARIABLE';
  end if;
  if new.horas is null or new.horas <= 0 or new.precio_hora is null or new.precio_hora < 0 then
    raise exception 'Horas o precio no válidos';
  end if;
  if auth.uid() is not null and not public.puede_cambiar_precios() then
    if tg_op = 'UPDATE' then
      v_ok := new.precio_hora = old.precio_hora;
    else
      -- sin permiso solo vale el precio que propone la app
      v_ok := new.precio_hora in (
        select x from (
          select (select pvp from piezas where id = new.pieza_id) x
          union all select t.precio_hora from reparaciones r join clientes c on c.id = r.cliente_id join tarifas t on t.id = c.tarifa_id where r.id = new.reparacion_id and new.pieza_id is null
          union all select p.precio_hora from perfiles p where p.id = new.tecnico_id and new.pieza_id is null
          union all select precio_hora from config where id = 1 and new.pieza_id is null
        ) s where x is not null);
    end if;
    if not coalesce(v_ok, false) then raise exception 'Tu rol no permite cambiar precios'; end if;
  end if;
  return new;
end $$;
create or replace trigger reparacion_horas_reglas before insert or update or delete on public.reparacion_horas
  for each row execute function public.tg_reparacion_horas_reglas();

-- ---------- Facturación: texto, descuento y cajas de cada línea ----------
create or replace function public._lineas_reparacion(p_factura bigint, p_reparacion bigint, p_orden integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into factura_lineas (factura_id, reparacion_id, tipo, concepto, cantidad, precio, importe, orden)
  select p_factura, p_reparacion, 'mano_obra', coalesce(a.nombre, 'Mano de obra') || coalesce(' · ' || h.descripcion, '') || coalesce(' (' || p.nombre || ')', ''),
         h.horas, h.precio_hora, round(h.horas * h.precio_hora, 2), p_orden + 1
  from reparacion_horas h left join perfiles p on p.id = h.tecnico_id left join piezas a on a.id = h.pieza_id
  where h.reparacion_id = p_reparacion order by h.fecha, h.id;
  insert into factura_lineas (factura_id, reparacion_id, tipo, concepto, cantidad, precio, dto_pct, importe, orden)
  select p_factura, p_reparacion, case when pz.inventariable then 'pieza' else 'otro' end,
         coalesce(rp.descripcion, pz.nombre) || ' · ' || pz.referencia || case when rp.en_cajas then ' (caja de ' || pz.unidades_caja || ')' else '' end,
         rp.cantidad, rp.pvp, rp.dto_pct, round(rp.cantidad * rp.pvp * (1 - rp.dto_pct / 100), 2), p_orden + 2
  from reparacion_piezas rp join piezas pz on pz.id = rp.pieza_id where rp.reparacion_id = p_reparacion order by rp.id;
end $$;
revoke all on function public._lineas_reparacion(bigint, bigint, integer) from public, anon, authenticated;

create or replace function public.por_facturar()
returns table (id bigint, numero text, estado text, cliente_id bigint, cliente text, periodo text,
               fecha_entrada timestamptz, fecha_fin timestamptz, dia_fin date, moto text, lineas integer, base numeric)
language sql stable set search_path = public as $$
  select r.id, r.numero, r.estado, r.cliente_id, c.nombre, c.periodo_facturacion,
         r.fecha_entrada, r.fecha_fin, public.dia_taller(r.fecha_fin),
         nullif(trim(coalesce(m.marca, '') || ' ' || coalesce(m.modelo, '') || coalesce(' · ' || m.matricula, '')), ''),
         ((select count(*) from reparacion_horas h where h.reparacion_id = r.id) + (select count(*) from reparacion_piezas p where p.reparacion_id = r.id))::integer,
         coalesce((select sum(round(h.horas * h.precio_hora, 2)) from reparacion_horas h where h.reparacion_id = r.id), 0)
       + coalesce((select sum(round(p.cantidad * p.pvp * (1 - p.dto_pct / 100), 2)) from reparacion_piezas p where p.reparacion_id = r.id), 0)
  from reparaciones r join clientes c on c.id = r.cliente_id left join motos m on m.id = r.moto_id
  where public.es_oficina() and r.estado in ('lista', 'entregada', 'en_reparacion') and not public.reparacion_facturada(r.id)
  order by c.nombre, r.fecha_fin nulls last, r.id
$$;
