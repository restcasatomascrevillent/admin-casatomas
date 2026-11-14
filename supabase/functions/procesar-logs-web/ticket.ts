// ============================================================================
//  procesar-logs-web / ticket.ts — título y descripción del ticket (Markdown)
// ----------------------------------------------------------------------------
//  Arriba del todo, «En pocas palabras»: qué pasa, a quién afecta, desde
//  cuándo y qué hacer, en lenguaje llano (para el dueño). Debajo, los
//  detalles técnicos para quien lo vaya a arreglar.
//  Todo lo que es HECHO sale de los datos (incidencia, muestras, recorrido);
//  lo que aporta la IA va en apartados marcados «IA · sin verificar». Si no
//  hay análisis o falta contexto, el ticket lo dice en vez de inventar.
//
//  Seguridad: el texto que viene de los logs (mensajes, pilas, rutas,
//  etiquetas) va SIEMPRE dentro de bloques de código o de `código en línea`,
//  con las comillas invertidas neutralizadas: un mensaje de error no puede
//  inyectar enlaces, menciones ni formato en Linear. Se vuelve a sanear aquí
//  (defensa en profundidad) antes de salir hacia Linear.
// ============================================================================

import { sanearPila, sanearTexto } from "../_shared/logs-web/saneado.ts";
import { marcoPrincipal } from "../_shared/logs-web/huella.ts";
import { causaConocida, type CausaConocida } from "../_shared/logs-web/causas.ts";
import { explicacionOrigen, NOMBRE_ORIGEN, type OrigenVisible } from "../_shared/logs-web/origen.ts";
import { afectaTrasPublicar, aQuienAfectaSencillo, conMayuscula, desdeCuandoSencillo, nombrePagina, queFalloGenerico, queHacerPorDefecto } from "../_shared/logs-web/sencillo.ts";

export interface IncidenciaTicket {
  id: number;
  entorno: string;
  titulo: string;
  tipo: string;
  fuente: string;
  proyecto: string;
  gravedad: string;
  estado: string;
  primera_vez: string;
  ultima_vez: string;
  ocurrencias: number;
  sesiones_afectadas: number;
  ocurrencias_24h: number;
  rutas: Array<{ ruta: string; n: number }>;
  version_primera: string | null;
  version_ultima: string | null;
  despliegue_ultimo: string | null;
  mensaje: string | null;
  pila: string | null;
  motivo_ticket: string | null;
  reabierta_veces: number;
  /** Explicación en sencillo de la IA (explicar.ts), si ya la hay. */
  explicacion_ia?: { que_paso: string; a_quien_afecta: string; que_hacer: string } | null;
  /** Ocurrencias de «versión antigua tras publicar» que se arreglaron solas / que se repitieron tras recargar. */
  ocurrencias_tras_publicar?: number;
  repetidas_tras_recargar?: number;
  /** Origen (20261130100000): fallo de la web, servicio externo o no depende de la web. */
  origen?: string | null;
  origen_proveedor?: string | null;
}

export interface EventoTicket {
  id?: number;
  tipo: string;
  accion: string | null;
  categoria: string;
  ruta: string | null;
  objetivo: string | null;
  valor: number | null;
  ocurrido_en: string;
  secuencia: number | null;
  navegador: string | null;
  so: string | null;
  dispositivo: string | null;
  version: string | null;
  propiedades?: Record<string, unknown> | null;
  mensaje?: string | null;
  incidencia_id?: number | null;
}

export interface AnalisisIa {
  impacto: string;
  hechos_observados: string[];
  hipotesis: Array<{ texto: string; confianza: "baja" | "media" | "alta" }>;
  pasos_reproduccion: string[];
  propuesta: string[];
  validacion: string[];
  falta_contexto: string[];
  modelo?: string;
}

