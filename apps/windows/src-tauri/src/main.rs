// Ventana de escritorio que abre directamente la web del taller.
// No da a la web ningún permiso extra del equipo: es como un navegador
// dedicado, sin barra de direcciones.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

const URL_APP: &str = "https://suckware.github.io/crm-taller/";

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::{WebviewUrl, WebviewWindowBuilder};
            let url: tauri::Url = URL_APP.parse().expect("URL válida");
            WebviewWindowBuilder::new(app, "principal", WebviewUrl::External(url))
                .title("Sergio Moto Sport · Taller")
                .inner_size(1366.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .maximized(true)
                // Enlaces fuera del taller (WhatsApp, correo, mapas…) se abren
                // en el navegador o programa del equipo, no dentro de la app.
                .on_navigation(|destino| {
                    let propio = destino.as_str().starts_with(URL_APP);
                    if !propio {
                        let _ = tauri_plugin_opener::open_url(destino.as_str(), None::<&str>);
                    }
                    propio
                })
                // Los enlaces que abren otra ventana (target="_blank") también.
                .on_new_window(|destino, _| {
                    let _ = tauri_plugin_opener::open_url(destino.as_str(), None::<&str>);
                    tauri::webview::NewWindowResponse::Deny
                })
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("no se pudo abrir la aplicación");
}
