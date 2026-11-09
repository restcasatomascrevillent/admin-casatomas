// ============================================================================
//  Logs web · catálogo de eventos del navegador y validación de un lote
// ----------------------------------------------------------------------------
//  Espejo de public.web_eventos_catalogo (20261118100000_logs_web.sql); un test
//  comprueba que los dos dicen lo mismo. Todo lo que no esté aquí se rechaza.
//
//  Qué NO entra nunca, aunque el navegador lo mande:
//    · claves de propiedades fuera de la lista del tipo (p. ej. «email», «nombre»);
//    · textos sin sanear (todo pasa por sanearTexto/sanearRuta);
//    · el referente completo (solo su host) ni la consulta de la URL (solo utm_*/qr, ya clasificados);
//    · identificadores de sesión/visitante de un navegador SIN consentimiento.
//  La huella de los errores la calcula el servidor (huella.ts).
// ============================================================================

import { calcularHuella } from "./huella.ts";
import { clasificarProcedencia } from "./clasificacion.ts";
import { sanearPila, sanearPropiedades, sanearRuta, sanearTexto, type ValorPropiedad } from "./saneado.ts";

export type Categoria = "actividad" | "operacion" | "tecnico" | "error";
export type Gravedad = "info" | "aviso" | "error" | "critico";

interface DefinicionTipo {
  categoria: Categoria;
  /** Sin consentimiento «Estadísticas» solo entran los que no lo requieren (errores). */
  consentimiento: boolean;
  props: string[];
  acciones?: string[];
}

const ORIGEN = ["referente", "utm_source", "utm_medium", "utm_campaign", "qr"];

export const CATALOGO_NAVEGADOR: Record<string, DefinicionTipo> = {
  pagina_vista: { categoria: "actividad", consentimiento: true, props: [...ORIGEN, "idioma", "vista_id", "navegacion"] },
  pagina_salida: { categoria: "actividad", consentimiento: true, props: ["scroll_max", "vista_id"], acciones: ["navegacion", "oculta", "cierre"] },
  scroll: { categoria: "actividad", consentimiento: true, props: ["vista_id"] },
  clic: { categoria: "actividad", consentimiento: true, props: ["destino", "elemento", "zona"] },
  contacto: { categoria: "actividad", consentimiento: true, props: ["destino", "zona"], acciones: ["telefono", "whatsapp", "email", "mapa", "red_social"] },
  carta_categoria: { categoria: "actividad", consentimiento: true, props: ["carta"] },
  plato_abierto: { categoria: "actividad", consentimiento: true, props: ["id", "carta", "categoria", "modo"] },
  vino_abierto: { categoria: "actividad", consentimiento: true, props: ["id", "carta", "categoria", "modo"] },
  bebida_abierta: { categoria: "actividad", consentimiento: true, props: ["id", "carta", "categoria", "modo"] },
  busqueda: { categoria: "actividad", consentimiento: true, props: ["longitud", "carta"] },
  filtro: { categoria: "actividad", consentimiento: true, props: ["carta"], acciones: ["activar", "desactivar", "cambiar", "limpiar"] },
  mapa_vinos: { categoria: "actividad", consentimiento: true, props: ["carta"] },
  pedido: { categoria: "actividad", consentimiento: true, props: ["carta", "unidades"], acciones: ["anadir", "quitar", "ver", "compartir", "vaciar"] },
  media: { categoria: "actividad", consentimiento: true, props: ["medio", "posicion", "zona"], acciones: ["abrir", "reproducir", "pausa", "fin", "cerrar", "siguiente", "anterior"] },
  formulario: { categoria: "actividad", consentimiento: true, props: ["campos", "total", "campo", "paso"], acciones: ["inicio", "avance", "envio", "error_validacion", "abandono"] },
  chat: { categoria: "actividad", consentimiento: true, props: ["codigo"], acciones: ["abrir", "mensaje", "respuesta", "error", "cerrar"] },
  reserva_disponibilidad: { categoria: "actividad", consentimiento: true, props: ["comensales", "dias_antelacion", "fallo"], acciones: ["con_huecos", "completo", "cerrado", "error"] },
  reserva_solicitada: { categoria: "operacion", consentimiento: true, props: ["comensales", "dias_antelacion"], acciones: ["ok"] },
  reserva_rechazada: { categoria: "operacion", consentimiento: true, props: ["status"] },
  cheque_checkout: { categoria: "actividad", consentimiento: true, props: ["importe", "plantilla"] },
  cheque_pagado: { categoria: "operacion", consentimiento: true, props: ["importe"], acciones: ["ok"] },
  carga_pagina: { categoria: "tecnico", consentimiento: true, props: ["ttfb", "dom", "carga", "lcp", "cls", "navegacion"] },
  peticion: { categoria: "tecnico", consentimiento: true, props: ["endpoint", "metodo", "status"] },
  error_js: { categoria: "error", consentimiento: false, props: ["componente"] },
  error_promesa: { categoria: "error", consentimiento: false, props: [] },
  error_recurso: { categoria: "error", consentimiento: false, props: ["etiqueta"] },
  error_peticion: { categoria: "error", consentimiento: false, props: ["endpoint", "metodo", "status"] },
  error_react: { categoria: "error", consentimiento: false, props: ["componente"] },
  error_404: { categoria: "error", consentimiento: false, props: ["referente_interno"] },
};

