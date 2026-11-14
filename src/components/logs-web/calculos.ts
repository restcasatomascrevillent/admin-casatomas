/**
 * Super Admin › Logs: lógica pura (sin React) para poder probarla.
 *   · estadoRecogida: distingue «no hay actividad» de «la recogida se ha parado».
 *   · describirEvento: una línea legible de cada evento del recorrido.
 *   · periodos y formatos.
 */
import { format, formatDistanceStrict, parseISO, subDays } from "date-fns";
import { es } from "date-fns/locale";
import type { EstadoRecogidaDatos, EventoWeb, IncidenciaWeb, SesionWeb } from "@/hooks/useLogsWeb";
import { causaConocida, type CausaConocida } from "../../../supabase/functions/_shared/logs-web/causas";
import {
  afectaTrasPublicar, listaTareas, nombrePagina, queFalloGenerico, resumirRecorrido, tareasDe, TEXTO_ACCION_RECARGA, TEXTO_TRAS_PUBLICAR,
} from "../../../supabase/functions/_shared/logs-web/sencillo";

export { TEXTO_ACCION_RECARGA, TEXTO_TRAS_PUBLICAR };

export type NivelRecogida = "ok" | "sin_actividad" | "parada" | "sin_datos_aun" | "aviso";

export interface EstadoRecogida {
  nivel: NivelRecogida;
  titulo: string;
  detalle: string;
  avisos: string[];
}

/** Horas sin eventos del navegador a partir de las que, si Vercel ve visitas, la recogida se da por parada. */
export const HORAS_SIN_EVENTOS = 6;
/** Minutos sin un proceso correcto (cron cada 5 min) a partir de los que se avisa. */
export const MINUTOS_PROCESO = 20;

const hace = (iso: string, ahora: Date) => formatDistanceStrict(parseISO(iso), ahora, { locale: es, addSuffix: true });

export function estadoRecogida(d: EstadoRecogidaDatos | undefined | null, ahoraIso?: string): EstadoRecogida | null {
  if (!d) return null;
  const ahora = new Date(ahoraIso ?? d.ahora);
  const avisos: string[] = [];
  const nav = d.fuentes.find((f) => f.fuente === "navegador");
  const ultimo = nav?.ultimo_recibido ?? null;
  const horasSin = ultimo ? (ahora.getTime() - Date.parse(ultimo)) / 3_600_000 : Infinity;
  const vercel = d.vercel_ultimo_dia;

  // Proceso en segundo plano (agrupar, tickets): cron cada 5 min.
  const ok = d.proceso?.ultimo_proceso_ok ?? null;
  if (!ok) avisos.push("El proceso en segundo plano todavía no ha terminado ninguna pasada: no se agrupan errores ni se crean tickets.");
  else if ((ahora.getTime() - Date.parse(ok)) / 60_000 > MINUTOS_PROCESO) {
    avisos.push(`El proceso en segundo plano no termina bien desde ${hace(ok, ahora)}${d.proceso?.ultimo_error ? `: ${d.proceso.ultimo_error}` : ""}.`);
  } else if (d.proceso?.ultimo_error) avisos.push(`Último proceso con avisos: ${d.proceso.ultimo_error}`);

  const hoy = d.ingesta[0];
  if (hoy && hoy.rechazados > 0 && hoy.rechazados > hoy.aceptados) {
    avisos.push(`Hoy se han rechazado ${hoy.rechazados} eventos por no ser válidos (y aceptado ${hoy.aceptados}): revisa la versión de la web.`);
  }
  if (d.config && !d.config.recoger_actividad) avisos.push("La recogida de actividad está desactivada en Configuración.");
  if (d.config && !d.config.entornos_aceptados.includes(d.entorno)) avisos.push(`Este entorno (${d.entorno}) no está entre los aceptados: sus eventos se rechazan.`);

  if (!d.primer_evento) {
    return {
      nivel: "sin_datos_aun",
      titulo: "Aún no ha llegado ningún evento",
      detalle: "La recogida empieza cuando se publica la versión de la web con el rastreador. No hay históricos anteriores: los datos existen desde el primer evento recibido.",
      avisos,
    };
  }
  if (horasSin >= HORAS_SIN_EVENTOS) {
    const vercelVio = vercel && vercel.visitas > 0 && (!ultimo || vercel.fecha >= ultimo.slice(0, 10));
    if (vercelVio) {
      return {
        nivel: "parada",
        titulo: "La recogida de datos parece detenida",
        detalle: `Vercel registró ${vercel!.visitas} visitas el ${format(parseISO(vercel!.fecha), "d MMM", { locale: es })}, pero no llega ningún evento del navegador ${ultimo ? `desde ${hace(ultimo, ahora)}` : "en los últimos días"}. Comprueba que la web publicada lleva el rastreador y que la función registrar-actividad-web responde.`,
        avisos,
      };
    }
    return {
      nivel: "sin_actividad",
      titulo: "No hay actividad reciente",
      detalle: `Último evento del navegador ${ultimo ? hace(ultimo, ahora) : "hace días"}${vercel ? `; Vercel tampoco registra visitas (${vercel.visitas} el ${format(parseISO(vercel.fecha), "d MMM", { locale: es })})` : ""}. No parece un fallo de la recogida.`,
      avisos,
    };
  }
  return {
    nivel: avisos.length ? "aviso" : "ok",
    titulo: "Recogida activa",
    detalle: `Último evento del navegador ${ultimo ? hace(ultimo, ahora) : "—"} · ${nav?.n_1h ?? 0} en la última hora · ${nav?.n_24h ?? 0} en 24 h.`,
    avisos,
  };
}

