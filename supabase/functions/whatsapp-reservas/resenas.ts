// ============================================================================
// WHATSAPP-RESERVAS — petición de reseña después de comer (lógica pura)
// ============================================================================
// Dueño (25/11/2026): «que si han reservado a las 14, a las 17 les llegue otro
// mensaje para que dejen una reseña». Regla general: HORA DE LA RESERVA + 3 h,
// sin escribir de noche (si cae después de las 22:00, al día siguiente a las
// 12:00). Una sola vez por reserva (tabla `whatsapp_resenas`, migración
// 20261222100000; su función SQL `whatsapp_resena_momento` calcula LO MISMO
// que `momentoResena` y lo comprueba scripts/test-whatsapp-resenas.mjs).
//
// A quién: reservas 'confirmada' o 'completada' de Casa Tomás con un móvil
// válido. Por defecto SOLO a quien eligió WhatsApp para los avisos de su
// reserva (`canal_avisos = 'whatsapp'`): Meta exige que el cliente haya
// aceptado recibir WhatsApp del negocio («you can only send messages to
// WhatsApp users who have opted in»). Con WHATSAPP_RESENAS_DESTINATARIOS=todos
// se manda a todas las reservas con móvil (decisión del dueño, con ese riesgo).
// ============================================================================

import { instanteMadridAFechaUtc } from "../emails-reserva/tiempo.ts";
import {
  fechaParaMensaje,
  limpiarVariable,
  negocioDeMarca,
  telefonoParaWhatsApp,
  type DefinicionPlantilla,
  type ReservaParaWhatsApp,
} from "./logica.ts";

/** place_id de la ficha de Google de Casa Tomás (el mismo de la web y de config_google_places). */
export const PLACE_ID_CASA_TOMAS = "ChIJsS3PCWq5Yw0RL0gH6hiZvu0";

export const URL_RESENA_GOOGLE = "https://search.google.com/local/writereview?placeid=";

export function placeIdValido(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(v);
}

/** Enlace para escribir una reseña en la ficha de Google. */
export function enlaceResena(placeId: string): string {
  return `${URL_RESENA_GOOGLE}${encodeURIComponent(placeId)}`;
}

/**
 * Plantilla de Meta. Categoría UTILITY: según las guías de Meta, una encuesta
 * de opinión sobre una visita CONCRETA del cliente puede ser de utilidad
 * («Specificity of the order or interaction ... is necessary»), por eso lleva
 * la fecha y nada promocional. Si Meta la clasifica como marketing, la cobra
 * como tal (el webhook lo dice y Servicios lo cuenta).
 */
export function plantillaResena(placeIdEjemplo: string = PLACE_ID_CASA_TOMAS): DefinicionPlantilla {
  return {
    tipo: "resena",
    nombre: "resena_tras_visita",
    categoria: "UTILITY",
    cuerpo:
      "Hola {{1}}, gracias por venir a {{2}} el {{3}}.\n\n" +
      "¿Qué tal fue tu visita? Si tienes un minuto, nos ayudaría mucho que nos dejaras tu opinión en Google. ¡Gracias!",
    ejemplo: ["Ana", "Casa Tomás", "martes 24 de noviembre"],
    botones: [
      { tipo: "url", texto: "Dejar mi opinión", url: `${URL_RESENA_GOOGLE}{{1}}`, ejemploSufijo: placeIdEjemplo, sufijo: "resena" },
    ],
  };
}

export function variablesResena(r: Pick<ReservaParaWhatsApp, "nombre" | "fecha" | "marca">): string[] {
  const nombre = limpiarVariable((r.nombre ?? "").trim().split(/\s+/)[0], "👋", 40);
  return [nombre, negocioDeMarca(r.marca).nombre, fechaParaMensaje(r.fecha)];
}

// ----------------------------------------------------------------------------
// Cuándo
// ----------------------------------------------------------------------------

export interface ReglasResena {
  /** Horas después de la hora de la reserva. */
  horasDespues: number;
  /** Más tarde de esta hora no se escribe: pasa al día siguiente. */
  horaMaxima: string;
  /** Antes de esta hora tampoco (no pasa con reservas normales). */
  horaMinima: string;
  /** Hora del día siguiente si cae de noche. */
  horaDiaSiguiente: string;
  /** Si por lo que sea no salió a su hora, se manda hasta estas horas después; luego ya no. */
  ventanaHoras: number;
}

export const REGLAS_RESENA: ReglasResena = {
  horasDespues: 3,
  horaMaxima: "22:00",
  horaMinima: "10:00",
  horaDiaSiguiente: "12:00",
  ventanaHoras: 12,
};

