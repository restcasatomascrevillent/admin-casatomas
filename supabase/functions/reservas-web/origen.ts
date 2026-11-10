// ============================================================================
//  «Cómo se hizo la reserva» — columna `reservas.origen` (jsonb)
// ----------------------------------------------------------------------------
//  Pedido del dueño (2026-11-10): en cada reserva quiere ver a qué hora se hizo,
//  cuánto tiempo estuvo el cliente rellenando el formulario y desde dónde.
//
//  La web (ReservationForm.tsx, `src/lib/origen-reserva.ts` de web-casatomas)
//  manda en POST /crear un objeto `origen` OPCIONAL. Aquí:
//    · se VALIDA campo a campo con una lista blanca (lo desconocido se tira),
//      con tipos y longitudes máximas; si el objeto es enorme o no es un
//      objeto, se ignora ENTERO — nunca hace fallar la reserva;
//    · se añade lo que sabe el servidor: hora de recepción, User-Agent
//      completo (cortado a 400), dispositivo/navegador/sistema resumidos con
//      la MISMA clasificación que los logs web, la procedencia clasificada y
//      un HMAC de la IP (mismo hash con sal que el limitador de /crear; la IP
//      en claro no se guarda nunca).
//
//  Forma guardada (v1):
//    { v: 1,
//      cliente:  {...} | null,   // lo que dice el navegador: NO es fiable
//      servidor: {...} }         // lo que ve la función
//
//  RGPD: nada de nombre/teléfono/email aquí (ya están en la fila). Del
//  referente solo el HOST (la ruta puede llevar datos); de la página de
//  entrada solo la RUTA (sin query: los utm_* van aparte y saneados).
//  Sin Deno ni imports remotos: se prueba con vitest.
// ============================================================================

import { dispositivoDe, navegadorDe, soDe, clasificarProcedencia, type Procedencia } from "../_shared/logs-web/clasificacion.ts";
import { hostDe } from "../_shared/logs-web/saneado.ts";

/** Tamaño máximo del objeto `origen` que manda el navegador (JSON serializado). */
export const ORIGEN_MAX_BYTES = 4096;
/** Duración máxima creíble rellenando el formulario (2 días; más es una pestaña olvidada). */
export const DURACION_MAX_SEGUNDOS = 2 * 86_400;
const UA_MAX = 400;
const CAMPOS_FORMULARIO = new Set([
  "fecha",
  "numero_comensales",
  "hora",
  "nombre",
  "telefono",
  "email",
  "notas_cliente",
  "menu_del_dia",
  "acepta_condiciones",
  "consentimiento_newsletter",
]);

export interface OrigenCliente {
  formulario_abierto_at: string | null;
  primer_contacto_at: string | null;
  enviado_at: string | null;
  duracion_segundos: number | null;
  campos_cambiados: string[];
  consultas_disponibilidad: number | null;
  consultas_sin_hueco: number | null;
  intentos_fallidos: number | null;
  idioma: string | null;
  idioma_navegador: string | null;
  pagina_entrada: string | null;
  pagina_formulario: string | null;
  referente: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  qr: string | null;
  pantalla_ancho: number | null;
  pantalla_alto: number | null;
  tactil: boolean | null;
}

export interface OrigenServidor {
  recibido_at: string;
  user_agent: string | null;
  dispositivo: string;
  navegador: string | null;
  sistema: string | null;
  ip_hash: string | null;
  procedencia: Procedencia | null;
}

export interface OrigenReserva {
  v: 1;
  cliente: OrigenCliente | null;
  servidor: OrigenServidor;
}

// ─── Saneado de tipos ───────────────────────────────────────────────────────

const texto = (v: unknown, max: number, patron?: RegExp): string | null => {
  if (typeof v !== "string") return null;
  // Sin caracteres de control (ni saltos de línea): esto se pinta en el panel.
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  if (!s) return null;
  if (patron && !patron.test(s)) return null;
  return s;
};

const entero = (v: unknown, min: number, max: number): number | null => {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  const n = Math.round(v);
  return n < min || n > max ? null : n;
};

/** Fecha ISO válida entre 2020 y un día por delante de `ahora` (relojes adelantados). */
const instante = (v: unknown, ahora: Date): string | null => {
  if (typeof v !== "string" || v.length > 40) return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  if (t < Date.UTC(2020, 0, 1) || t > ahora.getTime() + 86_400_000) return null;
  return new Date(t).toISOString();
};

/** Solo la ruta (sin query ni fragmento), empezando por «/». */
const ruta = (v: unknown): string | null => {
  const s = texto(v, 300);
  if (!s) return null;
  try {
    const u = new URL(s, "https://x.invalid");
    const p = u.pathname.slice(0, 200);
    return /^\/[A-Za-z0-9/._~%-]*$/.test(p) ? p : null;
  } catch {
    return null;
  }
};