// ─── Periodos ────────────────────────────────────────────────────────────────
export const PERIODOS = [
  { valor: "1h", etiqueta: "Última hora", ms: 3_600_000 },
  { valor: "24h", etiqueta: "24 horas", ms: 86_400_000 },
  { valor: "7d", etiqueta: "7 días", ms: 7 * 86_400_000 },
  { valor: "30d", etiqueta: "30 días", ms: 30 * 86_400_000 },
  { valor: "90d", etiqueta: "90 días", ms: 90 * 86_400_000 },
] as const;
export type Periodo = (typeof PERIODOS)[number]["valor"];

export function rangoPeriodo(p: Periodo, ahora: Date): { desde: string; hasta: string } {
  const ms = PERIODOS.find((x) => x.valor === p)?.ms ?? 86_400_000;
  // El final redondeado al minuto siguiente: la clave de la consulta no cambia en cada render.
  const fin = Math.ceil(ahora.getTime() / 60_000) * 60_000 + 60_000;
  return { desde: new Date(fin - ms - 60_000).toISOString(), hasta: new Date(fin).toISOString() };
}

// ─── Textos ──────────────────────────────────────────────────────────────────
export const NOMBRE_TIPO: Record<string, string> = {
  pagina_vista: "Página vista",
  pagina_salida: "Fin de página",
  scroll: "Scroll",
  clic: "Clic",
  contacto: "Contacto",
  carta_categoria: "Categoría de la carta",
  plato_abierto: "Plato abierto",
  vino_abierto: "Vino abierto",
  bebida_abierta: "Bebida abierta",
  busqueda: "Búsqueda",
  filtro: "Filtro",
  mapa_vinos: "Mapa de vinos",
  pedido: "Mi mesa",
  media: "Imagen o vídeo",
  formulario: "Formulario",
  chat: "Asistente",
  reserva_disponibilidad: "Disponibilidad",
  reserva_solicitada: "Reserva solicitada",
  reserva_rechazada: "Reserva rechazada",
  cheque_checkout: "Pago de cheque",
  cheque_pagado: "Cheque pagado",
  carga_pagina: "Carga de página",
  peticion: "Petición",
  error_js: "Error de JavaScript",
  error_promesa: "Promesa rechazada",
  error_recurso: "Recurso que no carga",
  error_peticion: "Petición fallida",
  error_react: "Error de pintado",
  error_404: "Página no encontrada",
  error_servidor: "Error del servidor",
  error_integracion: "Fallo de integración",
  error_despliegue: "Despliegue fallido",
  reserva_creada_bd: "Reserva web (BD)",
  reserva_confirmada_bd: "Reserva confirmada (BD)",
  cheque_pagado_bd: "Cheque pagado (BD)",
};

