// ============================================================================
// newsletter-sync-resend — autenticación y forma de las respuestas (puro)
// ----------------------------------------------------------------------------
// Dos llamadores:
//   · el panel (botón «Sincronizar con Resend» y el estado de la conexión):
//     JWT del usuario + can_read_section('marketing') («Ver») para ver el estado y
//     can_edit_section('marketing') («Editar», 06/11/2026; antes
//     can_write_section) para sincronizar;
//   · pg_cron / Cron del Dashboard (una vez al día): sin usuario, con la
//     cabecera x-webhook-secret == NEWSLETTER_SYNC_CRON_SECRET (comparación en
//     tiempo constante; FALLA CERRADO si el secret no está configurado). Mismo
//     patrón que sync-trafico-web y emails-reserva.
// Por eso verify_jwt = false en supabase/config.toml: el cron no trae JWT.
// ============================================================================

import type { ModoPermiso, ResultadoPermiso } from "../_shared/permiso-marketing.ts";
import { nivelCuota, type CanalNewsletter, type NivelCuota } from "../_shared/resend-marketing/config.ts";
import type { PasadaResend } from "../_shared/resend-marketing/repositorio.ts";
import type { ResumenSync } from "../_shared/resend-marketing/sync.ts";

export type Accion = "estado" | "sincronizar";

/** GET = estado. POST {accion: "estado" | "sincronizar"}; sin cuerpo o sin accion, sincronizar (lo que manda el cron). */
export function leerAccion(metodo: string, cuerpo: unknown): Accion | null {
  if (metodo === "GET") return "estado";
  if (cuerpo === null || cuerpo === undefined) return "sincronizar";
  if (typeof cuerpo !== "object") return null;
  const a = (cuerpo as { accion?: unknown }).accion;
  if (a === undefined) return "sincronizar";
  return a === "estado" || a === "sincronizar" ? a : null;
}

export function compararTiempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  const n = Math.max(ea.length, eb.length);
  for (let i = 0; i < n; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export type Autenticacion =
  | { ok: true; origen: "cron" | "panel"; usuarioId: string | null }
  | { ok: false; status: 401 | 403 | 500; error: string };

export async function autenticar(
  cabeceras: { get(nombre: string): string | null },
  accion: Accion,
  cfg: { secretoCron: string; comprobarUsuario: (modo: ModoPermiso) => Promise<ResultadoPermiso> },
): Promise<Autenticacion> {
  const secreto = cabeceras.get("x-webhook-secret");
  if (secreto !== null) {
    if (!cfg.secretoCron) return { ok: false, status: 500, error: "server_misconfigured" };
    if (!secreto || !compararTiempoConstante(secreto, cfg.secretoCron)) return { ok: false, status: 401, error: "unauthorized" };
    return { ok: true, origen: "cron", usuarioId: null };
  }
  if (!cabeceras.get("authorization")) return { ok: false, status: 401, error: "Unauthorized" };
  const permiso = await cfg.comprobarUsuario(accion === "sincronizar" ? "editar" : "leer");
  if (!permiso.ok) return { ok: false, status: permiso.status, error: permiso.error };
  return { ok: true, origen: "panel", usuarioId: permiso.userId };
}

export interface EstadoConexion {
  canal: CanalNewsletter;
  configurado: { api_key: boolean; segment_id: string | null; cron_secret: boolean };
  limite_contactos: number;
  contactos_resend: number | null;
  nivel_cuota: NivelCuota;
  ultima_pasada: PasadaResend | null;
  ultima_terminada: PasadaResend | null;
}

export function construirEstado(e: {
  canal: CanalNewsletter;
  apiKey: boolean;
  segmentIdEnv: string | null;
  cronSecret: boolean;
  limite: number;
  ultima: PasadaResend | null;
  ultimaTerminada: PasadaResend | null;
}): EstadoConexion {
  const ref = e.ultimaTerminada ?? null;
  const contactos = ref?.contactos_resend ?? null;
  return {
    canal: e.canal,
    configurado: {
      api_key: e.apiKey,
      segment_id: (e.segmentIdEnv ?? "").trim() || ref?.segment_id || null,
      cron_secret: e.cronSecret,
    },
    limite_contactos: e.limite,
    contactos_resend: contactos,
    nivel_cuota: nivelCuota(contactos, e.limite),
    ultima_pasada: e.ultima,
    ultima_terminada: e.ultimaTerminada,
  };
}

/** Lo que se devuelve tras sincronizar (sin emails: solo ids de suscriptor en los errores). */
export function respuestaSincronizacion(r: ResumenSync, pasadaId: string, limite: number) {
  return {
    success: r.estado !== "error",
    pasada_id: pasadaId,
    estado: r.estado,
    segment_id: r.segmentId,
    segmento_creado: r.segmentoCreado,
    contactos_resend: r.contactosResend,
    limite_contactos: limite,
    nivel_cuota: nivelCuota(r.contactosResend, limite),
    destinatarios: r.destinatarios,
    contactos_ajenos: r.ajenos,
    altas: r.altas,
    actualizados: r.actualizados,
    anadidos_segmento: r.anadidosSegmento,
    quitados_segmento: r.quitadosSegmento,
    borrados: r.borrados,
    bajas_resend: r.bajasResend,
    pendientes: r.pendientes,
    bloquea_envio: r.bloqueaEnvio,
    errores: r.errores.slice(0, 20),
    total_errores: r.errores.length,
    error: r.estado === "error" ? r.mensajeError : undefined,
  };
}
