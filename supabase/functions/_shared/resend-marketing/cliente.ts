// ============================================================================
// Cliente REST de Resend Marketing (Contacts, Segments, Broadcasts) — sin SDK
// ----------------------------------------------------------------------------
// POR QUÉ fetch directo y no el SDK: el repo usa `https://esm.sh/resend@2.0.0`
// (enviar-newsletter, correos de reserva), que es anterior a la Contacts API
// global, a los Segments y a `segment_id` en Broadcasts (el SDK actual es la
// v6). Subir el SDK tocaría los correos de reserva; este cliente es pequeño,
// tipado aquí y testeable con un fetch falso (los tests NUNCA llaman a Resend).
//
// Endpoints (docs oficiales consultadas el 2026-10-03, resend.com/docs/api-reference):
//   GET    /contacts?limit=100&after=<id>            lista global (paginada)
//   GET    /segments/{segment_id}/contacts?limit&after  contactos de un Segment
//   GET    /contacts/{id|email}                      un contacto
//   POST   /contacts {email, first_name, segments:[{id}]}
//   PATCH  /contacts/{id|email} {first_name}         (NUNCA mandamos unsubscribed:false)
//   DELETE /contacts/{id|email}
//   POST   /contacts/{id|email}/segments/{segment_id}   añadir a Segment
//   DELETE /contacts/{id|email}/segments/{segment_id}   quitar de Segment
//   GET    /segments   ·  POST /segments {name}
//   POST   /broadcasts {segment_id, from, subject, html, name, send:false}
//   POST   /broadcasts/{id}/send
//   GET    /broadcasts/{id}                          estado (draft/queued/sent)
//
// LÍMITES: 10 peticiones/s por equipo (todas las claves juntas, también las de
// los correos de reserva). Aquí se van en serie a ≤ 8/s (LimitadorPeticiones)
// y un 429 `rate_limit_exceeded` se reintenta respetando `retry-after` (o con
// espera exponencial). Un 429 de CUOTA (`daily_quota_exceeded`,
// `monthly_quota_exceeded`) NO se reintenta: no se arregla esperando un segundo.
// ============================================================================

import { PETICIONES_POR_SEGUNDO } from "./config.ts";

export const RESEND_API_URL = "https://api.resend.com";

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number;
  ok: boolean;
  headers: { get(nombre: string): string | null };
  text(): Promise<string>;
}>;

export type ResultadoResend<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; tipo: string; mensaje: string };

export interface ContactoResend {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  unsubscribed: boolean;
  created_at?: string;
}

export interface SegmentoResend {
  id: string;
  name: string;
  created_at?: string;
}

interface Lista<T> {
  object?: string;
  has_more?: boolean;
  data?: T[];
}

// ---------------------------------------------------------------------------
// Ritmo: como mucho N peticiones por segundo (en serie)
// ---------------------------------------------------------------------------

export class LimitadorPeticiones {
  private siguiente = 0;
  private readonly intervalo: number;

  constructor(
    porSegundo: number = PETICIONES_POR_SEGUNDO,
    private readonly ahora: () => number = () => Date.now(),
    private readonly dormir: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    this.intervalo = Math.ceil(1000 / Math.max(1, porSegundo));
  }

  /** Espera lo justo para que entre dos peticiones haya al menos 1000/N ms. */
  async esperarTurno(): Promise<void> {
    const t = this.ahora();
    const espera = this.siguiente - t;
    if (espera > 0) await this.dormir(espera);
    this.siguiente = Math.max(t, this.siguiente) + this.intervalo;
  }
}

// ---------------------------------------------------------------------------
// Clasificación de errores y espera entre reintentos
// ---------------------------------------------------------------------------

/** Tipos de 429 que son CUOTA (no se arreglan reintentando). */
const TIPOS_CUOTA = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

export interface ErrorClasificado {
  tipo: string;
  mensaje: string;
  reintentable: boolean;
}

/** Lee el cuerpo de error de Resend ({statusCode, name, message}) y decide si tiene sentido reintentar. */
export function clasificarError(status: number, cuerpo: unknown, reintentar5xx: boolean): ErrorClasificado {
  const c = (cuerpo && typeof cuerpo === "object" ? cuerpo : {}) as Record<string, unknown>;
  const tipo = typeof c.name === "string" ? c.name : typeof c.type === "string" ? c.type : `http_${status}`;
  const mensaje = typeof c.message === "string" && c.message ? c.message : `Resend respondió ${status}`;
  let reintentable = false;
  if (status === 429) reintentable = !TIPOS_CUOTA.has(tipo);
  else if (status === 409 && (tipo === "resource_locked" || tipo === "concurrent_idempotent_requests")) reintentable = true;
  else if (status >= 500 || status === 0) reintentable = reintentar5xx;
  return { tipo, mensaje, reintentable };
}