export const NOMBRE_CATEGORIA: Record<string, string> = {
  actividad: "Actividad",
  operacion: "Operación completada",
  tecnico: "Petición técnica",
  error: "Error",
};

export const NOMBRE_ESTADO: Record<string, string> = {
  nueva: "Nueva",
  abierta: "Abierta",
  resuelta: "Resuelta",
  reabierta: "Reabierta",
  ignorada: "Ignorada",
};

export const NOMBRE_GRAVEDAD: Record<string, string> = { critico: "Crítica", error: "Error", aviso: "Aviso", info: "Info" };

export const NOMBRE_LINEAR: Record<string, string> = {
  sin_ticket: "Sin ticket",
  pendiente: "Ticket pendiente",
  creado: "Ticket creado",
  error: "Ticket con error (se reintenta)",
  no_aplica: "No abre ticket",
};

/** Una línea legible del evento (todo viene ya saneado del servidor). */
export function describirEvento(e: Pick<EventoWeb, "tipo" | "accion" | "ruta" | "objetivo" | "valor" | "propiedades" | "mensaje">): string {
  const obj = e.objetivo ? `«${e.objetivo}»` : "";
  const p = e.propiedades ?? {};
  switch (e.tipo) {
    case "pagina_vista": return `Abre ${e.ruta ?? "?"}${p.origen_tipo ? ` (entra por ${String(p.origen_tipo).replace("_", " ")}${p.campana ? `: ${p.campana}` : p.origen_detalle ? `: ${p.origen_detalle}` : ""})` : ""}`;
    case "pagina_salida": return `Deja ${e.ruta ?? "?"} tras ${Math.round((e.valor ?? 0) / 1000)} s activos${p.scroll_max != null ? ` · scroll ${p.scroll_max} %` : ""}${e.accion === "oculta" ? " (pestaña oculta)" : ""}`;
    case "scroll": return `Baja al ${e.valor ?? "?"} % de ${e.ruta ?? "?"}`;
    case "clic": return `Pulsa ${obj}${p.destino ? ` → ${p.destino}` : ""}`;
    case "contacto": return `Pulsa ${e.accion ?? "contacto"} ${obj}`.trim();
    case "carta_categoria": return `Categoría ${obj}`;
    case "plato_abierto": return `Abre el plato ${obj}`;
    case "vino_abierto": return `Abre el vino ${obj}${p.modo ? ` (${p.modo})` : ""}`;
    case "bebida_abierta": return `Abre la bebida ${obj}`;
    case "busqueda": return `Busca (${p.longitud ?? "?"} letras) → ${e.valor ?? "?"} resultados`;
    case "filtro": return `Filtro ${e.accion ?? ""} ${obj}`.trim();
    case "pedido": return `Mi mesa: ${e.accion ?? ""} ${obj}`.trim();
    case "media": return `${p.medio === "video" ? "Vídeo" : "Imagen"}: ${e.accion ?? ""} ${obj}`.trim();
    case "formulario": return `Formulario ${obj}: ${e.accion ?? ""}${p.campos != null ? ` (${p.campos}${p.total ? `/${p.total}` : ""} campos)` : ""}${p.campo ? ` · campo ${p.campo}` : ""}`;
    case "chat": return `Asistente: ${e.accion ?? ""}`;
    case "reserva_disponibilidad": return `Consulta disponibilidad: ${e.accion ?? "?"}${p.comensales ? ` · ${p.comensales} personas` : ""}`;
    case "reserva_solicitada": return "✔ Solicitud de reserva aceptada por el servidor (pendiente de confirmar)";
    case "reserva_rechazada": return `Reserva rechazada por el servidor (${e.accion ?? p.status ?? "?"})`;
    case "cheque_checkout": return `Va al pago del cheque${p.importe ? ` (${p.importe} €)` : ""}`;
    case "cheque_pagado": return "✔ Cheque regalo pagado";
    case "carga_pagina": return `Carga: ${p.carga ?? "?"} ms${p.lcp ? ` · LCP ${p.lcp} ms` : ""}`;
    case "peticion": return `Petición ${p.endpoint ?? "?"} → ${p.status ?? "?"} en ${Math.round(e.valor ?? 0)} ms`;
    default:
      if (e.tipo.startsWith("error_")) {
        // Errores de carga: qué decidió la web (recargó, avisó, sin conexión…).
        const decision = e.accion && TEXTO_ACCION_RECARGA[e.accion] ? ` [${TEXTO_ACCION_RECARGA[e.accion]}]` : "";
        return `${NOMBRE_TIPO[e.tipo] ?? e.tipo}: ${e.mensaje ?? obj}${decision}`;
      }
      return `${NOMBRE_TIPO[e.tipo] ?? e.tipo} ${obj}`.trim();
  }
}

