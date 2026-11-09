/**
 * Super Admin › Logs: lógica pura (sin React) para poder probarla.
 *   · estadoRecogida: distingue «no hay actividad» de «la recogida se ha parado».
 *   · describirEvento: una línea legible de cada evento del recorrido.
 *   · periodos y formatos.
 */
import { format, formatDistanceStrict, parseISO, subDays } from "date-fns";
import { es } from "date-fns/locale";
import type { EstadoRecogidaDatos, EventoWeb } from "@/hooks/useLogsWeb";

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
      if (e.tipo.startsWith("error_")) return `${NOMBRE_TIPO[e.tipo] ?? e.tipo}: ${e.mensaje ?? obj}`;
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