export interface EntradaTicket {
  incidencia: IncidenciaTicket;
  /** Últimas ocurrencias (hasta 50) para los repartos por navegador, dispositivo y versión. */
  muestras: EventoTicket[];
  /** Recorrido alrededor de la última ocurrencia con sesión (antes y después), ordenado. */
  recorrido: EventoTicket[];
  /** id del evento de error dentro de `recorrido`. */
  eventoErrorId: number | null;
  analisis: AnalisisIa | null;
  motivoSinAnalisis: string | null;
  urlPanel: string;
  ahora: Date;
}

const NOMBRE_ENTORNO: Record<string, string> = { produccion: "Producción", demo: "Demo", local: "Local" };
const NOMBRE_GRAVEDAD: Record<string, string> = { critico: "Crítica", error: "Error", aviso: "Aviso", info: "Información" };
const NOMBRE_TIPO: Record<string, string> = {
  error_js: "Excepción de JavaScript",
  error_promesa: "Promesa rechazada sin capturar",
  error_recurso: "Recurso que no carga",
  error_peticion: "Petición fallida a una función",
  error_react: "Error de pintado (React)",
  error_404: "Página no encontrada (404)",
  error_servidor: "Error de una función del servidor",
  error_integracion: "Fallo de una integración o tarea programada",
  error_despliegue: "Despliegue fallido",
};

