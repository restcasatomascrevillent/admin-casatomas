// ============================================================================
//  analizar-peticion / linear.ts — «Enviar a Linear» (Super Admin › Tickets)
// ----------------------------------------------------------------------------
//  14/11/2026. El super admin pulsa «Enviar a Linear» en un ticket y aquí se
//  crea la incidencia en el equipo (y proyecto) de Logs › Configuración ›
//  Linear, con el mismo cliente que los tickets de Logs
//  (procesar-logs-web/linear.ts: reintentos y errores en español).
//
//  · Título = el de la petición. Prioridad: urgente 1 · alta 2 · normal 3 ·
//    baja 4. Descripción en markdown y en castellano: «En pocas palabras»,
//    quién (solo el nombre que ya enseña el panel; nunca un email), cuándo y
//    desde qué módulo, lo que escribió, la tarea propuesta, los pasos, los
//    criterios de aceptación, el riesgo, el prompt para la IA (en un bloque de
//    código) y el enlace al ticket del panel.
//  · Etiquetas: las de la configuración y, si existen en Linear, la del tipo
//    (error → «Bug»; mejora → «Improvement»/«Feature»; duda → «Question»).
//  · SIN DUPLICADOS: el id de la incidencia sale de un hash del id de la
//    petición (UUID v4 determinista). Un doble clic o un reintento chocan con
//    ese id y se recupera la incidencia que ya existe, como en Logs.
//  · Modos (linear_modo): «desactivado» → no envía y lo dice; «prueba» → la
//    guarda en el destino de pruebas (web_linear_prueba) y no toca Linear;
//    «real» → Linear, con el equipo elegido (si no, pide elegirlo).
//  · Con éxito real guarda en la petición linear_id (identificador, p. ej.
//    «CAS-12») y linear_url, y si estaba «Recibida» o «En análisis» la pasa a
//    «Aceptada». Una petición ya enviada no se vuelve a enviar.
//
//  Sin Deno ni imports remotos: se prueba con vitest y un Linear simulado.
// ============================================================================

import {
  caminoDeRuta,
  ETIQUETA_REPO,
  ETIQUETA_RIESGO,
  ETIQUETA_TIPO,
  etiquetaModulo,
  etiquetaPrioridad,
  normalizarAnalisis,
  tipoDispositivo,
  type PrioridadPeticion,
  type TipoPeticion,
} from "../_shared/peticiones.ts";
import { crearClienteLinear, crearDestinoLinear, ErrorLinear, MENSAJES_LINEAR, type FetchLike } from "../procesar-logs-web/linear.ts";

/** Prioridad de Linear: 1 urgente, 2 alta, 3 normal, 4 baja. */
export const PRIORIDAD_LINEAR: Record<PrioridadPeticion, number> = { urgente: 1, alta: 2, normal: 3, baja: 4 };

export function prioridadLinearDePeticion(p: string | null | undefined): number {
  return PRIORIDAD_LINEAR[p as PrioridadPeticion] ?? 3;
}

/**
 * Id de la incidencia en Linear para una petición: UUID v4 sacado de un hash
 * del id de la petición. Siempre el mismo para la misma petición (y distinto
 * del propio id), así que reintentar nunca crea otra.
 */
export async function uuidLinearDePeticion(peticionId: string): Promise<string> {
  const datos = new TextEncoder().encode(`casa-tomas/peticion/${peticionId.trim().toLowerCase()}`);
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", datos)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40; // versión 4
  b[8] = (b[8] & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const MENSAJES_ENVIO = {
  desactivado: "Linear está desactivado. Para enviar tickets, actívalo en Logs › Configuración › Linear (modo real).",
  sinEquipo: "Elige el equipo en Logs › Configuración › Linear.",
  sinConfig: "No se ha podido leer la configuración de Linear. Prueba otra vez en un momento.",
  analizando: "La IA aún está analizando este ticket. Espera a que termine y vuelve a enviarlo.",
  descartada: "Este ticket está descartado. Si quieres enviarlo a Linear, acéptalo primero.",
} as const;

/** Lo que hace falta de la petición para crear la incidencia. */
export interface PeticionParaLinear {
  id: string;
  titulo: string;
  prioridad: string;
  modulo: string;
  descripcion: string;
  ruta: string | null;
  dispositivo: string | null;
  captura_path: string | null;
  creado_por_nombre: string | null;
  created_at: string | null;
  estado: string;
  analisis: unknown;
  analisis_estado: string;
  linear_id: string | null;
  linear_url: string | null;
}

/** Nombre de quien la envió tal como lo enseña el panel, pero nunca un email (sale «Un usuario del panel»). */
export function nombreParaLinear(nombre: string | null | undefined): string {
  const s = (nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!s || s.includes("@")) return "Un usuario del panel";
  return s;
}

function fechaMadrid(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Bloque de código que no se rompe aunque el texto traiga ``` dentro. */
function bloqueCodigo(texto: string, lenguaje = ""): string {
  const largoMax = Math.max(0, ...Array.from(texto.matchAll(/`+/g), (m) => m[0].length));
  const valla = "`".repeat(Math.max(3, largoMax + 1));
  return `${valla}${lenguaje}\n${texto}\n${valla}`;
}

