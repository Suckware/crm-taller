# CRM de taller · Sergio Moto Sport

Aplicación web para la gestión de un taller de motos: agenda del personal, recepción con hoja de autorización firmada, órdenes de reparación (diagnóstico, piezas del almacén y horas por mecánico), almacén con proveedores y facturación con IGIC.

- Funciona en ordenador, tablet, móvil y PDA (la facturación solo se muestra en ordenador).
- Solo entra el personal con usuario y contraseña. Los clientes no agendan.
- Datos y usuarios en Supabase, protegidos con políticas RLS por rol (administrador, recepción, mecánico).
- Publicada en GitHub Pages en cada push a `main`.

## Desarrollo

```bash
npm install
npm run dev
```

## Seguridad

- En el código solo está la clave **pública** de Supabase (publishable). Nunca se sube la clave de servicio.
- Cada tabla tiene RLS: solo usuarios con perfil activo en `perfiles` acceden, y según su rol.
- La facturación y la configuración solo las pueden tocar recepción/administración.

## Importar datos de otro programa

Configuración › **Importar datos** (solo administrador). Sirve para implantar el CRM en un taller que viene de otro programa de gestión.

- Se puede importar: clientes y proveedores (una sola ficha con rol), vehículos, artículos del almacén, albaranes/notas de compra y facturas emitidas.
- Admite Excel (.xlsx) y CSV/TXT (separado por `;`, `,` o tabulador, en UTF-8 o Windows-1252). El archivo se lee en el navegador.
- Las columnas se relacionan solas por el nombre y se pueden cambiar a mano. Antes de guardar hay una comprobación fila a fila; lo que ya existe no se duplica (NIF, código anterior, matrícula/bastidor, referencia o número de factura).
- El código de cada cliente en el programa anterior se guarda como `Código anterior` para enlazar después vehículos, compras y facturas.
- Las referencias de artículos se guardan en mayúsculas, igual que al crearlas a mano.
- Todo pasa por las mismas reglas RLS que el resto de la app: no hace falta ningún cambio en la base de datos.

## Registro de cambios (solo administrador)

Menú **Registro de cambios**: quién ha dado de alta, cambiado o borrado qué y cuándo (citas, líneas de factura, piezas y horas de las órdenes, precios, clientes, vehículos, usuarios, configuración…). Informes en pestañas: citas cambiadas, líneas borradas, líneas cambiadas y precios cambiados, con filtros por fechas, usuario y texto, y descarga para Excel.

- Lo apunta la base de datos con disparadores (`supabase/migrations/20261124100000_registro_cambios.sql`): no se puede saltar desde la app.
- No se puede modificar ni borrar: nadie tiene permiso de escritura sobre `registro_cambios` y un disparador rechaza UPDATE, DELETE y TRUNCATE.
- Solo lo lee el administrador. Con licencia activada, además hace falta el módulo `AUDITORIA` (se apunta igual aunque no lo tenga).
- De los datos bancarios solo se apunta qué campo cambió, no su valor.

## Roles, ventanas y dispositivos

Configuración › **Roles y ventanas** (solo administrador): cada rol decide qué ventanas del menú ve (Agenda, Reparaciones y recepción, Clientes, Almacén, Facturación) y su tipo de permisos (Oficina: cambia precios, stock y factura; Taller: consulta el almacén, no factura). Se pueden crear roles nuevos. El Administrador lo ve todo siempre.

Configuración › **Usuarios**: en cada persona se marca desde qué equipos puede entrar (iPhone/iPad, Android, Windows, otros).

- Lo comprueba la base de datos (`supabase/migrations/20261124140000_roles_y_dispositivos.sql`): el sistema del equipo se saca del navegador que hace cada petición, al entrar y en cada operación. Si se quita un dispositivo a alguien conectado desde él, queda fuera al momento.
- Sin la ventana Facturación en el rol, la base de datos no deja leer ni hacer facturas ni remesas.
- Nadie puede cambiarse a sí mismo el rol, el acceso ni los dispositivos, y siempre queda al menos un administrador activo.
- Los cambios en roles y usuarios quedan en el Registro de cambios.
## Almacén: buscar piezas y código de barras

- Cada pieza tiene ficha propia (Datos, Histórico de ventas y Movimientos) con botón **Volver** y su **margen** sobre el precio de compra.
- En **Registrar compra** (entradas) y en **Añadir pieza** de una orden (salidas) la pieza se busca por nombre, referencia, marca o código de barras. La búsqueda la hace la base de datos (25 resultados), así que va rápida aunque haya miles de piezas.
- Con lector de código de barras: el lector escribe el código y pulsa Intro; si coincide con un código o una referencia, la pieza queda elegida y se pasa a la cantidad.
- El código de barras es único si se rellena (`supabase/migrations/20261124150000_piezas_codigo_barras.sql`) y se puede importar desde otro programa (columna EAN / código de barras).

## Trabajar sin internet en el taller (fases 1 y 2)

- **Fase 1 · datos preparados para sincronizar.** Las tablas que irán a la copia local del taller tienen `uid` (código único que no cambia) y `updated_at` (lo pone la base de datos). Los borrados se apuntan en `borrados` (solo tabla y código). Datos bancarios, remesas, sesiones y el registro de cambios nunca irán a la copia local.
- **Fase 2 · aviso para no solapar citas.** Configuración › **Equipo del taller** (solo administrador): se marca el ordenador del taller. Ese ordenador manda una señal de vida cada minuto mientras el programa está abierto. Si pasa más de X minutos sin señal (3 por defecto) y no se cerró de forma normal, la agenda y la pantalla de nueva cita de los demás muestran un aviso amarillo. Si todo está bien, no sale nada. El aviso nunca impide guardar.
- La hora la calcula el servidor (`estado_sync()`), no el dispositivo.

## Artículos NO INVENTARIABLE, unidades y cajas

- Cada artículo del almacén es **Inventariable** (lleva stock) o **NO INVENTARIABLE** (horas de trabajo, banco de potencia, reprogramaciones…: no suma ni resta stock ni da avisos).
- Cada artículo se vende por una unidad (unidad, hora, litro, metro, kilo, juego o servicio) y el PVP es por esa unidad. Si viene en cajas se indica cuántas unidades trae: el stock va siempre en unidades, y en compras y órdenes se elige caja o unidades sueltas.
- En la orden, descripción, cantidad, precio y descuento de cada línea se cambian ahí mismo; al cambiar la cantidad el stock se ajusta con la diferencia. Con la orden ya facturada no se pueden cambiar.
- Cambiar precios y descuentos depende del permiso del rol (Configuración › Roles y ventanas › "Puede cambiar el precio…"). Lo comprueba la base de datos (`supabase/migrations/20261125090000_articulos_unidades_lineas.sql`).