export const fmtHora = (iso: string) => format(parseISO(iso), "HH:mm:ss");
export const fmtFechaHora = (iso: string | null | undefined) => (iso ? format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: es }) : "—");
export const fmtDuracion = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
export const desplazamiento = (desde: string, hasta: string) => `+${fmtDuracion(Date.parse(hasta) - Date.parse(desde))}`;

// ─── Periodos de las estadísticas ────────────────────────────────────────────
const ISO_DIA = "yyyy-MM-dd";
export const PERIODOS_ESTADISTICAS = [
  { valor: "hoy", etiqueta: "Hoy" },
  { valor: "7", etiqueta: "7 días" },
  { valor: "30", etiqueta: "30 días" },
  { valor: "90", etiqueta: "90 días" },
] as const;

/** Días cerrados (hasta ayer), como Tráfico web; «Hoy» = el día en curso. Calendario local (Madrid). */
export function rangoEstadisticas(valor: string, hoy: Date): { desde: string; hasta: string } {
  if (valor === "hoy") return { desde: format(hoy, ISO_DIA), hasta: format(hoy, ISO_DIA) };
  const dias = Number(valor) || 30;
  return { desde: format(subDays(hoy, dias), ISO_DIA), hasta: format(subDays(hoy, 1), ISO_DIA) };
}


/** Causa conocida de una incidencia del panel (el objetivo va en el título: «mensaje · objetivo»; las tareas, en las muestras). */
export function causaDeFila(i: Pick<IncidenciaWeb, "tipo" | "fuente" | "mensaje" | "pila" | "titulo">, muestras?: Pick<EventoWeb, "propiedades">[]): CausaConocida | null {
  const objetivo = i.titulo.split(" · ").slice(1).join(" · ") || null;
  const tareas = [...new Set((muestras ?? []).map((e) => e.propiedades?.tarea).filter((t): t is string => typeof t === "string"))];
  return causaConocida({ tipo: i.tipo, fuente: i.fuente, mensaje: i.mensaje, pila: i.pila, objetivo, tareas });
}

// ─── Explicación en sencillo (para el dueño) ────────────────────────────────
export interface ExplicacionSencilla {
  queHizo: string;
  queFallo: string;
  afecta: string;
  queHacer: string;
  /** De dónde sale «Qué falló»: catálogo fijo, IA (sin comprobar) o texto genérico. */
  fuente: "conocida" | "ia" | "generica";
}

const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
const inicioDeHoy = (ahora: Date) => new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()).getTime();

/** Quién lo provoca cuando no es un cliente. */
function queHizoServidor(fuente: string): string {
  if (fuente === "integracion") return "Ningún cliente: lo hace una tarea automática del panel, sin que nadie pulse nada.";
  if (fuente === "hosting") return "Nadie de fuera: es la publicación de la web en Vercel.";
  return "Ningún cliente directamente: es una función del servidor (la puede llamar la web o el panel).";
}

