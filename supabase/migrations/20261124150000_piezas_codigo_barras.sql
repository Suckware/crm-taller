-- Código de barras de las piezas del almacén
-- Para buscar la pieza con el lector en las compras (entradas) y en las órdenes (salidas).
-- Sin DROP ni borrado de datos. Se puede ejecutar más de una vez.
--
-- Registro de cambios: la tabla piezas ya tiene su disparador de registro_cambios,
-- así que los cambios del código de barras quedan apuntados sin tocar nada más.

alter table public.piezas add column if not exists codigo_barras text;

comment on column public.piezas.codigo_barras is 'Código de barras (EAN/UPC u otro). Único si se rellena.';

-- Dos piezas no pueden tener el mismo código; vacío se permite en todas.
create unique index if not exists piezas_codigo_barras_key
  on public.piezas (codigo_barras)
  where codigo_barras is not null and codigo_barras <> '';

-- Vacío se guarda como NULL
update public.piezas set codigo_barras = null where codigo_barras = '';