const cita = (texto: string) => texto.split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n");
const sinSaltos = (texto: string) => texto.replace(/\s+/g, " ").trim();

/** Enlace a la ficha del ticket en el panel (lo abre directamente). */
export function urlTicketPanel(urlPanel: string, peticionId: string): string {
  return `${urlPanel.replace(/\/+$/, "")}/super-admin/tickets?ticket=${encodeURIComponent(peticionId)}`;
}

/** Descripción de la incidencia (markdown, en castellano). */
export function cuerpoLinear(p: PeticionParaLinear, urlTicket: string): string {
  const a = normalizarAnalisis(p.analisis);
  const partes: string[] = [];

  partes.push("## En pocas palabras");
  partes.push(a ? a.resumen : "_La IA no ha podido analizar este ticket: abajo va lo que escribió quien lo envió._");

  const camino = caminoDeRuta(p.ruta);
  const dispositivo = p.dispositivo ? tipoDispositivo(p.dispositivo) : "";
  const desde = [camino ? `\`${camino}\`` : "", dispositivo && dispositivo !== "desconocido" ? dispositivo : ""].filter(Boolean).join(" · ");
  const ficha = [
    `- **Enviado por:** ${nombreParaLinear(p.creado_por_nombre)}${fechaMadrid(p.created_at) ? ` · ${fechaMadrid(p.created_at)}` : ""}`,
    `- **Módulo:** ${etiquetaModulo(p.modulo)}${desde ? ` (desde ${desde})` : ""}`,
    `- **Prioridad:** ${etiquetaPrioridad(p.prioridad) || "Normal"}${a ? ` · **Tipo:** ${ETIQUETA_TIPO[a.tipo]} · **Repositorio:** ${ETIQUETA_REPO[a.repo]}` : ""}`,
  ];
  partes.push(ficha.join("\n"));

  partes.push("## Lo que ha escrito");
  partes.push(cita(p.descripcion.trim()));
  if (p.captura_path) partes.push("_Adjuntó una captura: está en la ficha del ticket del panel._");

  if (a) {
    partes.push("## Tarea propuesta");
    partes.push(a.tarea_propuesta);
    if (a.modulos_afectados.length) partes.push(`**Partes afectadas:** ${a.modulos_afectados.map(sinSaltos).join(", ")}`);
    if (a.pasos.length) {
      partes.push("## Pasos");
      partes.push(a.pasos.map((x, i) => `${i + 1}. ${sinSaltos(x)}`).join("\n"));
    }
    if (a.criterios_aceptacion.length) {
      partes.push("## Criterios de aceptación");
      partes.push(a.criterios_aceptacion.map((x) => `- [ ] ${sinSaltos(x)}`).join("\n"));
    }
    partes.push("## Riesgo");
    partes.push(`**${ETIQUETA_RIESGO[a.riesgo.nivel]}**${a.riesgo.motivo ? ` · ${sinSaltos(a.riesgo.motivo)}` : ""}\n\nBase de datos: ${a.toca_bd ? "**sí** hay que tocarla" : "no hace falta tocarla"}.`);
    if (a.preguntas.length) {
      partes.push("## Preguntas para quien lo envió");
      partes.push(a.preguntas.map((x) => `- ${sinSaltos(x)}`).join("\n"));
    }
    partes.push("## Prompt para la IA");
    partes.push(bloqueCodigo(a.prompt_ia, "markdown"));
  }

  partes.push("---");
  partes.push(`[Ver el ticket en el panel](${urlTicket})`);
  return partes.join("\n\n");
}