/**
 * «Qué hizo el cliente, qué falló, ¿afecta? y qué hacer» de una incidencia.
 * `recorrido`: los eventos de la sesión alrededor de la ocurrencia elegida;
 * `errorId`, el error dentro de ese recorrido (lo de antes es lo que hizo).
 */
export function explicacionIncidencia(
  i: IncidenciaWeb,
  muestras: EventoWeb[] = [],
  recorrido: EventoWeb[] | null = null,
  errorId: number | null = null,
  ahora: Date = new Date(),
): ExplicacionSencilla {
  const causa = causaDeFila(i, muestras);
  const exp = !causa ? i.explicacion_ia ?? null : null;
  const navegador = i.fuente === "navegador";
  const pagina = navegador ? nombrePagina(i.rutas[0]?.ruta) : null;
  const tareas = listaTareas(tareasDe({ tareas: muestras.map((e) => String(e.propiedades?.tarea ?? "")).filter(Boolean), objetivo: i.titulo.split(" · ")[1] ?? null }));

  // Qué hizo el cliente
  let queHizo: string;
  if (!navegador) queHizo = queHizoServidor(i.fuente);
  else {
    const idx = recorrido && errorId !== null ? recorrido.findIndex((e) => e.id === errorId) : -1;
    const antes = recorrido ? (idx >= 0 ? recorrido.slice(0, idx) : recorrido) : [];
    const texto = resumirRecorrido(antes);
    queHizo = texto
      ? `${texto} Y entonces falló.`
      : `${pagina ? `Estaba en ${pagina}. ` : ""}No se sabe qué hizo antes: no aceptó las estadísticas, así que solo llega el error.`;
  }

  // Qué falló
  const fuente: ExplicacionSencilla["fuente"] = causa ? "conocida" : exp?.que_paso ? "ia" : "generica";
  const queFallo = causa?.sencillo.quePasa
    ?? exp?.que_paso
    ?? queFalloGenerico({ tipo: i.tipo, fuente: i.fuente, rutas: i.rutas, objetivo: i.titulo.split(" · ")[1] ?? null, tareas: tareas.map((t) => t.nombre) });

  // ¿Afecta?
  let afecta: string;
  const tras = i.ocurrencias_tras_publicar ?? 0;
  if (causa?.id === "chunk_caducado" && tras + (i.repetidas_tras_recargar ?? 0) > 0) {
    const repetidas = i.repetidas_tras_recargar ?? 0;
    afecta = afectaTrasPublicar(tras, repetidas, {
      sinDatos: muestras.filter((e) => e.tras_publicar === "sin_datos").length,
      sinConexion: muestras.filter((e) => e.tras_publicar === "sin_conexion").length,
      otras: Math.max(i.ocurrencias - tras - repetidas, 0),
    });
  } else if (!navegador) {
    const consecuencia = tareas.find((t) => t.consecuencia)?.consecuencia;
    afecta = `No se ve en la web: es del servidor. ${plural(i.ocurrencias_24h, "vez", "veces")} en las últimas 24 h (${i.ocurrencias} en total).${consecuencia ? ` Lo que se nota: ${consecuencia}.` : ""}`;
  } else if (i.sesiones_afectadas === 0) {
    afecta = "No: solo lo han provocado robots o pruebas automáticas.";
  } else {
    const desde = inicioDeHoy(ahora);
    const deHoy = muestras.filter((e) => Date.parse(e.ocurrido_en) >= desde);
    const visitantesHoy = new Set(deHoy.map((e) => e.sesion_id ?? `sin-${e.id}`)).size;
    const almenos = muestras.length >= 50 && deHoy.length === muestras.length ? "al menos " : "";
    const hoy = visitantesHoy > 0 ? `hoy, ${almenos}${plural(visitantesHoy, "visitante", "visitantes")}` : "hoy, ninguno";
    afecta = `Sí: a ${plural(i.sesiones_afectadas, "visitante distinto", "visitantes distintos")} en total; ${hoy}. ${plural(i.ocurrencias_24h, "vez", "veces")} en las últimas 24 h.`;
    if (i.gravedad === "critico") afecta += " Es grave: puede impedir reservar o pagar.";
  }
  if (exp?.a_quien_afecta) afecta += ` Según la IA: ${exp.a_quien_afecta}`;

  // Qué hacer
  const ticket = i.linear_estado === "creado" && i.linear_identificador
    ? `Ya hay un ticket para el técnico (${i.linear_identificador}${i.linear_destino === "prueba" ? ", en el destino de pruebas" : ""}).`
    : i.linear_estado === "pendiente" || i.linear_estado === "error" ? "Se está preparando un ticket para el técnico." : null;
  let queHacer = causa?.sencillo.queHacer ?? exp?.que_hacer ?? null;
  if (!queHacer) {
    if (navegador && i.sesiones_afectadas === 0) queHacer = "Nada: lo han provocado robots o pruebas.";
    else if (ticket) queHacer = `${ticket} No hace falta hacer nada más.`;
    else queHacer = "Nada por ahora: si se repite en más visitantes, se abrirá un ticket solo. Si te parece importante, pulsa «Pedir ticket».";
  } else if (ticket) queHacer = `${queHacer} ${ticket}`;

  return { queHizo, queFallo, afecta, queHacer, fuente };
}

