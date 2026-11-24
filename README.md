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