const RE_UTM = /^[\p{L}\p{N} ._:/+@-]+$/u;
const RE_IDIOMA = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/;

/**
 * Valida el objeto `origen` del navegador. Devuelve `null` si no viene, no es
 * un objeto o pasa de {@link ORIGEN_MAX_BYTES}. Nunca lanza.
 */
export function normalizarOrigenCliente(entrada: unknown, ahora: Date = new Date()): OrigenCliente | null {
  if (!entrada || typeof entrada !== "object" || Array.isArray(entrada)) return null;
  let tamano: number;
  try {
    tamano = new TextEncoder().encode(JSON.stringify(entrada)).length;
  } catch {
    return null;
  }
  if (tamano > ORIGEN_MAX_BYTES) return null;
  const e = entrada as Record<string, unknown>;

  const abierto = instante(e.formulario_abierto_at, ahora);
  const contacto = instante(e.primer_contacto_at, ahora);
  const enviado = instante(e.enviado_at, ahora);

  let duracion = entero(e.duracion_segundos, 0, DURACION_MAX_SEGUNDOS);
  // Si faltara, se calcula con las horas del propio navegador (mismo reloj).
  if (duracion === null && enviado && (contacto || abierto)) {
    const s = (Date.parse(enviado) - Date.parse((contacto ?? abierto)!)) / 1000;
    duracion = entero(s, 0, DURACION_MAX_SEGUNDOS);
  }

  const campos = Array.isArray(e.campos_cambiados)
    ? [...new Set(e.campos_cambiados.filter((c): c is string => typeof c === "string" && CAMPOS_FORMULARIO.has(c)))].slice(0, 20)
    : [];

  const pantalla = (e.pantalla && typeof e.pantalla === "object" ? e.pantalla : {}) as Record<string, unknown>;
  const ref = typeof e.referente === "string" ? hostDe(e.referente) : null;

  return {
    formulario_abierto_at: abierto,
    primer_contacto_at: contacto,
    enviado_at: enviado,
    duracion_segundos: duracion,
    campos_cambiados: campos,
    consultas_disponibilidad: entero(e.consultas_disponibilidad, 0, 1000),
    consultas_sin_hueco: entero(e.consultas_sin_hueco, 0, 1000),
    intentos_fallidos: entero(e.intentos_fallidos, 0, 1000),
    idioma: texto(e.idioma, 5, /^(es|en|fr)$/),
    idioma_navegador: texto(e.idioma_navegador, 20, RE_IDIOMA),
    pagina_entrada: ruta(e.pagina_entrada),
    pagina_formulario: ruta(e.pagina_formulario),
    referente: ref,
    utm_source: texto(e.utm_source, 80, RE_UTM),
    utm_medium: texto(e.utm_medium, 80, RE_UTM),
    utm_campaign: texto(e.utm_campaign, 120, RE_UTM),
    utm_term: texto(e.utm_term, 80, RE_UTM),
    utm_content: texto(e.utm_content, 80, RE_UTM),
    qr: texto(e.qr, 60, RE_UTM),
    pantalla_ancho: entero(pantalla.ancho, 1, 20_000),
    pantalla_alto: entero(pantalla.alto, 1, 20_000),
    tactil: typeof e.tactil === "boolean" ? e.tactil : null,
  };
}

/**
 * Objeto completo para `reservas.origen`: lo del navegador (si vino y es
 * válido) más lo que sabe la función. Sin `origen` (web antigua, pruebas)
 * se guarda igualmente la parte del servidor.
 */
export function construirOrigenReserva(
  entrada: unknown,
  servidor: { recibidoAt: Date; userAgent: string | null; ipHash: string | null },
): OrigenReserva {
  const cliente = normalizarOrigenCliente(entrada, servidor.recibidoAt);
  const ua = texto(servidor.userAgent, UA_MAX);
  const procedencia = cliente
    ? clasificarProcedencia({
        referente: cliente.referente,
        utm_source: cliente.utm_source,
        utm_medium: cliente.utm_medium,
        utm_campaign: cliente.utm_campaign,
        qr: cliente.qr,
      })
    : null;
  return {
    v: 1,
    cliente,
    servidor: {
      recibido_at: servidor.recibidoAt.toISOString(),
      user_agent: ua,
      dispositivo: dispositivoDe(ua, cliente?.tactil ?? null),
      navegador: navegadorDe(ua),
      sistema: soDe(ua),
      // 16 caracteres bastan para ver «misma conexión» entre reservas sin
      // guardar el hash entero que usa el limitador.
      ip_hash: servidor.ipHash ? servidor.ipHash.slice(0, 16) : null,
      procedencia,
    },
  };
}