type EventoSesion = Pick<EventoWeb, "id" | "tipo" | "categoria" | "accion" | "ruta" | "objetivo" | "valor" | "propiedades" | "mensaje" | "pila" | "fuente" | "incidencia_id" | "tras_publicar" | "ocurrido_en">;
// (accion: en los errores de carga, lo que decidió la web; ver TEXTO_ACCION_RECARGA.)

/** Lo mismo para una sesión entera (Actividad › sesión). */
export function explicacionSesion(sesion: Pick<SesionWeb, "conversiones"> | null, eventos: EventoSesion[]): ExplicacionSencilla & { incidencias: number[] } {
  const queHizo = resumirRecorrido(eventos, 10) ?? "No hay actividad registrada: el visitante no aceptó las estadísticas, así que solo llegan sus errores.";
  const errores = eventos.filter((e) => e.categoria === "error");
  const incidencias = [...new Set(errores.map((e) => e.incidencia_id).filter((x): x is number => x !== null))];
  if (!errores.length) return { queHizo, queFallo: "Nada: no hubo ningún error en esta visita.", afecta: "No.", queHacer: "Nada.", fuente: "generica", incidencias };

  const textos = new Map<string, string>();
  let todosSinImpacto = true;
  let todosSinConexion = true;
  for (const e of errores) {
    const causa = causaConocida({ tipo: e.tipo, fuente: e.fuente, mensaje: e.mensaje, pila: e.pila, objetivo: e.objetivo, propiedades: e.propiedades, accion: e.accion });
    // Sin impacto: la clase del servidor si la hay; si no (sin la migración), la causa.
    const sinImpacto = e.tras_publicar !== undefined && e.tras_publicar !== null
      ? e.tras_publicar !== "repetido"
      : causa?.id === "chunk_caducado" || causa?.id === "carga_sin_conexion";
    if (!sinImpacto) todosSinImpacto = false;
    if (!(e.tras_publicar === "sin_conexion" || causa?.id === "carga_sin_conexion")) todosSinConexion = false;
    const clave = e.incidencia_id !== null ? `i${e.incidencia_id}` : `${e.tipo}:${e.mensaje ?? ""}`;
    if (!textos.has(clave)) textos.set(clave, causa?.sencillo.quePasa ?? queFalloGenerico({ tipo: e.tipo, fuente: e.fuente, rutas: e.ruta ? [{ ruta: e.ruta }] : [], objetivo: e.objetivo }));
  }
  const lista = [...textos.values()];
  const queFallo = lista.length === 1 ? lista[0] : `Fallaron ${lista.length} cosas: ${lista.slice(0, 3).map((t, n) => `${n + 1}) ${t}`).join(" ")}${lista.length > 3 ? " …" : ""}`;

  const repetido = errores.some((e) => e.tras_publicar === "repetido");
  const ultimo = errores[errores.length - 1];
  const siguio = eventos.some((e) => e.categoria !== "error" && e.categoria !== "tecnico" && e.ocurrido_en > ultimo.ocurrido_en);
  let afecta: string;
  let queHacer: string;
  if (todosSinImpacto && !repetido) {
    afecta = todosSinConexion
      ? "No: el visitante se quedó sin conexión; no es un fallo de la web."
      : "No: era una página antigua abierta durante una publicación; se recargó sola.";
    queHacer = todosSinConexion ? "Nada." : "Nada: se arregló solo.";
  } else {
    if (repetido) afecta = "Sí: volvió a fallar después de recargar; a esta persona no le funcionó esa parte.";
    else if ((sesion?.conversiones ?? 0) > 0) afecta = "Poco: aun así terminó la reserva o el pago.";
    else if (siguio) afecta = "Algo: tuvo el error, pero siguió navegando.";
    else afecta = "Sí, probablemente: se fue justo después del error.";
    queHacer = incidencias.length
      ? `Mira ${incidencias.length === 1 ? `la incidencia #${incidencias[0]}` : `las incidencias ${incidencias.map((n) => `#${n}`).join(", ")}`} (botón «Ver incidencia», justo debajo): ahí se explica y se lleva el seguimiento.`
      : "Nada por ahora: el error se agrupa en su incidencia en unos minutos.";
  }
  return { queHizo, queFallo, afecta, queHacer, fuente: "generica", incidencias };
}

