// "He olvidado mi contraseña".
//   POST { usuario }  -> sin sesión (verify_jwt = false).
// Si el usuario existe, está activo y tiene un correo puesto en Configuración,
// se le manda por correo un enlace de un solo uso (caduca en 1 hora) para
// poner una contraseña nueva. Siempre se contesta lo mismo, exista o no el
// usuario, para no revelar quién trabaja en el taller.
// El correo sale por Resend: secretos RESEND_API_KEY y RESEND_FROM.
import { createClient } from "jsr:@supabase/supabase-js@2";

// El enlace siempre apunta a la web del taller (nunca a lo que diga quien llama).
const APP_URL = Deno.env.get("APP_URL") ?? "https://suckware.github.io/crm-taller/";
const ORIGENES = ["https://suckware.github.io", "http://localhost:5173", "http://localhost:4173"];
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") ?? "Taller <onboarding@resend.dev>";

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.includes(o) ? o : ORIGENES[0]!,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const RESPUESTA = { ok: true, mensaje: "Si el usuario tiene un correo registrado, le hemos enviado un enlace para cambiar la contraseña." };

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Método no permitido" }), { status: 405, headers: h });

  const inicio = Date.now();
  // Responder siempre en un tiempo parecido, para que no se note si el usuario existe
  const responder = async () => {
    const espera = 1200 - (Date.now() - inicio);
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    return new Response(JSON.stringify(RESPUESTA), { headers: h });
  };

  try {
    const body = await req.json().catch(() => ({}));
    const usuario = String((body as { usuario?: unknown }).usuario ?? "").trim().toLowerCase();
    if (!/^[a-z0-9._-]{2,40}$/.test(usuario)) return await responder();

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0]!.trim();
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    const { data: destino, error } = await sb.rpc("recuperacion_destino", { p_usuario: usuario, p_ip: ip });
    if (error) throw error;
    const d = (destino as { user_id: string; correo: string; nombre: string }[] | null)?.[0];
    if (!d) return await responder();

    const { data: u, error: e1 } = await sb.auth.admin.getUserById(d.user_id);
    if (e1 || !u.user?.email) throw e1 ?? new Error("Usuario sin correo interno");
    const { data: link, error: e2 } = await sb.auth.admin.generateLink({ type: "recovery", email: u.user.email });
    if (e2) throw e2;
    const enlace = `${APP_URL}?clave=${encodeURIComponent(link.properties.hashed_token)}`;

    if (!RESEND_KEY) {
      console.error("Falta el secreto RESEND_API_KEY: no se ha podido enviar el correo de recuperación");
      return await responder();
    }
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [d.correo],
        subject: "Cambiar tu contraseña del taller",
        text: `Hola ${d.nombre}:\n\nHemos recibido una petición para cambiar la contraseña de tu usuario "${usuario}".\nAbre este enlace para poner una nueva (caduca en 1 hora y solo sirve una vez):\n\n${enlace}\n\nSi no lo has pedido tú, ignora este correo: tu contraseña no cambia.`,
        html: `<p>Hola ${esc(d.nombre)}:</p><p>Hemos recibido una petición para cambiar la contraseña de tu usuario <b>${esc(usuario)}</b>.</p>
<p><a href="${esc(enlace)}" style="display:inline-block;padding:12px 20px;background:#1F3A6E;color:#fff;border-radius:8px;text-decoration:none">Poner una contraseña nueva</a></p>
<p style="color:#555">El enlace caduca en 1 hora y solo sirve una vez. Si no lo has pedido tú, ignora este correo: tu contraseña no cambia.</p>`,
      }),
    });
    if (!r.ok) console.error("Resend respondió", r.status, await r.text().catch(() => ""));
    return await responder();
  } catch (e) {
    console.error(e);
    return await responder();
  }
});