/** Texto de los logs en línea: sin comillas invertidas ni saltos, siempre como código. */
export const enLinea = (t: unknown, max = 160): string => {
  const s = sanearTexto(t, max)?.replace(/`/g, "ʼ").replace(/\s+/g, " ") ?? "";
  return s ? `\`${s}\`` : "—";
};
/** Bloque de código para textos de los logs (no puede cerrarse desde dentro). */
export const bloque = (t: string): string => `\`\`\`text\n${t.replace(/```/g, "ʼʼʼ")}\n\`\`\``;
/** Texto de la IA: sin enlaces, menciones ni HTML; corto. */
export const textoIa = (t: unknown, max = 400): string =>
  String(t ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "[enlace omitido]")
    .replace(/(^|\s)@([A-Za-z0-9_.-]+)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const fecha = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function reparto(muestras: EventoTicket[], clave: (e: EventoTicket) => string | null): string {
  const n = new Map<string, number>();
  for (const e of muestras) {
    const k = clave(e) ?? "desconocido";
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  const total = muestras.length || 1;
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round((100 * v) / total)} %`).join(" · ");
}

/** Claves de `propiedades` que se citan en el ticket (todas técnicas, ya saneadas en la ingesta). */
export const CLAVES_DATOS = ["endpoint", "metodo", "status", "tarea", "componente", "etiqueta", "proyecto", "despliegue", "rama", "codigo"] as const;

/** Los errores del servidor, integraciones y despliegues no tienen navegador, página ni sesión. */
export const esDeNavegador = (i: Pick<IncidenciaTicket, "fuente">) => i.fuente === "navegador";

/** Objetivos afectados (tarea, endpoint, recurso, componente) con su número de muestras. */
export function objetivosAfectados(muestras: EventoTicket[]): Array<{ objetivo: string; n: number }> {
  const n = new Map<string, number>();
  for (const e of muestras) if (e.objetivo) n.set(e.objetivo, (n.get(e.objetivo) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([objetivo, v]) => ({ objetivo, n: v }));
}

/** Datos clave de las muestras: valores distintos de las propiedades técnicas conocidas. */
export function datosClave(muestras: EventoTicket[]): Array<{ clave: string; valores: string[] }> {
  const salida: Array<{ clave: string; valores: string[] }> = [];
  for (const clave of CLAVES_DATOS) {
    const v = new Map<string, number>();
    for (const e of muestras) {
      const x = e.propiedades?.[clave];
      if (x === undefined || x === null || x === "" || typeof x === "object") continue;
      const k = String(x).slice(0, 80);
      v.set(k, (v.get(k) ?? 0) + 1);
    }
    if (v.size) salida.push({ clave, valores: [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k) });
  }
  return salida;
}

/** Causa conocida de la incidencia (mira el mensaje, la pila y la muestra más reciente). */
export function causaDeIncidencia(i: IncidenciaTicket, muestras: EventoTicket[]): CausaConocida | null {
  const m = muestras[0];
  const tareas = muestras.map((e) => e.propiedades?.tarea).filter((t): t is string => typeof t === "string");
  return causaConocida({ tipo: i.tipo, fuente: i.fuente, mensaje: i.mensaje, pila: i.pila, objetivo: m?.objetivo ?? null, propiedades: m?.propiedades ?? null, tareas: [...new Set(tareas)] });
}

/** Una línea legible de un evento del recorrido (sin datos personales: todo viene saneado). */
export function describirEvento(e: EventoTicket): string {
  const obj = e.objetivo ? ` ${enLinea(e.objetivo, 80)}` : "";
  switch (e.tipo) {
    case "pagina_vista": return `Abre la página ${enLinea(e.ruta)}`;
    case "pagina_salida": return `Deja de ver ${enLinea(e.ruta)} (${Math.round((e.valor ?? 0) / 1000)} s activos)`;
    case "scroll": return `Baja hasta el ${e.valor ?? "?"} % de ${enLinea(e.ruta)}`;
    case "clic": return `Pulsa${obj}`;
    case "contacto": return `Pulsa contacto (${e.accion ?? "?"})${obj}`;
    case "carta_categoria": return `Cambia a la categoría${obj}`;
    case "plato_abierto": return `Abre el plato${obj}`;
    case "vino_abierto": return `Abre el vino${obj}`;
    case "bebida_abierta": return `Abre la bebida${obj}`;
    case "busqueda": return `Busca en la carta (${e.valor ?? "?"} resultados)`;
    case "filtro": return `Filtro ${e.accion ?? ""}${obj}`;
    case "formulario": return `Formulario${obj}: ${e.accion ?? "?"}`;
    case "reserva_disponibilidad": return `Consulta disponibilidad: ${e.accion ?? "?"}`;
    case "reserva_solicitada": return "El servidor acepta la solicitud de reserva";
    case "reserva_rechazada": return `El servidor rechaza la reserva (${e.accion ?? "?"})`;
    case "cheque_checkout": return "Va al pago del cheque regalo";
    case "cheque_pagado": return "Cheque regalo pagado";
    case "peticion": return `Petición ${enLinea(e.propiedades?.endpoint)} → ${e.propiedades?.status ?? "?"} en ${Math.round(e.valor ?? 0)} ms`;
    default:
      if (e.categoria === "error") return `**Error** ${NOMBRE_TIPO[e.tipo] ?? e.tipo}: ${enLinea(e.mensaje ?? e.objetivo, 120)}`;
      return `${e.tipo}${e.accion ? ` (${e.accion})` : ""}${obj}`;
  }
}

/** Pasos de reproducción deducidos del recorrido observado (hechos, no IA). */
export function pasosDesdeRecorrido(entrada: EntradaTicket): string[] {
  const { recorrido, eventoErrorId, incidencia, muestras } = entrada;
  const idx = eventoErrorId === null ? -1 : recorrido.findIndex((e) => e.id === eventoErrorId);
  const previos = (idx >= 0 ? recorrido.slice(0, idx) : recorrido)
    .filter((e) => !["pagina_salida", "scroll", "carga_pagina", "peticion"].includes(e.tipo) && e.categoria !== "error")
    .slice(-6);
  const pasos: string[] = [];
  const m = muestras[0];
  if (!esDeNavegador(incidencia)) {
    const objetivos = objetivosAfectados(muestras);
    if (objetivos.length) pasos.push(`Revisar ${objetivos.slice(0, 3).map((o) => enLinea(o.objetivo, 80)).join(", ")} en ${NOMBRE_ENTORNO[incidencia.entorno] ?? incidencia.entorno} (logs de la función o tarea a la hora indicada).`);
    pasos.push(`Resultado observado: ${NOMBRE_TIPO[incidencia.tipo] ?? incidencia.tipo} — ${enLinea(incidencia.mensaje ?? incidencia.titulo, 160)}.`);
    return pasos;
  }
  if (m?.dispositivo || m?.navegador) {
    pasos.push(`Usar ${[m.dispositivo, m.navegador, m.so].filter(Boolean).join(" · ")} (lo más frecuente en las ocurrencias).`);
  }
  if (previos.length === 0 && incidencia.rutas[0]) pasos.push(`Abrir la página ${enLinea(incidencia.rutas[0].ruta)}.`);
  for (const e of previos) pasos.push(`${describirEvento(e)}.`);
  pasos.push(`Resultado observado: ${NOMBRE_TIPO[incidencia.tipo] ?? incidencia.tipo} — ${enLinea(incidencia.mensaje ?? incidencia.titulo, 160)}.`);
  return pasos;
}

export interface ResumenSencillo {
  quePasa: string;
  aQuienAfecta: string;
  desdeCuando: string;
  queHacer: string;
}

/**
 * «En pocas palabras» del ticket. Primero la causa conocida (texto fijo en
 * llano), si no la explicación de la IA en sencillo, y si no un texto
 * genérico. Lo de los logs (endpoint, tarea, página desconocida) va como
 * `código`; lo de la IA, marcado «sin verificar».
 */
export function resumenSencillo(entrada: EntradaTicket): ResumenSencillo {
  const { incidencia: i, muestras, analisis } = entrada;
  const causa = causaDeIncidencia(i, muestras);
  const exp = i.explicacion_ia ?? null;
  const objetivo = objetivosAfectados(muestras)[0]?.objetivo ?? null;
  const ruta = i.rutas[0]?.ruta ?? null;
  let quePasa: string;
  if (causa) {
    quePasa = causa.sencillo.quePasa;
  } else if (exp?.que_paso) {
    quePasa = `${textoIa(exp.que_paso, 300)} _(explicación de la IA, sin verificar)_`;
  } else {
    const generico = queFalloGenerico({ tipo: i.tipo, fuente: i.fuente, rutas: i.rutas, objetivo, tareas: muestras.map((e) => String(e.propiedades?.tarea ?? "")).filter(Boolean) });
    // Página desconocida: se nombra como código (viene de los logs).
    const paginaRara = esDeNavegador(i) && ruta && !nombrePagina(ruta) ? ` en la página ${enLinea(ruta, 80)}` : "";
    const que = objetivo && i.tipo !== "error_integracion" ? ` (afecta a ${enLinea(objetivo, 80)})` : "";
    quePasa = `${generico.replace(/\.$/, "")}${paginaRara}${que}.`;
    if (analisis?.impacto) quePasa += ` Según la IA (sin verificar): ${textoIa(analisis.impacto, 240)}`;
  }
  const tras = i.ocurrencias_tras_publicar ?? 0;
  const aQuienAfecta = causa?.id === "chunk_caducado" && tras > 0
    ? afectaTrasPublicar(tras, i.repetidas_tras_recargar ?? 0, { otras: Math.max(i.ocurrencias - tras - (i.repetidas_tras_recargar ?? 0), 0) })
    : exp?.a_quien_afecta && !causa ? `${aQuienAfectaSencillo(i)} ${textoIa(exp.a_quien_afecta, 240)} _(IA)_` : aQuienAfectaSencillo(i);
  const queHacer = causa?.sencillo.queHacer
    ?? (exp?.que_hacer ? `${textoIa(exp.que_hacer, 240)} _(IA, sin verificar)_` : null)
    ?? (analisis?.propuesta[0] ? `${textoIa(analisis.propuesta[0], 240)} _(propuesta de la IA, sin verificar)_` : queHacerPorDefecto(i));
  return { quePasa, aQuienAfecta, desdeCuando: desdeCuandoSencillo(i, fecha), queHacer };
}

export function construirTitulo(i: IncidenciaTicket): string {
  const prefijo = i.gravedad === "critico" ? "[Crítico] " : "";
  const entorno = i.entorno === "produccion" ? "" : ` (${NOMBRE_ENTORNO[i.entorno] ?? i.entorno})`;
  const base = sanearTexto(i.titulo, 140) ?? i.tipo;
  return `${prefijo}${base}${entorno}`.slice(0, 200);
}

export function construirTicket(entrada: EntradaTicket): { titulo: string; descripcion: string } {
  const { incidencia: i, muestras, recorrido, analisis, urlPanel } = entrada;
  const enlace = `${urlPanel.replace(/\/+$/, "")}/super-admin/logs?incidencia=${i.id}`;
  const pct = (n: number) => `${n} ${n === 1 ? "sesión" : "sesiones"}`;
  const navegador = esDeNavegador(i);
  const causa = causaDeIncidencia(i, muestras);
  const objetivos = objetivosAfectados(muestras);
  const datos = datosClave(muestras);
  const l: string[] = [];

  const sencillo = resumenSencillo(entrada);
  l.push("## En pocas palabras");
  l.push(`- **Qué pasa:** ${sencillo.quePasa}`);
  l.push(`- **A quién afecta:** ${sencillo.aQuienAfecta}`);
  l.push(`- **Desde cuándo:** ${sencillo.desdeCuando}`);
  l.push(`- **Qué hacer:** ${sencillo.queHacer}`);
  l.push("");
  l.push("---");
  l.push("");
  l.push(`> Detalles técnicos. Ticket creado automáticamente por Super Admin › Logs (${NOMBRE_ENTORNO[i.entorno] ?? i.entorno}). Los apartados marcados **IA · sin verificar** son hipótesis; el resto sale de los datos registrados.`);
  l.push("");
  l.push("## Impacto");
  l.push(`- **Gravedad:** ${NOMBRE_GRAVEDAD[i.gravedad] ?? i.gravedad} · **Tipo:** ${NOMBRE_TIPO[i.tipo] ?? i.tipo} · **Fuente:** ${i.fuente}`);
  if (i.origen && i.origen in NOMBRE_ORIGEN) {
    const o = i.origen as OrigenVisible;
    l.push(`- **Origen:** ${NOMBRE_ORIGEN[o]}${o === "externo" && i.origen_proveedor ? ` (${enLinea(i.origen_proveedor, 60)})` : ""}. ${explicacionOrigen(o, i.origen_proveedor ? i.origen_proveedor.replace(/[`*_[\]<>]/g, "") : null)}`);
  }
  l.push(navegador
    ? `- **Frecuencia:** ${i.ocurrencias} ocurrencias (${i.ocurrencias_24h} en las últimas 24 h) en ${pct(i.sesiones_afectadas)} observadas.`
    : `- **Frecuencia:** ${i.ocurrencias} ocurrencias (${i.ocurrencias_24h} en las últimas 24 h). Error del servidor: no hay visitantes ni sesiones asociadas.`);
  if (i.motivo_ticket) l.push(`- **Por qué se abre:** ${textoIa(i.motivo_ticket, 300)}`);
  if (i.reabierta_veces > 0) l.push(`- **Reaparecida** ${i.reabierta_veces} ${i.reabierta_veces === 1 ? "vez" : "veces"} tras marcarse como resuelta.`);
  if (analisis?.impacto) l.push(`- **Impacto estimado (IA · sin verificar):** ${textoIa(analisis.impacto, 300)}`);
  if (navegador) l.push("- «Sesiones» = navegadores o cargas de página distintas: los errores se registran de todos los visitantes, pero el recorrido solo existe si aceptaron «Estadísticas». Los bots no cuentan.");
  l.push("");
  if (objetivos.length || datos.length) {
    l.push("## Qué falla");
    if (objetivos.length) l.push(`- **Afecta a:** ${objetivos.slice(0, 8).map((o) => `${enLinea(o.objetivo, 80)} (${o.n})`).join(", ")}${objetivos.length > 8 ? ` y ${objetivos.length - 8} más` : ""} _(en las últimas ${muestras.length} ocurrencias)_`);
    for (const d of datos) l.push(`- **${d.clave}:** ${d.valores.map((v) => enLinea(v, 60)).join(", ")}`);
    l.push("");
  }
  if (causa) {
    l.push("## Causa conocida");
    l.push(`**${causa.titulo}.** ${causa.explicacion}`);
    for (const a of causa.acciones) l.push(`- ${a}`);
    if (causa.ruidoSiAislado) l.push("- Si se queda en pocas sesiones, se puede ignorar.");
    l.push("");
  }
  l.push("## Entorno, versión y despliegue");
  l.push(`- **Entorno:** ${NOMBRE_ENTORNO[i.entorno] ?? i.entorno} · **Proyecto:** ${enLinea(i.proyecto, 60)}`);
  l.push(`- **Versión:** primera vista en ${enLinea(i.version_primera ?? "desconocida", 40)}, última en ${enLinea(i.version_ultima ?? "desconocida", 40)}${i.despliegue_ultimo ? ` · despliegue ${enLinea(i.despliegue_ultimo, 80)}` : ""}`);
  l.push(`- **Primera detección:** ${fecha(i.primera_vez)} · **Última:** ${fecha(i.ultima_vez)} (hora de Madrid)`);
  l.push("");
  l.push("## Evidencias técnicas (depuradas)");
  if (navegador && i.rutas.length) l.push(`- **Páginas:** ${i.rutas.map((r) => `${enLinea(r.ruta, 80)} (${r.n})`).join(", ")}`);
  if (navegador && muestras.length) {
    l.push(`- **Navegador:** ${reparto(muestras, (e) => e.navegador)}`);
    l.push(`- **Dispositivo:** ${reparto(muestras, (e) => e.dispositivo)} · **Sistema:** ${reparto(muestras, (e) => e.so)}`);
    l.push(`- **Versiones en las muestras:** ${reparto(muestras, (e) => e.version)}`);
  }
  const marco = marcoPrincipal(i.pila);
  if (marco) l.push(`- **Marco principal de la pila:** ${enLinea(marco, 160)}`);
  l.push("");
  l.push(bloque([sanearTexto(i.mensaje, 500) ?? "(sin mensaje)", sanearPila(i.pila) ?? ""].filter(Boolean).join("\n\n")));
  l.push("");
  if (navegador) {
    l.push("## Recorrido previo (última ocurrencia con sesión)");
    if (recorrido.length) {
      const inicio = new Date(recorrido[0].ocurrido_en).getTime();
      for (const e of recorrido) {
        const seg = Math.max(0, Math.round((new Date(e.ocurrido_en).getTime() - inicio) / 1000));
        const marcaError = e.id !== undefined && e.id === entrada.eventoErrorId ? " ← **aquí falla**" : "";
        l.push(`- +${seg} s · ${describirEvento(e)}${marcaError}`);
      }
    } else {
      l.push("- No hay recorrido: el error llegó de un navegador sin consentimiento «Estadísticas». Falta contexto de navegación.");
    }
    l.push("");
  }
  l.push("## Pasos de reproducción");
  pasosDesdeRecorrido(entrada).forEach((p, n) => l.push(`${n + 1}. ${p}`));
  if (analisis?.pasos_reproduccion.length) {
    l.push("");
    l.push("Pasos sugeridos (IA · sin verificar):");
    analisis.pasos_reproduccion.slice(0, 6).forEach((p, n) => l.push(`${n + 1}. ${textoIa(p)}`));
  }
  l.push("");
  l.push("## Diagnóstico");
  l.push("**Hechos (de los datos):**");
  l.push(`- Mismo error agrupado por huella estable: ${i.ocurrencias} veces entre ${fecha(i.primera_vez)} y ${fecha(i.ultima_vez)}.`);
  if (i.version_primera && i.version_ultima) {
    l.push(i.version_primera === i.version_ultima
      ? `- Solo se ha visto en la versión ${enLinea(i.version_primera, 40)}.`
      : `- Se ve desde la versión ${enLinea(i.version_primera, 40)} y sigue en ${enLinea(i.version_ultima, 40)}.`);
  }
  for (const h of analisis?.hechos_observados.slice(0, 6) ?? []) l.push(`- ${textoIa(h)} _(resumido por la IA a partir de los datos)_`);
  l.push("");
  l.push("**Hipótesis (IA · sin verificar):**");
  if (analisis?.hipotesis.length) {
    for (const h of analisis.hipotesis.slice(0, 5)) l.push(`- (${h.confianza}) ${textoIa(h.texto)}`);
  } else {
    l.push(`- Sin hipótesis: ${entrada.motivoSinAnalisis ?? "la IA no tenía datos suficientes"}.`);
  }
  if (analisis?.falta_contexto.length) {
    l.push("");
    l.push("**Falta contexto para confirmarlo:**");
    for (const f of analisis.falta_contexto.slice(0, 5)) l.push(`- ${textoIa(f)}`);
  }
  l.push("");
  l.push("## Propuesta de solución (IA · no verificada)");
  if (analisis?.propuesta.length) for (const p of analisis.propuesta.slice(0, 5)) l.push(`- ${textoIa(p)}`);
  else if (causa) l.push(`- Ver «Causa conocida» arriba.`);
  else l.push(`- Sin propuesta concreta: falta contexto. Empezar por reproducir con los pasos de arriba${marco ? ` y revisar ${enLinea(marco, 120)}` : ""}.`);
  l.push("");
  l.push("## Cómo validar la corrección");
  for (const v of analisis?.validacion.slice(0, 4) ?? []) l.push(`- ${textoIa(v)} _(IA)_`);
  l.push(`- Repetir los pasos de reproducción en ${NOMBRE_ENTORNO[i.entorno] === "Producción" ? "la demo y después en producción" : "el mismo entorno"} y comprobar que no aparece el error.`);
  l.push(`- En Super Admin › Logs, la incidencia no debe recibir ocurrencias nuevas en la versión corregida durante 48 h. Si reaparece tras marcarla resuelta, se reabre sola y se avisa en este ticket.`);
  l.push("");
  l.push(`**Detalle en Super Admin:** ${enlace}`);
  return { titulo: construirTitulo(i), descripcion: l.join("\n").slice(0, 60000) };
}

/** Comentario de actualización por repeticiones. */
export function construirActualizacion(i: IncidenciaTicket, ocurrenciasAntes: number): string {
  return [
    `**Actualización automática** (${fecha(new Date().toISOString())}): ${i.ocurrencias} ocurrencias en total (+${Math.max(i.ocurrencias - ocurrenciasAntes, 0)} desde el último aviso), ${i.sesiones_afectadas} sesiones afectadas, ${i.ocurrencias_24h} en las últimas 24 h.`,
    `Última vez: ${fecha(i.ultima_vez)} · versión ${enLinea(i.version_ultima ?? "desconocida", 40)}.`,
    i.rutas.length ? `Páginas: ${i.rutas.map((r) => `${enLinea(r.ruta, 80)} (${r.n})`).join(", ")}.` : "",
  ].filter(Boolean).join("\n");
}

/** Comentario al reabrir. `estadoNuevo`: estado de Linear al que se ha devuelto el ticket (null = seguía abierto). */
export function construirReapertura(i: IncidenciaTicket, estadoNuevo: string | null = null): string {
  return [
    `**Ha vuelto a pasar después de darse por resuelto** (${fecha(i.ultima_vez)}), vez n.º ${i.reabierta_veces}.`,
    `Versión donde reaparece: ${enLinea(i.version_ultima ?? "desconocida", 40)}. Ocurrencias totales: ${i.ocurrencias}; ${i.sesiones_afectadas} sesiones afectadas.`,
    estadoNuevo ? `Ticket devuelto a «${textoIa(estadoNuevo, 60)}». La incidencia vuelve a estar abierta en Super Admin › Logs.` : "La incidencia vuelve a estar abierta en Super Admin › Logs.",
  ].join("\n");
}