/** Texto en llano de una incidencia para la lista (una línea). */
export function sencilloDeFila(i: IncidenciaWeb): string | null {
  const causa = causaDeFila(i);
  return causa?.sencillo.quePasa ?? i.explicacion_ia?.que_paso ?? null;
}

/** Reparto «valor n %» de una lista (los 4 más frecuentes). */
export function repartoTexto<T>(filas: T[], clave: (f: T) => string | null | undefined): string {
  if (!filas.length) return "—";
  const n = new Map<string, number>();
  for (const f of filas) {
    const k = clave(f) || "desconocido";
    n.set(k, (n.get(k) ?? 0) + 1);
  }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${Math.round((100 * v) / filas.length)} %`).join(" · ");
}

/** Texto para copiar y pegar a quien lo vaya a arreglar: error completo y contexto técnico (sin datos personales). */
export function textoParaCopiar(i: IncidenciaWeb, e?: EventoWeb | null): string {
  const l = [
    `Incidencia #${i.id} · ${i.titulo}`,
    `Tipo: ${NOMBRE_TIPO[i.tipo] ?? i.tipo} · fuente ${i.fuente} · entorno ${i.entorno} · gravedad ${i.gravedad}`,
    `Ocurrencias: ${i.ocurrencias} (${i.ocurrencias_24h} en 24 h) · sesiones ${i.sesiones_afectadas} · de ${i.primera_vez} a ${i.ultima_vez}`,
    `Versión: ${i.version_primera ?? "?"} → ${i.version_ultima ?? "?"}${i.despliegue_ultimo ? ` · despliegue ${i.despliegue_ultimo}` : ""}`,
  ];
  if (i.rutas.length) l.push(`Páginas: ${i.rutas.map((r) => `${r.ruta} (${r.n})`).join(", ")}`);
  if (e) {
    l.push(`Ocurrencia ${e.ocurrido_en}: ${[e.ruta, e.objetivo, e.navegador, e.so, e.dispositivo, e.version && `v${e.version}`].filter(Boolean).join(" · ")}`);
    if (Object.keys(e.propiedades ?? {}).length) l.push(`Datos: ${JSON.stringify(e.propiedades)}`);
  }
  l.push("", e?.mensaje ?? i.mensaje ?? "(sin mensaje)");
  const pila = e?.pila ?? i.pila;
  if (pila) l.push("", pila);
  return l.join("\n");
}
