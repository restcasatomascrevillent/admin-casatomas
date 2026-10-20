// ============================================================================
// ENLACES DE LOS CORREOS -> PÁGINAS DE LAS WEBS PÚBLICAS (lógica pura)
// ============================================================================
// Por qué existe (bug verificado en producción, 2026-09-24): Supabase fuerza
// `Content-Type: text/plain` + `nosniff` en las respuestas del dominio por
// defecto `*.supabase.co/functions/v1/...`, así que las páginas HTML que
// servía esta función (aceptar/rechazar propuesta, etc.) le llegaban al
// cliente como código fuente con mojibake. No se arregla con cabeceras.
//
// Solución: la página la sirve la web del negocio (Vercel, HTML de verdad):
//   Casa Tomás -> https://restaurantecasatomascrevillente.es/reserva/respuesta?token=...
//   Touza      -> https://touza-restaurant-website.vercel.app/reserva/respuesta?token=...
// y esa página habla con esta función por JSON:
//   POST /enlace/consultar  { token }  -> qué es, datos y en qué estado está (NO muta)
//   POST /enlace/ejecutar   { token }  -> ejecuta la acción (solo tras el clic del cliente)
// Las rutas GET antiguas (/aceptar, /rechazar, /propuesta/...) de correos ya
// enviados responden 302 a esa misma página con el mismo token.
//
// Dos pasos siempre (también para aceptar la contraoferta, que antes era de un
// paso): la acción es un POST lanzado por un clic; los escáneres de enlaces de
// los clientes de correo solo hacen GET, así que nunca ejecutan nada.
//
// Módulo PURO (sin Deno ni I/O) para poder testearlo con vitest.
// ============================================================================

import { NEGOCIOS, NEGOCIO_POR_DEFECTO, esMarcaValida, type Marca } from "../reservas-web/plantillas.ts";
import { verificarToken, huellaReservaCoincide, type AccionToken, type CargaToken } from "./tokens.ts";

/** Ruta de la página de respuesta en AMBAS webs (mismo componente). */
export const RUTA_RESPUESTA_WEB = "/reserva/respuesta";

/** Webs públicas por defecto (las que ya usan `VITE_SITE_URL` en cada repo). */
export const URL_WEB_POR_DEFECTO: Record<Marca, string> = {
  casa_tomas: "https://restaurantecasatomascrevillente.es",
  touza: "https://touza-restaurant-website.vercel.app",
};

const SIN_BARRA_FINAL = /\/+$/;

function limpiarBase(valor: string | undefined | null): string | null {
  const v = (valor ?? "").trim().replace(SIN_BARRA_FINAL, "");
  return /^https?:\/\/[^\s/]+/i.test(v) ? v : null;
}

/**
 * Base de cada web. Env (opcionales): `WEB_CASA_TOMAS_URL`, `WEB_TOUZA_URL`.
 * Un valor vacío o que no sea una URL http(s) se ignora (se usa el por defecto).
 */
export function basesWeb(env: { casaTomas?: string | null; touza?: string | null }): Record<Marca, string> {
  return {
    casa_tomas: limpiarBase(env.casaTomas) ?? URL_WEB_POR_DEFECTO.casa_tomas,
    touza: limpiarBase(env.touza) ?? URL_WEB_POR_DEFECTO.touza,
  };
}

export function marcaSegura(marca: unknown): Marca {
  return esMarcaValida(marca) ? marca : NEGOCIO_POR_DEFECTO;
}

/** `https://<web del negocio>/reserva/respuesta?token=<token>` */
export function enlaceRespuestaWeb(bases: Record<Marca, string>, marca: unknown, token: string): string {
  return `${bases[marcaSegura(marca)]}${RUTA_RESPUESTA_WEB}?token=${encodeURIComponent(token)}`;
}

// ----------------------------------------------------------------------------
// CORS de las rutas /enlace/* (solo las webs; el resto de rutas no cambia)
// ----------------------------------------------------------------------------