/** Tipos que solo emiten el servidor, la BD y los recolectores (no se aceptan del navegador). */
export const TIPOS_SERVIDOR = ["error_servidor", "error_integracion", "error_despliegue", "reserva_creada_bd", "reserva_confirmada_bd", "cheque_pagado_bd"];

/** Operaciones cuya caída rompe una conversión: su error de petición es crítico. */
const ENDPOINTS_CRITICOS = /^(reservas-web\/crear|cheques-regalo-web\/crear)$/;

export const MAX_EVENTOS_LOTE = 50;
export const MAX_BYTES_LOTE = 64 * 1024;

export interface ContextoLote {
  entorno: "produccion" | "demo" | "local";
  proyecto: string;
  esBot: boolean;
  dispositivo: string;
  navegador: string | null;
  so: string | null;
  ahora: Date;
}

/** Fila lista para web_logs_ingerir (mismos nombres que el jsonb_to_recordset). */
export interface EventoNormalizado {
  evento_id: string;
  ocurrido_en: string;
  proyecto: string;
  fuente: "navegador" | "servidor" | "base_datos" | "hosting" | "integracion";
  categoria: Categoria;
  tipo: string;
  accion: string | null;
  sesion_id: string | null;
  visitante_id: string | null;
  secuencia: number | null;
  ruta: string | null;
  objetivo: string | null;
  valor: number | null;
  propiedades: Record<string, ValorPropiedad>;
  dispositivo: string | null;
  navegador: string | null;
  so: string | null;
  es_bot: boolean;
  es_interno: boolean;
  es_prueba: boolean;
  consentimiento: boolean;
  version: string | null;
  despliegue: string | null;
  gravedad: Gravedad | null;
  huella: string | null;
  mensaje: string | null;
  pila: string | null;
}

