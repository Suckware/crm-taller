# Instaladores del CRM (Windows, Android, iOS)

Las tres apps son "ventanas" que abren directamente la web del taller
(`https://suckware.github.io/crm-taller/`). Todo sigue estando en la nube:
cuando se publica un cambio en la web, las apps lo tienen al momento, sin
reinstalar nada. No guardan datos en el equipo ni piden permisos extra.

Los enlaces de WhatsApp, correo y teléfono se abren en el programa del
equipo (WhatsApp, Outlook…), no dentro de la app.

## Velocidad

- La web guarda en el equipo sus propios archivos (código, estilos, fuentes,
  iconos) con un *service worker*. Desde la segunda vez, la app arranca sin
  descargarlos: solo pide a la nube la página principal (para estar siempre
  en la última versión) y los datos. Si la red tarda más de 3 s, abre con la
  copia guardada.
- Los datos del taller (Supabase) nunca se guardan ahí: siempre son los de
  la nube.
- La conexión con Supabase se abre en cuanto carga la página (preconnect).
- Windows: ventana con el mismo fondo que la pantalla de carga (sin destello
  blanco) y binario optimizado (LTO, tamaño). Android/iOS: sin registro de
  depuración en la consola.

## Descargar los instaladores

GitHub › pestaña **Actions** › "Instaladores (Windows, Android, iOS)" ›
la última ejecución › apartado **Artifacts**:

- `SMS-Taller-Windows`: `SMS Taller_1.0.0_x64-setup.exe` (instalador normal)
  y `.msi` (para instalar en varios equipos a la vez).
- `SMS-Taller-Android`: `SMS-Taller.apk`.

Se generan solos en cada PR que toque `apps/` y también a mano con
"Run workflow".

## Windows (10 y 11)

- Hecha con Tauri: el instalador pesa unos pocos MB y la app usa el
  navegador Edge (WebView2) que ya trae Windows, así que arranca rápido y
  gasta poca memoria (mucho menos que una app Electron).
- Windows 10/11: si falta WebView2 (muy raro), el instalador lo descarga.
- **Windows 8 / 8.1**: Microsoft ya no da soporte de WebView2 ni de Edge en
  Windows 8, así que esta app no se puede garantizar ahí. En esos equipos se
  instala desde el navegador: abrir la web en Chrome o Edge › menú ›
  "Instalar SMS Taller" (es la misma app como ventana propia).
- Sin certificado de firma, Windows SmartScreen avisa la primera vez:
  "Más información" › "Ejecutar de todas formas". Con un certificado de
  firma de código el aviso desaparece.

## Android

- Hecha con Capacitor. La APK de Actions es de pruebas (firmada con la
  clave de depuración): se instala en el móvil o PDA permitiendo
  "instalar apps de origen desconocido".
- Para Google Play hace falta generar un `.aab` firmado con una clave
  propia (se guarda como secreto de GitHub, nunca en el repositorio).

## iPhone / iPad

- Sin pagar nada: abrir la web en **Safari** › Compartir ›
  **Añadir a pantalla de inicio**. Queda un icono con el logo y se abre a
  pantalla completa como una app.
- App nativa: necesita un Mac con Xcode y una cuenta de Apple.
  ```bash
  cd apps/movil
  npm ci
  npm run preparar:ios
  npx cap open ios   # en Xcode: Signing & Capabilities › elegir el equipo › ejecutar en el iPhone
  ```
  Con una cuenta gratuita la app caduca a los 7 días; con la cuenta de
  desarrollador (99 €/año) se reparte por TestFlight. Apple suele rechazar
  en la App Store las apps que solo abren una web, así que para un taller
  lo normal es TestFlight o la opción de Safari.

## Cambiar la dirección de la web

- Windows: `URL_APP` en `apps/windows/src-tauri/src/main.rs`.
- Móvil: `server.url` en `apps/movil/capacitor.config.json`.