/**
 * Espera antes del reintento `intento` (1, 2, 3…): `retry-after` (segundos) si
 * Resend lo manda; si no, 1 s, 2 s, 4 s… con un poco de azar, hasta `maxMs`.
 */
export function esperaReintento(intento: number, retryAfter: string | null, maxMs = 10_000, azar: () => number = Math.random): number {
  const ra = retryAfter !== null ? Number(retryAfter) : NaN;
  if (Number.isFinite(ra) && ra >= 0) return Math.min(maxMs, Math.ceil(ra * 1000) + 50);
  const base = 1000 * 2 ** Math.max(0, intento - 1);
  return Math.min(maxMs, base + Math.floor(azar() * 250));
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------

export interface OpcionesCliente {
  apiKey: string;
  fetch?: FetchLike;
  limitador?: LimitadorPeticiones;
  dormir?: (ms: number) => Promise<void>;
  maxReintentos?: number;
  /** Tiempo máximo de cada petición (ms). */
  timeoutMs?: number;
  baseUrl?: string;
  log?: (msg: string) => void;
}

interface OpcionesPeticion {
  /** Reintentar 5xx y errores de red. Por defecto sí en GET/PATCH/DELETE y no en POST (podría duplicar). */
  reintentar5xx?: boolean;
}

/** Máximo de páginas al listar (100 por página): 50.000 contactos, muy por encima del plan. */
const MAX_PAGINAS = 500;

export class ClienteResendMarketing {
  private readonly fetchFn: FetchLike;
  private readonly limitador: LimitadorPeticiones;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly maxReintentos: number;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;
  private readonly log: (msg: string) => void;
  /** Peticiones HTTP hechas (incluidos reintentos): para el resumen y los tests. */
  peticiones = 0;

  constructor(private readonly opciones: OpcionesCliente) {
    if (!opciones.apiKey) throw new Error("Falta la API key de Resend Marketing (RESEND_MARKETING_API_KEY)");
    this.fetchFn = opciones.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.dormir = opciones.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.limitador = opciones.limitador ?? new LimitadorPeticiones(PETICIONES_POR_SEGUNDO, () => Date.now(), this.dormir);
    this.maxReintentos = opciones.maxReintentos ?? 4;
    this.timeoutMs = opciones.timeoutMs ?? 15_000;
    this.baseUrl = opciones.baseUrl ?? RESEND_API_URL;
    this.log = opciones.log ?? ((m) => console.log(m));
  }

  async peticion<T>(metodo: string, ruta: string, cuerpo?: unknown, op: OpcionesPeticion = {}): Promise<ResultadoResend<T>> {
    const reintentar5xx = op.reintentar5xx ?? metodo !== "POST";
    let intento = 0;
    for (;;) {
      await this.limitador.esperarTurno();
      this.peticiones++;
      let status = 0;
      let texto = "";
      let retryAfter: string | null = null;
      try {
        const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
        const t = ctrl ? setTimeout(() => ctrl.abort(), this.timeoutMs) : null;
        try {
          const res = await this.fetchFn(`${this.baseUrl}${ruta}`, {
            method: metodo,
            headers: {
              Authorization: `Bearer ${this.opciones.apiKey}`,
              "Content-Type": "application/json",
              "User-Agent": "casa-tomas-newsletter/1.0",
            },
            body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
            signal: ctrl?.signal,
          });
          status = res.status;
          retryAfter = res.headers.get("retry-after");
          texto = await res.text();
        } finally {
          if (t) clearTimeout(t);
        }
      } catch (e) {
        status = 0;
        texto = JSON.stringify({ name: "network_error", message: e instanceof Error ? e.message : String(e) });
      }

      let json: unknown = null;
      try {
        json = texto ? JSON.parse(texto) : null;
      } catch {
        json = null;
      }

      if (status >= 200 && status < 300) return { ok: true, status, data: json as T };

      const err = clasificarError(status, json, reintentar5xx);
      if (err.reintentable && intento < this.maxReintentos) {
        intento++;
        const espera = esperaReintento(intento, retryAfter);
        this.log(`[resend-marketing] ${metodo} ${ruta.split("?")[0]} -> ${status} ${err.tipo}; reintento ${intento}/${this.maxReintentos} en ${espera} ms`);
        await this.dormir(espera);
        continue;
      }
      return { ok: false, status, tipo: err.tipo, mensaje: err.mensaje };
    }
  }

  private async listarTodo<T extends { id: string }>(rutaBase: string): Promise<ResultadoResend<T[]>> {
    const todos: T[] = [];
    let after: string | null = null;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const qs: string = `limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`;
      const r: ResultadoResend<Lista<T>> = await this.peticion<Lista<T>>("GET", `${rutaBase}?${qs}`);
      if (!r.ok) return r;
      const datos: T[] = Array.isArray(r.data?.data) ? r.data!.data! : [];
      todos.push(...datos);
      if (!r.data?.has_more || datos.length === 0) return { ok: true, status: r.status, data: todos };
      after = datos[datos.length - 1].id;
    }
    return { ok: false, status: 0, tipo: "demasiadas_paginas", mensaje: `Más de ${MAX_PAGINAS * 100} elementos en ${rutaBase}` };
  }

  listarContactos() {
    return this.listarTodo<ContactoResend>("/contacts");
  }

  listarContactosSegmento(segmentId: string) {
    return this.listarTodo<ContactoResend>(`/segments/${encodeURIComponent(segmentId)}/contacts`);
  }

  listarSegmentos() {
    return this.listarTodo<SegmentoResend>("/segments");
  }

  crearSegmento(nombre: string) {
    return this.peticion<{ id: string; name?: string }>("POST", "/segments", { name: nombre });
  }

  obtenerContacto(idOEmail: string) {
    return this.peticion<ContactoResend>("GET", `/contacts/${encodeURIComponent(idOEmail)}`);
  }

  /** Crea el contacto ya dentro del Segment. Sin `unsubscribed`: nunca re-suscribimos a nadie desde aquí. */
  crearContacto(email: string, nombre: string | null, segmentId: string) {
    const cuerpo: Record<string, unknown> = { email, segments: [{ id: segmentId }] };
    if (nombre) cuerpo.first_name = nombre;
    return this.peticion<{ id: string }>("POST", "/contacts", cuerpo, { reintentar5xx: true });
  }

  actualizarNombre(contactId: string, nombre: string) {
    return this.peticion<{ id: string }>("PATCH", `/contacts/${encodeURIComponent(contactId)}`, { first_name: nombre });
  }

  borrarContacto(idOEmail: string) {
    return this.peticion<{ deleted?: boolean }>("DELETE", `/contacts/${encodeURIComponent(idOEmail)}`);
  }

  anadirASegmento(contactId: string, segmentId: string) {
    return this.peticion<{ id: string }>(
      "POST",
      `/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`,
      undefined,
      { reintentar5xx: true },
    );
  }

  quitarDeSegmento(contactId: string, segmentId: string) {
    return this.peticion<unknown>("DELETE", `/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`);
  }

  /** Crea el Broadcast como BORRADOR (send:false): el id se guarda antes de enviarlo. */
  crearBroadcast(b: { segmentId: string; from: string; subject: string; html: string; name: string; replyTo?: string | null }) {
    const cuerpo: Record<string, unknown> = {
      segment_id: b.segmentId,
      from: b.from,
      subject: b.subject,
      html: b.html,
      name: b.name,
      send: false,
    };
    if (b.replyTo) cuerpo.reply_to = b.replyTo;
    // Sin reintento en 5xx: un borrador duplicado no se envía, pero tampoco hace falta.
    return this.peticion<{ id: string }>("POST", "/broadcasts", cuerpo, { reintentar5xx: false });
  }

  /** Envía un Broadcast ya creado. Sin reintento en 5xx/red: podría salir dos veces. */
  enviarBroadcast(broadcastId: string) {
    return this.peticion<{ id: string }>("POST", `/broadcasts/${encodeURIComponent(broadcastId)}/send`, {}, { reintentar5xx: false });
  }

  /** Estado de un Broadcast ('draft' | 'queued' | 'sent' …): para saber si salió tras una respuesta dudosa. */
  obtenerBroadcast(broadcastId: string) {
    return this.peticion<{ id: string; status?: string; sent_at?: string | null }>("GET", `/broadcasts/${encodeURIComponent(broadcastId)}`);
  }
}

/** true si el error de Resend significa "no existe" (borrar algo que ya no está = hecho). */
export function esNoEncontrado(r: { ok: boolean; status: number }): boolean {
  return !r.ok && r.status === 404;
}