function minutosDe(hora: string): number {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora || "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

function horaDe(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

function diaSiguiente(fechaIso: string): string {
  const d = new Date(`${fechaIso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Fecha y hora de Madrid a las que toca pedir la reseña. */
export function momentoResenaLocal(fecha: string, hora: string, reglas: ReglasResena = REGLAS_RESENA): { fecha: string; hora: string } {
  const total = minutosDe(hora) + Math.round(reglas.horasDespues * 60);
  if (total > minutosDe(reglas.horaMaxima)) return { fecha: diaSiguiente(fecha), hora: reglas.horaDiaSiguiente };
  if (total < minutosDe(reglas.horaMinima)) return { fecha: fecha.slice(0, 10), hora: reglas.horaMinima };
  return { fecha: fecha.slice(0, 10), hora: horaDe(total) };
}

/** Instante (UTC) en que toca pedir la reseña. 14:00 → 17:00 de Madrid. */
export function momentoResena(fecha: string, hora: string, reglas: ReglasResena = REGLAS_RESENA): Date {
  const l = momentoResenaLocal(fecha, hora, reglas);
  return instanteMadridAFechaUtc(l.fecha, l.hora);
}

// ----------------------------------------------------------------------------
// A quién
// ----------------------------------------------------------------------------

export type DestinatariosResena = "whatsapp" | "todos";

/** WHATSAPP_RESENAS_DESTINATARIOS: 'todos' o, por defecto, solo quien eligió WhatsApp. */
export function destinatariosResena(valor: string | null | undefined): DestinatariosResena {
  return (valor ?? "").trim().toLowerCase() === "todos" ? "todos" : "whatsapp";
}

export interface ReservaParaResena extends ReservaParaWhatsApp {
  canal_avisos?: string | null;
}

export const ESTADOS_RESENA: readonly string[] = ["confirmada", "completada"];

export type DecisionResena =
  | { accion: "esperar"; momento: Date }
  | { accion: "enviar"; momento: Date; para: string }
  | { accion: "omitir"; momento: Date; motivo: string };

/**
 * Qué hacer con una reserva ahora. `esperar` no deja rastro (se mira en la
 * siguiente pasada); `omitir` y `enviar` se apuntan para no repetirla.
 */
export function decidirResena(
  r: ReservaParaResena,
  ahora: Date,
  opciones: { destinatarios?: DestinatariosResena; reglas?: ReglasResena } = {},
): DecisionResena {
  const reglas = opciones.reglas ?? REGLAS_RESENA;
  const momento = momentoResena(r.fecha, r.hora, reglas);
  if (ahora.getTime() < momento.getTime()) return { accion: "esperar", momento };
  if (ahora.getTime() > momento.getTime() + reglas.ventanaHoras * 3_600_000) return { accion: "omitir", momento, motivo: "fuera_de_plazo" };
  if (!ESTADOS_RESENA.includes(r.estado)) return { accion: "omitir", momento, motivo: `estado_${r.estado}` };
  if (negocioDeMarca(r.marca).marca !== "casa_tomas") return { accion: "omitir", momento, motivo: "marca_sin_plantillas_whatsapp" };
  if ((opciones.destinatarios ?? "whatsapp") === "whatsapp" && r.canal_avisos !== "whatsapp") {
    return { accion: "omitir", momento, motivo: "no_eligio_whatsapp" };
  }
  const para = telefonoParaWhatsApp(r.telefono);
  if (!para) return { accion: "omitir", momento, motivo: "telefono_no_valido" };
  return { accion: "enviar", momento, para };
}

/**
 * Meta rechaza la plantilla porque aún no existe aprobada (132001), está
 * pausada (132015) o desactivada (132016): no es culpa de la reserva, así que
 * no gasta su único intento (index.ts la vuelve a probar en la siguiente pasada).
 * `error` es el texto de llamarGraph: «código[/subcódigo]: mensaje».
 */
export function errorPlantillaNoDisponible(error: string | null | undefined): boolean {
  return /^1320(01|15|16)(\/|:|$)/.test((error ?? "").trim());
}

/** Días de Madrid que hay que mirar: la reserva de anoche puede tocar hoy a las 12:00. */
export function diasAMirar(hoyMadrid: string): { desde: string; hasta: string } {
  const d = new Date(`${hoyMadrid}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 2);
  return { desde: d.toISOString().slice(0, 10), hasta: hoyMadrid };
}
