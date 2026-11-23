// Licencia del CRM: habla con la consola de proveedor (nube del TPV).
//   { accion: "activar", codigo }  -> solo el administrador. Canjea el código y guarda el token.
//   { accion: "actualizar" }       -> cualquier persona del taller. Pregunta a la consola cómo está la licencia.
// El token del CRM nunca sale de aquí: se guarda en un esquema privado y solo se lee con la clave de servicio.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Datos públicos de la consola (la clave publicable no es secreta: la seguridad la ponen sus funciones).
const TPV_URL = Deno.env.get("TPV_URL") ?? "https://jstvnqskwwuejfmdvalb.supabase.co";
const TPV_KEY = Deno.env.get("TPV_KEY") ?? "sb_publishable_gZjPwMnK05WgZZeX-LxovQ_BVA7dPMo";
const ORIGENES = ["https://suckware.github.io", "http://localhost:5173", "http://localhost:4173"];

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGENES.includes(o) ? o : ORIGENES[0]!,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

async function tpv(fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${TPV_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: TPV_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = String((body as { message?: string }).message ?? "");
    throw new Error(/no válido|caducado/i.test(m) ? "Código no válido o caducado." :
      /no autorizado/i.test(m) ? "La consola no reconoce este CRM. Activa de nuevo con un código." :
      "No se ha podido hablar con la consola de licencias.");
  }
  return body as Record<string, unknown>;
}

Deno.serve(async (req) => {
  const h = { ...cors(req), "Content-Type": "application/json" };
  const resp = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: h });
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return resp(405, { error: "Método no permitido" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const auth = req.headers.get("Authorization") ?? "";
  const usuario = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const servicio = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  let body: { accion?: string; codigo?: string };
  try { body = await req.json(); } catch { return resp(400, { error: "Petición no válida" }); }

  // Solo personal del taller con sesión
  const { data: personal } = await usuario.rpc("es_personal");
  if (personal !== true) return resp(403, { error: "No autorizado" });

  try {
    if (body.accion === "activar") {
      const { data: admin } = await usuario.rpc("es_admin");
      if (admin !== true) return resp(403, { error: "Solo el administrador puede activar la licencia." });
      const codigo = String(body.codigo ?? "").trim();
      if (!/^[A-Za-z0-9 -]{12,30}$/.test(codigo)) return resp(400, { error: "Escribe el código tal como te lo dieron (16 letras y números)." });
      const r = await tpv("crm_activar", { p_codigo: codigo });
      const { error } = await servicio.rpc("licencia_guardar", { p_estado: r.estado, p_token: r.token });
      if (error) throw new Error("No se ha podido guardar la licencia.");
      return resp(200, { ok: true });
    }
    if (body.accion === "actualizar") {
      const { data: token } = await servicio.rpc("licencia_token");
      if (!token) return resp(200, { ok: true, sinLicencia: true });
      try {
        const estado = await tpv("crm_estado", { p_token: token });
        await servicio.rpc("licencia_guardar", { p_estado: estado });
      } catch (e) {
        await servicio.rpc("licencia_guardar", { p_estado: null, p_error: (e as Error).message });
        return resp(200, { ok: false, error: (e as Error).message });
      }
      return resp(200, { ok: true });
    }
    return resp(400, { error: "Acción no válida" });
  } catch (e) {
    return resp(400, { error: (e as Error).message });
  }
});
