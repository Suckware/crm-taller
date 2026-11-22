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