function origenDe(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Orígenes que pueden llamar a /enlace/*: los de las dos webs + la lista
 * `EMAILS_RESERVA_ORIGENES_EXTRA` (separada por comas; p.ej. una URL de
 * preview de Vercel o http://localhost:8080 para probar en local).
 */
export function origenesPermitidos(bases: Record<Marca, string>, extra?: string | null): string[] {
  const lista = [bases.casa_tomas, bases.touza, ...(extra ?? "").split(",")]
    .map((v) => origenDe(v.trim()))
    .filter((v): v is string => !!v);
  // Casa Tomás también se sirve con www.
  const conWww = lista.flatMap((o) => {
    const u = new URL(o);
    return u.hostname.startsWith("www.") ? [o] : [o, `${u.protocol}//www.${u.host}`];
  });
  return [...new Set(conWww)];
}

export function cabecerasCorsEnlace(origen: string | null, permitidos: readonly string[]): Record<string, string> {
  const cabeceras: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (origen && permitidos.includes(origen)) cabeceras["Access-Control-Allow-Origin"] = origen;
  return cabeceras;
}

// ----------------------------------------------------------------------------
// Token -> qué flujo es
// ----------------------------------------------------------------------------

const ACCIONES: readonly AccionToken[] = ["aceptar", "rechazar", "aceptar_solicitud", "rechazar_solicitud"];

/** Verifica el token contra las 4 acciones y devuelve la que casa (o null). */
export async function verificarTokenCualquierAccion(
  secreto: string,
  token: string,
  ahoraEpochSegundos?: number,
): Promise<CargaToken | null> {
  if (!secreto || typeof token !== "string" || token.length > 2048) return null;
  for (const accion of ACCIONES) {
    const carga = await verificarToken(secreto, token, accion, ahoraEpochSegundos);
    if (carga) return carga;
  }
  return null;
}

/** 'contraoferta' = sobre una reserva ya existente; 'propuesta' = sobre una solicitud del bot. */
export type TipoEnlace = "contraoferta" | "propuesta";
/** Lo que el cliente va a hacer, visto desde la web. */
export type AccionWeb = "aceptar" | "rechazar";

export function describirAccion(accion: AccionToken): { tipo: TipoEnlace; accion: AccionWeb } {
  return {
    tipo: accion === "aceptar" || accion === "rechazar" ? "contraoferta" : "propuesta",
    accion: accion === "aceptar" || accion === "aceptar_solicitud" ? "aceptar" : "rechazar",
  };
}

// ----------------------------------------------------------------------------
// Contrato JSON que consume la web (src/lib/respuesta-reserva.ts en cada web)
// ----------------------------------------------------------------------------

/**
 * - pendiente     -> (consultar) enseñar datos + botón
 * - hecho         -> la acción se ha hecho ahora (aceptar: reserva confirmada;
 *                    rechazar: rechazo registrado)
 * - recibida      -> aceptada, pero la reserva queda pendiente de revisión
 * - ya_hecho      -> ya estaba hecho (doble clic, enlace reutilizado)
 * - invalido      -> firma mala, caducado, o la propuesta ha cambiado
 * - sin_aforo     -> se llenó el turno mientras respondía ("te llamaremos")
 * - fecha_pasada  -> el día ya pasó
 * - error         -> fallo interno (el restaurante queda avisado)
 */
export type EstadoEnlace =
  | "pendiente"
  | "hecho"
  | "recibida"
  | "ya_hecho"
  | "invalido"
  | "sin_aforo"
  | "fecha_pasada"
  | "error";

export interface NegocioEnlace {
  marca: Marca;
  nombre: string;
  telefonoTexto: string;
  telefonoDigits: string;
  web: string;
}

export interface DetallesEnlace {
  nombre: string;
  /** yyyy-MM-dd */
  fecha: string;
  /** HH:MM */
  hora: string;
  comensales: number;
  espacio: string | null;
}

export interface RespuestaEnlace {
  ok: boolean;
  estado: EstadoEnlace;
  tipo: TipoEnlace | null;
  accion: AccionWeb | null;
  negocio: NegocioEnlace;
  detalles: DetallesEnlace | null;
}

export function negocioEnlace(marca: unknown, bases: Record<Marca, string>): NegocioEnlace {
  const m = marcaSegura(marca);
  const n = NEGOCIOS[m];
  return { marca: m, nombre: n.nombre, telefonoTexto: n.telefonoTexto, telefonoDigits: n.telefonoDigits, web: bases[m] };
}

/** Respuesta de "enlace no válido" (sin datos: no se filtra nada de un token malo). */
export function respuestaInvalida(bases: Record<Marca, string>, marca: unknown = NEGOCIO_POR_DEFECTO): RespuestaEnlace {
  return { ok: false, estado: "invalido", tipo: null, accion: null, negocio: negocioEnlace(marca, bases), detalles: null };
}

// ----------------------------------------------------------------------------
// Estado de un enlace de CONTRAOFERTA (reserva existente)
// ----------------------------------------------------------------------------

export interface ReservaParaEnlace {
  estado: string;
  hora: string;
  /** Ya no entra en la huella (reservas-sin-salas); se admite por compatibilidad. */
  espacio_id?: string | null;
}

/**
 * Estado "en frío" (antes de pulsar) de un token de contraoferta ya
 * verificado. Misma regla que las antiguas páginas HTML:
 *  - aceptar: vale si la reserva sigue 'verificada' con la misma huella; si
 *    ya está 'confirmada' -> ya_hecho.
 *  - rechazar: 'cancelada' -> ya_hecho (antes de mirar la huella, que ya no
 *    casaría); 'verificada' + huella -> pendiente.
 * La huella es estado + hora: asignar o cambiar la sala no invalida el enlace,
 * tampoco el de formato antiguo (ver huellaReservaCoincide en tokens.ts).
 */
export function estadoContraoferta(accion: AccionWeb, reserva: ReservaParaEnlace, huellaToken: string): EstadoEnlace {
  if (accion === "aceptar" && reserva.estado === "confirmada") return "ya_hecho";
  if (accion === "rechazar" && reserva.estado === "cancelada") return "ya_hecho";
  return reserva.estado === "verificada" && huellaReservaCoincide(huellaToken, reserva.estado, reserva.hora)
    ? "pendiente"
    : "invalido";
}

// ----------------------------------------------------------------------------
// Estado de un enlace de PROPUESTA (solicitud del bot)
// ----------------------------------------------------------------------------

export function estadoPropuesta(
  accion: AccionWeb,
  propuestaEstado: string | null | undefined,
  vigente: boolean,
): EstadoEnlace {
  if (accion === "aceptar" && propuestaEstado === "aceptada") return "ya_hecho";
  if (accion === "rechazar" && propuestaEstado === "rechazada") return "ya_hecho";
  return vigente ? "pendiente" : "invalido";
}

/** Resultado de fn_aceptar_propuesta_solicitud -> estado para la web. */
export function estadoTrasAceptarPropuesta(
  res: { ok?: boolean; error?: string; estado?: string; ya_aceptada?: boolean } | null,
): EstadoEnlace {
  if (!res) return "error";
  if (res.ok) {
    if (res.ya_aceptada) return "ya_hecho";
    return res.estado === "pendiente" ? "recibida" : "hecho";
  }
  switch (res.error) {
    case "sin_aforo":
      return "sin_aforo";
    case "fecha_pasada":
      return "fecha_pasada";
    case "propuesta_no_vigente":
    case "solicitud_cerrada":
    case "no_encontrada":
      return "invalido";
    default:
      return "error";
  }
}

/** Error de Postgres al confirmar una contraoferta -> estado. 23514 =
 * check_violation del trigger de aforo (validar_capacidad_reserva). */
export function estadoErrorConfirmarContraoferta(codigo: string | null | undefined, mensaje?: string | null): EstadoEnlace {
  if (codigo === "23514" || /aforo/i.test(mensaje ?? "")) return "sin_aforo";
  return "error";
}

/** Lee `{ token }` de un body JSON desconocido. */
export function tokenDelCuerpo(body: unknown): string | null {
  const token = (body as { token?: unknown } | null)?.token;
  return typeof token === "string" && token.length > 0 && token.length <= 2048 ? token : null;
}