/** Nombres de etiqueta de Linear que corresponden a cada tipo (se usan solo si existen). */
export const ETIQUETAS_POR_TIPO: Record<TipoPeticion, readonly string[]> = {
  error: ["Bug", "Error"],
  mejora: ["Improvement", "Mejora", "Feature"],
  duda: ["Question", "Duda", "Pregunta"],
};

export interface EtiquetaLinear {
  id: string;
  name: string;
  isGroup?: boolean | null;
  team?: { id: string } | null;
}

/** Id de la etiqueta del tipo, si existe en el equipo o en todo el espacio de trabajo (nunca un grupo). */
export function etiquetaDeTipo(tipo: TipoPeticion | null, disponibles: EtiquetaLinear[], equipoId: string | null): string | null {
  if (!tipo) return null;
  const validas = disponibles.filter((l) => !l.isGroup && (!l.team || l.team.id === equipoId));
  for (const nombre of ETIQUETAS_POR_TIPO[tipo]) {
    const n = nombre.toLowerCase();
    // Mejor la del equipo que la de todo el espacio de trabajo.
    const candidata = validas.filter((l) => l.name.trim().toLowerCase() === n).sort((x, y) => Number(!!y.team) - Number(!!x.team))[0];
    if (candidata) return candidata.id;
  }
  return null;
}

export const QUERY_ETIQUETAS = `query EtiquetasTicketPanel {
  issueLabels(first: 250) { nodes { id name isGroup team { id } } }
}`;

export interface ConfigLinearPeticiones {
  linear_modo: "desactivado" | "prueba" | "real" | string;
  linear_equipo_id: string | null;
  linear_proyecto_id: string | null;
  linear_etiquetas: string[] | null;
}

/** Destino de pruebas (web_linear_prueba), sin incidencia de Logs. */
export interface RepoPruebaPeticion {
  buscarCreado(linearUuid: string): Promise<{ id: number } | null>;
  insertar(fila: {
    incidencia_id: null;
    operacion: "crear";
    linear_uuid: string;
    titulo: string;
    cuerpo: string;
    prioridad: number;
    etiquetas: string[];
  }): Promise<{ id: number }>;
}

export interface DepsEnvioLinear {
  leerConfig(): Promise<ConfigLinearPeticiones | null>;
  /** Guarda linear_id (identificador) y linear_url en la petición. */
  guardarEnviado(v: { linear_id: string; linear_url: string }): Promise<void>;
  /** «Recibida»/«En análisis» → «Aceptada». true si cambió. */
  aceptar(): Promise<boolean>;
  prueba: RepoPruebaPeticion;
  apiKey: string;
  urlPanel: string;
  fetchFn?: FetchLike;
  esperar?: (ms: number) => Promise<void>;
  log?: (m: string) => void;
}

export type ResultadoEnvioLinear =
  | { ok: true; destino: "real" | "prueba"; identificador: string; url: string | null; repetido: boolean; aceptada: boolean }
  | { ok: false; status: number; error: string };

const URL_LINEAR = /^https:\/\/\S+$/;

