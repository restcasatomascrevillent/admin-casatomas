// ============================================================================
// Acceso a la base de datos para la sincronización con Resend Marketing
// ----------------------------------------------------------------------------
// Recibe un cliente de Supabase con la SERVICE ROLE (lo crea cada index.ts);
// este fichero no importa nada de https:// para poder testearlo con vitest.
// Tablas/funciones: migración 20261003193000_newsletter_resend_broadcasts.sql.
// ============================================================================

import type { DatosSync, ResumenSync, SuscriptorLocal } from "./sync.ts";

// Tipado estructural mínimo del cliente de supabase-js que se usa aquí.
// deno-lint-ignore no-explicit-any
type ClienteSupabase = any;

export type OrigenPasada = "panel" | "cron" | "envio";

export type InicioPasada =
  | { estado: "ok"; id: string }
  | { estado: "ocupado" }
  | { estado: "error"; mensaje: string };

/** Pasadas colgadas (la función murió a mitad) más viejas que esto se dan por terminadas. */
export const MINUTOS_PASADA_COLGADA = 15;

/** PostgREST devuelve como mucho 1.000 filas por petición: se pagina. */
const TAM_PAGINA = 1000;

export interface PasadaResend {
  id: string;
  origen: OrigenPasada;
  estado: "en_curso" | "ok" | "parcial" | "error";
  iniciada_at: string;
  terminada_at: string | null;
  segment_id: string | null;
  contactos_resend: number | null;
  contactos_segmento: number | null;
  contactos_ajenos: number | null;
  destinatarios: number | null;
  altas: number;
  actualizados: number;
  borrados: number;
  bajas_resend: number;
  errores: number;
  pendientes: number;
  mensaje_error: string | null;
}

export class RepositorioNewsletterResend implements DatosSync {
  constructor(private readonly db: ClienteSupabase) {}

  async leerSuscriptores(): Promise<SuscriptorLocal[]> {
    const filas: SuscriptorLocal[] = [];
    for (let desde = 0; ; desde += TAM_PAGINA) {
      const { data, error } = await this.db
        .from("newsletter_suscriptores")
        .select("id, email, nombre, activo, resend_contact_id")
        .order("id", { ascending: true })
        .range(desde, desde + TAM_PAGINA - 1);
      if (error) throw new Error(mensajeTabla(error));
      const pagina = (data ?? []) as SuscriptorLocal[];
      filas.push(...pagina);
      if (pagina.length < TAM_PAGINA) return filas;
    }
  }

  async leerSuprimidas(): Promise<Set<string>> {
    // Best-effort, como en el envío transaccional: si la tabla no existe se sigue.
    const { data, error } = await this.db.from("direcciones_email_suprimidas").select("email");
    if (error) {
      console.warn("[newsletter-sync] no se pudo leer direcciones_email_suprimidas:", error.message);
      return new Set();
    }
    return new Set(((data ?? []) as { email: string }[]).map((f) => (f.email ?? "").trim().toLowerCase()).filter(Boolean));
  }

  async registrarBajaNativa(email: string): Promise<number> {
    const { data, error } = await this.db.rpc("newsletter_registrar_baja", {
      p_email: email,
      p_origen: "resend_baja_nativa",
      p_suscriptor_id: null,
    });
    if (error) throw new Error(`newsletter_registrar_baja: ${error.message}`);
    return typeof data === "number" ? data : 0;
  }

  async marcarSincronizados(items: { id: string; contact_id: string | null }[]): Promise<void> {
    if (items.length === 0) return;
    const { error } = await this.db.rpc("newsletter_marcar_sincronizados", { p_items: items });
    if (error) throw new Error(`newsletter_marcar_sincronizados: ${error.message}`);
  }

  /** Cierra pasadas colgadas y abre una nueva; si ya hay una en curso, "ocupado" (índice único parcial). */
  async iniciarPasada(origen: OrigenPasada, usuarioId: string | null, ahora: Date = new Date()): Promise<InicioPasada> {
    const limite = new Date(ahora.getTime() - MINUTOS_PASADA_COLGADA * 60_000).toISOString();
    const { error: errCierre } = await this.db
      .from("newsletter_sincronizaciones_resend")
      .update({ estado: "error", terminada_at: ahora.toISOString(), mensaje_error: "Pasada abandonada (la función terminó sin cerrarla)" })
      .eq("estado", "en_curso")
      .lt("iniciada_at", limite);
    if (errCierre) return { estado: "error", mensaje: mensajeTabla(errCierre) };

    const { data, error } = await this.db
      .from("newsletter_sincronizaciones_resend")
      .insert({ origen, ejecutada_por: usuarioId })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return { estado: "ocupado" };
      return { estado: "error", mensaje: mensajeTabla(error) };
    }
    return { estado: "ok", id: data.id as string };
  }

  async terminarPasada(id: string, r: ResumenSync): Promise<void> {
    const { error } = await this.db
      .from("newsletter_sincronizaciones_resend")
      .update(filaResumen(r))
      .eq("id", id);
    if (error) console.error("[newsletter-sync] no se pudo cerrar la pasada", id, error.message);
  }

  async ultimaPasada(soloTerminadas = false): Promise<PasadaResend | null> {
    let q = this.db
      .from("newsletter_sincronizaciones_resend")
      .select(
        "id, origen, estado, iniciada_at, terminada_at, segment_id, contactos_resend, contactos_segmento, contactos_ajenos, destinatarios, altas, actualizados, borrados, bajas_resend, errores, pendientes, mensaje_error",
      )
      .order("iniciada_at", { ascending: false })
      .limit(1);
    if (soloTerminadas) q = q.neq("estado", "en_curso");
    const { data, error } = await q;
    if (error) throw new Error(mensajeTabla(error));
    return ((data ?? [])[0] as PasadaResend | undefined) ?? null;
  }
}

/** Fila de newsletter_sincronizaciones_resend a partir del resumen. `detalle` sin emails (solo ids de suscriptor). */
export function filaResumen(r: ResumenSync, terminadaAt: Date = new Date()): Record<string, unknown> {
  return {
    estado: r.estado,
    terminada_at: terminadaAt.toISOString(),
    segment_id: r.segmentId,
    contactos_resend: r.contactosResend,
    contactos_segmento: r.contactosSegmento,
    contactos_ajenos: r.ajenos,
    destinatarios: r.destinatarios,
    altas: r.altas,
    actualizados: r.actualizados + r.anadidosSegmento,
    borrados: r.borrados,
    bajas_resend: r.bajasResend,
    errores: r.errores.length,
    pendientes: r.pendientes,
    mensaje_error: r.mensajeError,
    detalle: {
      bloquea_envio: r.bloqueaEnvio,
      segmento_creado: r.segmentoCreado,
      anadidos_segmento: r.anadidosSegmento,
      quitados_segmento: r.quitadosSegmento,
      peticiones: r.peticiones,
      errores: r.errores.slice(0, 50),
    },
  };
}

function mensajeTabla(error: { message?: string; code?: string }): string {
  const m = error?.message ?? String(error);
  if (error?.code === "42P01" || /newsletter_sincronizaciones_resend|does not exist|resend_contact_id/i.test(m)) {
    return `Falta la migración 20261003193000_newsletter_resend_broadcasts.sql (${m})`;
  }
  return m;
}