export interface ResultadoLote {
  eventos: EventoNormalizado[];
  rechazados: number;
  sinConsentimiento: number;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = (v: unknown): string | null => (typeof v === "string" && RE_UUID.test(v) ? v.toLowerCase() : null);
const accion = (v: unknown): string | null => (typeof v === "string" && /^[a-z0-9_]{1,40}$/.test(v) ? v : null);
const numero = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const textoCorto = (v: unknown, max: number): string | null =>
  typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v.slice(0, max) : null;

function gravedadDe(tipo: string, props: Record<string, ValorPropiedad>): Gravedad | null {
  switch (tipo) {
    case "error_recurso":
    case "error_404":
      return "aviso";
    case "error_peticion": {
      const endpoint = String(props.endpoint ?? "");
      const status = Number(props.status ?? 0);
      return ENDPOINTS_CRITICOS.test(endpoint) && (status === 0 || status >= 500) ? "critico" : "error";
    }
    case "error_js":
    case "error_promesa":
    case "error_react":
      return "error";
    default:
      return null;
  }
}

/** Endpoint de una función: «reservas-web/crear», sin dominio ni consulta. */
export function normalizarEndpoint(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const sinConsulta = v.split(/[?#]/)[0];
  const m = /\/functions\/v1\/([a-z0-9-]+(?:\/[a-z0-9-]+)?)/i.exec(sinConsulta)
    ?? /\/rest\/v1\/(?:rpc\/)?([a-z0-9_]+)/i.exec(sinConsulta)?.map((x, i) => (i === 1 ? `rest:${x}` : x))
    ?? /^((?:rest:)?[a-z0-9_-]+(?:\/[a-z0-9-]+)?)$/i.exec(sinConsulta);
  return m ? m[1].toLowerCase().slice(0, 80) : null;
}

/**
 * Valida y normaliza un lote del navegador. Nunca lanza: lo que no encaja se
 * cuenta como rechazado.
 */
export async function normalizarLote(cuerpo: unknown, ctx: ContextoLote): Promise<ResultadoLote> {
  const salida: ResultadoLote = { eventos: [], rechazados: 0, sinConsentimiento: 0 };
  if (!cuerpo || typeof cuerpo !== "object") return salida;
  const c = cuerpo as Record<string, unknown>;
  const lista = Array.isArray(c.eventos) ? c.eventos : [];
  const contexto = (c.contexto && typeof c.contexto === "object" ? c.contexto : {}) as Record<string, unknown>;
  const consentimiento = contexto.consentimiento === true;
  const esInterno = contexto.interno === true;
  const esPrueba = contexto.prueba === true;
  const version = textoCorto(contexto.version, 40);
  const despliegue = textoCorto(contexto.despliegue, 80);
  const ahoraMs = ctx.ahora.getTime();

  if (lista.length > MAX_EVENTOS_LOTE) salida.rechazados += lista.length - MAX_EVENTOS_LOTE;

  for (const bruto of lista.slice(0, MAX_EVENTOS_LOTE)) {
    if (!bruto || typeof bruto !== "object") {
      salida.rechazados++;
      continue;
    }
    const e = bruto as Record<string, unknown>;
    const tipo = typeof e.tipo === "string" ? e.tipo : "";
    const def = CATALOGO_NAVEGADOR[tipo];
    const eventoId = uuid(e.id);
    if (!def || !eventoId) {
      salida.rechazados++;
      continue;
    }
    if (def.consentimiento && !consentimiento) {
      salida.sinConsentimiento++;
      continue;
    }
    const acc = accion(e.accion);
    if (def.acciones && acc !== null && !def.acciones.includes(acc)) {
      salida.rechazados++;
      continue;
    }

    // Hora del navegador: si no es válida, la de llegada (la RPC la acota otra vez).
    const t = typeof e.t === "string" ? Date.parse(e.t) : NaN;
    const ocurrido = Number.isFinite(t) ? new Date(Math.min(Math.max(t, ahoraMs - 2 * 86_400_000), ahoraMs + 300_000)) : ctx.ahora;

    const bruta = (e.props && typeof e.props === "object" ? e.props : {}) as Record<string, unknown>;
    let props = sanearPropiedades(bruta, new Set(def.props));
    // Identificadores técnicos (página vista, plato, vino): se validan aparte. El saneado de textos los
    // convertiría en «[id]» y se perdería la unión página vista ↔ fin de página.
    for (const clave of ["vista_id", "id"] as const) {
      if (!def.props.includes(clave)) continue;
      const v = bruta[clave];
      const limpio = typeof v === "number" && Number.isInteger(v) ? String(v) : uuid(v) ?? (typeof v === "string" && /^\d{1,12}$/.test(v) ? v : null);
      if (limpio) props[clave] = limpio;
      else delete props[clave];
    }
    if (typeof bruta.endpoint === "string") {
      const ep = normalizarEndpoint(bruta.endpoint);
      if (ep) props.endpoint = ep;
      else delete props.endpoint;
    }
    if (tipo === "pagina_vista") {
      // La procedencia se clasifica aquí y se guarda clasificada; el host y los utm crudos no.
      const tieneOrigen = ORIGEN.some((k) => k in bruta);
      const { referente: _r, utm_source: _s, utm_medium: _m, utm_campaign: _c, qr: _q, ...resto } = props;
      props = resto;
      if (tieneOrigen || bruta.navegacion === "inicial") {
        const p = clasificarProcedencia({
          referente: typeof bruta.referente === "string" ? bruta.referente : null,
          utm_source: typeof bruta.utm_source === "string" ? bruta.utm_source : null,
          utm_medium: typeof bruta.utm_medium === "string" ? bruta.utm_medium : null,
          utm_campaign: typeof bruta.utm_campaign === "string" ? bruta.utm_campaign : null,
          qr: typeof bruta.qr === "string" ? bruta.qr : null,
        });
        props.origen_tipo = p.origen_tipo;
        if (p.origen_detalle) props.origen_detalle = p.origen_detalle;
        if (p.campana) props.campana = p.campana;
      }
      if (typeof props.idioma === "string" && !["es", "en", "fr"].includes(props.idioma)) delete props.idioma;
    }

    const ruta = sanearRuta(e.ruta);
    const objetivo = sanearTexto(e.objetivo, 120);
    const error = (e.error && typeof e.error === "object" ? e.error : {}) as Record<string, unknown>;
    const mensaje = def.categoria === "error" ? sanearTexto(error.mensaje ?? e.mensaje, 500) : null;
    const pila = def.categoria === "error" ? sanearPila(error.pila ?? e.pila) : null;
    const gravedad = gravedadDe(tipo, props);
    const huella = def.categoria === "error"
      ? await calcularHuella({ tipo, fuente: "navegador", mensaje, pila, ruta, objetivo: tipo === "error_peticion" ? String(props.endpoint ?? "") : objetivo, codigo: props.status as number | undefined })
      : null;
    const secuencia = numero(e.seq);

    salida.eventos.push({
      evento_id: eventoId,
      ocurrido_en: ocurrido.toISOString(),
      proyecto: ctx.proyecto,
      fuente: "navegador",
      categoria: def.categoria,
      tipo,
      accion: acc,
      // Sin consentimiento no hay sesión persistente: el navegador manda un id efímero (de la pestaña) que solo sirve para
      // relacionar los errores de esa misma carga de página.
      sesion_id: uuid(e.sesion),
      visitante_id: consentimiento ? uuid(e.visitante) : null,
      secuencia: secuencia !== null && secuencia >= 0 ? Math.floor(secuencia) : null,
      ruta,
      objetivo,
      valor: numero(e.valor),
      propiedades: props,
      dispositivo: ctx.dispositivo,
      navegador: ctx.navegador,
      so: ctx.so,
      es_bot: ctx.esBot,
      es_interno: esInterno,
      es_prueba: esPrueba,
      consentimiento,
      version,
      despliegue,
      gravedad,
      huella,
      mensaje,
      pila,
    });
  }
  return salida;
}