/** Crea (o recupera) la incidencia de Linear de una petición según el modo configurado. Nunca lanza. */
export async function enviarPeticionALinear(p: PeticionParaLinear, deps: DepsEnvioLinear): Promise<ResultadoEnvioLinear> {
  const log = deps.log ?? (() => {});
  // Ya enviada: no se toca Linear (el enlace ya está en la ficha).
  if (p.linear_url) {
    return { ok: true, destino: "real", identificador: p.linear_id ?? "Linear", url: p.linear_url, repetido: true, aceptada: false };
  }
  if (p.estado === "descartada") return { ok: false, status: 409, error: MENSAJES_ENVIO.descartada };
  if (p.analisis_estado === "analizando" || p.analisis_estado === "pendiente") return { ok: false, status: 409, error: MENSAJES_ENVIO.analizando };

  let config: ConfigLinearPeticiones | null;
  try {
    config = await deps.leerConfig();
  } catch (e) {
    log(`leer configuración de Linear: ${(e as Error)?.message ?? e}`);
    return { ok: false, status: 503, error: MENSAJES_ENVIO.sinConfig };
  }
  const modo = config?.linear_modo ?? "desactivado";
  if (!config || modo === "desactivado" || (modo !== "prueba" && modo !== "real")) return { ok: false, status: 409, error: MENSAJES_ENVIO.desactivado };

  const a = normalizarAnalisis(p.analisis);
  const id = await uuidLinearDePeticion(p.id);
  const titulo = p.titulo.trim().slice(0, 250);
  const descripcion = cuerpoLinear(p, urlTicketPanel(deps.urlPanel, p.id));
  const prioridad = prioridadLinearDePeticion(p.prioridad);
  const base = [...new Set((config.linear_etiquetas ?? []).filter((x) => typeof x === "string" && x.trim()))];

  if (modo === "prueba") {
    try {
      const fila = (await deps.prueba.buscarCreado(id)) ?? (await deps.prueba.insertar({
        incidencia_id: null, operacion: "crear", linear_uuid: id, titulo, cuerpo: descripcion, prioridad, etiquetas: base,
      }));
      return { ok: true, destino: "prueba", identificador: `PRUEBA-${fila.id}`, url: null, repetido: false, aceptada: false };
    } catch (e) {
      log(`destino de pruebas: ${(e as Error)?.message ?? e}`);
      return { ok: false, status: 503, error: "No se ha podido guardar en el destino de pruebas. Prueba otra vez en un momento." };
    }
  }

  // Modo real
  if (!deps.apiKey) return { ok: false, status: 503, error: MENSAJES_LINEAR.sinClave };
  if (!config.linear_equipo_id) return { ok: false, status: 409, error: MENSAJES_ENVIO.sinEquipo };

  const opciones = { apiKey: deps.apiKey, fetchFn: deps.fetchFn, esperar: deps.esperar };
  // Etiqueta del tipo, solo si existe (si no se puede leer la lista, se envía sin ella).
  let extra: string | null = null;
  if (a && ETIQUETAS_POR_TIPO[a.tipo]?.length) {
    try {
      const gql = crearClienteLinear({ ...opciones, intentos: 2, timeoutMs: 10_000 });
      const r = await gql<{ issueLabels?: { nodes?: EtiquetaLinear[] } | null }>(QUERY_ETIQUETAS);
      extra = etiquetaDeTipo(a.tipo, r?.issueLabels?.nodes ?? [], config.linear_equipo_id);
    } catch (e) {
      log(`etiquetas de Linear: ${(e as Error)?.message ?? e}`);
    }
  }
  const etiquetas = extra && !base.includes(extra) ? [...base, extra] : base;

  const destino = crearDestinoLinear(opciones);
  const datos = {
    id,
    equipoId: config.linear_equipo_id,
    proyectoId: config.linear_proyecto_id || null,
    titulo,
    descripcion,
    prioridad,
    etiquetas,
    incidenciaId: 0, // el destino real no lo usa (es de Logs)
  };
  let ticket;
  try {
    try {
      ticket = await destino.crear(datos);
    } catch (e) {
      // Si Linear rechaza la etiqueta del tipo (p. ej. choca con otra del mismo grupo), se reintenta sin ella.
      if (e instanceof ErrorLinear && e.codigo === "datos" && etiquetas.length !== base.length) ticket = await destino.crear({ ...datos, etiquetas: base });
      else throw e;
    }
  } catch (e) {
    const err = e instanceof ErrorLinear ? e : new ErrorLinear(MENSAJES_LINEAR.caido, true, null, "caido");
    log(`crear en Linear (${err.codigo}): ${err.message}`);
    const mensaje = err.reintentable ? `${err.message.replace(/ Se reintenta solo\./, "")} Prueba otra vez en unos minutos: no se duplicará.` : err.message;
    return { ok: false, status: 502, error: mensaje };
  }

  const identificador = ticket.identificador ?? ticket.id;
  const url = ticket.url && URL_LINEAR.test(ticket.url) ? ticket.url : null;
  if (!url) {
    return { ok: false, status: 502, error: `Linear ha creado la incidencia ${identificador}, pero no ha devuelto su enlace. Vuelve a pulsar «Enviar a Linear»: no se duplicará.` };
  }
  try {
    await deps.guardarEnviado({ linear_id: identificador.slice(0, 100), linear_url: url.slice(0, 500) });
  } catch (e) {
    log(`guardar el enlace de Linear: ${(e as Error)?.message ?? e}`);
    return { ok: false, status: 503, error: `Se ha creado en Linear (${identificador}), pero no se ha podido guardar en el ticket. Vuelve a pulsar «Enviar a Linear»: no se duplicará.` };
  }
  let aceptada = false;
  try {
    aceptada = await deps.aceptar();
  } catch (e) {
    // El envío ya está hecho y guardado: el estado se puede cambiar a mano.
    log(`pasar a aceptada: ${(e as Error)?.message ?? e}`);
  }
  return { ok: true, destino: "real", identificador, url, repetido: false, aceptada };
}
