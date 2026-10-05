// ============================================================================
//  Autenticación de procesar-factura (usuario) y de ocr-trabajo (secreto)
// ----------------------------------------------------------------------------
//  Movido desde index.ts (04b, tarea B1). Sin Deno.env al cargarse: recibe la
//  configuración y la fábrica de clientes por parámetro (los tests la simulan).
//
//  ⚠️ `verify_jwt` NO sirve como autenticación en este proyecto: la anon key es
//  un JWT válido y viaja en el bundle público del panel. Hay que comprobar que
//  detrás del token hay un USUARIO real y que tiene la sección `facturas`.
// ============================================================================

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export interface ConfigAuth {
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
  // deno-lint-ignore no-explicit-any
  crearCliente: (url: string, key: string, opciones?: any) => any;
}

/**
 * Comprueba que detrás del token hay un usuario y que tiene `permiso` sobre
 * facturas. 'view' para subir documentos (lo mismo que exige el panel para
 * entrar en /facturas); 'edit' para SUSTITUIR una factura existente.
 */
export async function autenticar(
  req: Request,
  cfg: ConfigAuth,
  permiso: "view" | "edit" = "view",
): Promise<{ ok: true; userId: string } | { ok: false; response: Response }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    console.error("[procesar-factura] Sin cabecera Authorization");
    return { ok: false, response: jsonResponse({ success: false, error: "No autorizado" }, 401) };
  }

  const supabaseUser = cfg.crearCliente(cfg.supabaseUrl, cfg.anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
  if (userError || !user) {
    console.error("[procesar-factura] Token sin usuario:", userError?.message);
    return { ok: false, response: jsonResponse({ success: false, error: "Usuario no autenticado" }, 401) };
  }

  const supabaseAdmin = cfg.crearCliente(cfg.supabaseUrl, cfg.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // `has_section_permission` ya devuelve true para administradores.
  const { data: permitido, error: permError } = await supabaseAdmin.rpc("has_section_permission", {
    _user_id: user.id,
    _section: "facturas",
    _permission: permiso,
  });
  if (permError) {
    console.error("[procesar-factura] Error comprobando permisos:", permError.message);
    return { ok: false, response: jsonResponse({ success: false, error: "Error verificando permisos" }, 500) };
  }
  if (!permitido) {
    console.error(`[procesar-factura] Usuario sin permiso '${permiso}' en facturas:`, user.id);
    return {
      ok: false,
      response: jsonResponse(
        {
          success: false,
          error: permiso === "edit"
            ? "Sustituir una factura exige permiso de edición en Facturas"
            : "Sin permisos sobre la sección de facturas",
        },
        403,
      ),
    };
  }
  return { ok: true, userId: user.id };
}

/** Comparación en tiempo constante (copiada de sync-trafico-web/sync.ts:44). */
export function compararTiempoConstante(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * Secreto compartido de ocr-trabajo. FALLA CERRADO: sin secreto configurado
 * → 500; cabecera ausente o distinta → 401. null = autorizado.
 */
export function verificarSecreto(req: Request, secreto: string | undefined | null): Response | null {
  if (!secreto) {
    console.error("[ocr-trabajo] OCR_TRABAJOS_SECRET no configurado — rechazando (falla cerrado)");
    return jsonResponse({ ok: false, error: "server_misconfigured" }, 500);
  }
  const cabecera = req.headers.get("x-ocr-secret") ?? "";
  if (!cabecera || !compararTiempoConstante(cabecera, secreto)) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }
  return null;
}
