// Tablero de gráficas del copiloto de Facturas (pestaña «Análisis»).
//
// Parte pura (sin React) para poder probarla sola:
//   · qué tarjetas hay en el tablero (gráficas de la IA + respuestas al instante),
//   · la explicación corta que acompaña a cada gráfica,
//   · los chips de seguimiento «pregúntale más» según el tipo de tarjeta,
//   · el contexto que viaja con la pregunta cuando hay una tarjeta seleccionada.
//
// DECISIÓN (05/11/2026): el contexto de la tarjeta seleccionada viaja DENTRO
// del texto del mensaje (al final, entre corchetes) y no en un campo aparte de
// la Edge Function. Así no hay que tocar `chat-facturas`: el mensaje se guarda
// tal cual en `chat_facturas_mensajes`, el modelo lo ve en la pregunta actual y
// también en el historial de las siguientes, y la pantalla lo separa
// (`separarContexto`) para enseñar solo la pregunta y una etiqueta «sobre …».
import {
  esSerieSinDatos,
  nombreProveedor,
  normalizarSerie,
  proveedoresUsados,
  type SeriePrecio,
} from "./seriePrecio";
import type { MensajeChat } from "@/hooks/useChatFacturas";
import type { ResultadoRapido } from "@/hooks/usePreguntasRapidas";

// ─── Tarjetas ────────────────────────────────────────────────────────────────

/** Gráfica que ha mandado la IA como adjunto de una respuesta. */
export interface TarjetaIa {
  origen: "ia";
  /** `${mensajeId}#${índice del adjunto}`: estable entre recargas (el id es el de la BD). */
  id: string;
  mensajeId: string;
  creadoEn: string;
  titulo: string;
  serie: SeriePrecio;
  /** 1-2 frases de la respuesta de la IA. */
  explicacion: string;
}

/** Respuesta «al instante» (sin IA) de las preguntas rápidas. */
export interface TarjetaRapida {
  origen: "rapida";
  /** El id del resultado (solo vive en memoria). */
  id: string;
  creadoEn: string;
  resultado: ResultadoRapido;
}

export type Tarjeta = TarjetaIa | TarjetaRapida;

/** Id del DOM de una tarjeta (para «Ver gráfica» desde el copiloto). */
export const idDomTarjeta = (id: string) => `tarjeta-grafica-${id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

export const tituloSerie = (serie: Pick<SeriePrecio, "producto">) =>
  `Evolución del precio · ${serie.producto || "producto"}`;

/** Gráficas de la IA de una conversación (una tarjeta por adjunto con datos). */
export function tarjetasDeMensajes(mensajes: MensajeChat[]): TarjetaIa[] {
  const salida: TarjetaIa[] = [];
  for (const m of mensajes) {
    if (m.rol !== "assistant") continue;
    (m.adjuntos ?? []).forEach((a, i) => {
      if (a.tipo !== "serie_precio" || esSerieSinDatos(a.datos)) return;
      salida.push({
        origen: "ia",
        id: `${m.id}#${i}`,
        mensajeId: m.id,
        creadoEn: m.created_at,
        titulo: tituloSerie(a.datos),
        serie: a.datos,
        explicacion: explicacionCorta(m.contenido),
      });
    });
  }
  return salida;
}

/**
 * Tarjetas del tablero, la más reciente primero (la nueva aparece arriba, sin
 * tener que bajar). `ocultas`: ids de las que el usuario ha quitado.
 */
export function tarjetasTablero(
  mensajes: MensajeChat[],
  rapidas: ResultadoRapido[],
  ocultas: ReadonlySet<string> = new Set(),
): Tarjeta[] {
  const ia: Tarjeta[] = tarjetasDeMensajes(mensajes).filter((t) => !ocultas.has(t.id));
  const al: Tarjeta[] = rapidas.map((r) => ({ origen: "rapida", id: r.id, creadoEn: r.creadoEn, resultado: r }));
  return [...ia, ...al].sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : a.creadoEn > b.creadoEn ? -1 : 0));
}

/** La serie de precio de una tarjeta (gráfica de la IA o «Evolución de precio» al instante). */
export function serieDeTarjeta(t: Tarjeta): SeriePrecio | null {
  if (t.origen === "ia") return t.serie;
  if (t.resultado.preguntaId !== "evolucion-precio" || t.resultado.estado !== "ok") return null;
  const serie = normalizarSerie(t.resultado.datos);
  return serie && !esSerieSinDatos(serie) ? serie : null;
}

// ─── Explicación corta ───────────────────────────────────────────────────────

const MAX_EXPLICACION = 240;

/** Quita el formato markdown más habitual (negritas, enlaces, listas, títulos). */
export function textoPlano(md: string): string {
  return md
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/^\s{0,3}(#{1,6}|[-+]|\d+[.)])\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Las 1-2 primeras frases útiles de la respuesta de la IA, para ponerlas bajo
 * la gráfica. Se saltan las que solo anuncian la gráfica («te dejo la gráfica
 * debajo»), que en el tablero no tienen sentido.
 */
export function explicacionCorta(respuesta: string): string {
  const frases = (textoPlano(respuesta).match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) ?? [])
    .map((f) => f.trim())
    .filter((f) => f && !/gr[aá]fica (debajo|abajo)|te dejo la gr[aá]fica|aqu[ií] tienes la gr[aá]fica/i.test(f));
  let salida = "";
  for (const f of frases.slice(0, 2)) {
    const siguiente = salida ? `${salida} ${f}` : f;
    if (siguiente.length > MAX_EXPLICACION) {
      if (!salida) salida = `${f.slice(0, MAX_EXPLICACION - 1).trimEnd()}…`;
      break;
    }
    salida = siguiente;
  }
  return salida;
}

// ─── Chips de seguimiento «pregúntale más» ───────────────────────────────────

export interface ChipSeguimiento {
  /** Lo que se ve en el chip (corto). */
  etiqueta: string;
  /** La pregunta que se manda a la IA (con la tarjeta como contexto). */
  pregunta: string;
}

function chipsSerie(serie: SeriePrecio): ChipSeguimiento[] {
  const p = `«${serie.producto}»`;
  const variacion = serie.variacion_pct ?? 0;
  const chips: ChipSeguimiento[] = [
    { etiqueta: "Solo los últimos 3 meses", pregunta: `Enséñame la gráfica del precio de ${p} solo de los últimos 3 meses.` },
  ];
  if (variacion > 0) chips.push({ etiqueta: "¿Por qué subió?", pregunta: `¿Por qué ha subido el precio de ${p}? ¿Cuándo empezó y con qué proveedor?` });
  else if (variacion < 0) chips.push({ etiqueta: "¿Por qué bajó?", pregunta: `¿Por qué ha bajado el precio de ${p}? ¿Cuándo y con qué proveedor?` });
  chips.push(
    proveedoresUsados(serie).length > 1
      ? { etiqueta: "¿Quién es más barato?", pregunta: `Compara el precio de ${p} entre sus proveedores: ¿quién nos lo vende más barato ahora?` }
      : { etiqueta: "Compáralo con otro proveedor", pregunta: `¿Hay algún otro proveedor que nos haya vendido ${p} más barato?` },
  );
  chips.push({ etiqueta: "¿Cuánto hemos comprado?", pregunta: `¿Cuánto ${p} hemos comprado y a quién en el último año?` });
  return chips;
}

/** Chips de las respuestas al instante, por pregunta. */
const CHIPS_RAPIDA: Record<string, ChipSeguimiento[]> = {
  "gasto-mes": [
    { etiqueta: "¿Por qué ha cambiado?", pregunta: "¿Por qué ha cambiado el gasto de este mes frente al anterior? ¿Qué proveedores lo explican?" },
    { etiqueta: "Desglósalo por proveedor", pregunta: "Desglosa el gasto de este mes por proveedor." },
  ],
  "gasto-por-mes": [
    { etiqueta: "¿Qué mes gastamos más?", pregunta: "¿En qué mes de los últimos 12 gastamos más y por qué?" },
    { etiqueta: "Compáralo con el año pasado", pregunta: "Compara el gasto de los últimos meses con los mismos meses del año pasado." },
    { etiqueta: "Solo los últimos 3 meses", pregunta: "¿Cuánto hemos gastado en cada uno de los últimos 3 meses y en qué?" },
  ],
  "top-proveedores": [
    { etiqueta: "¿Qué le compramos al primero?", pregunta: "¿Qué le compramos a nuestro primer proveedor de este año y cuánto?" },
    { etiqueta: "Compáralo con el año pasado", pregunta: "Compara el gasto con nuestros principales proveedores este año frente al año pasado." },
  ],
  "productos-mas-comprados": [
    { etiqueta: "¿Cuáles han subido de precio?", pregunta: "De los productos que más compramos, ¿cuáles han subido de precio?" },
    { etiqueta: "¿A quién se los compramos?", pregunta: "¿A qué proveedores les compramos los productos que más compramos?" },
  ],
  "gasto-categoria": [
    { etiqueta: "Desglósalo por mes", pregunta: "Desglosa por mes el gasto por categoría de este año." },
    { etiqueta: "¿Qué categoría ha crecido?", pregunta: "¿Qué categoría de producto ha crecido más este año?" },
  ],
  "subidas-precio": [
    { etiqueta: "Gráfica del que más subió", pregunta: "Enséñame la gráfica de precio del producto que más ha subido." },
    { etiqueta: "¿Hay alternativa más barata?", pregunta: "Para los productos que más han subido, ¿hay otro proveedor que los venda más barato?" },
  ],
  "por-revisar": [
    { etiqueta: "¿De qué proveedores son?", pregunta: "¿De qué proveedores son los documentos sin revisar y cuánto suman?" },
  ],
  "con-avisos": [
    { etiqueta: "¿Cuáles son más graves?", pregunta: "De los documentos con avisos, ¿cuáles son los más importantes de revisar?" },
  ],
  "sin-total": [
    { etiqueta: "¿De qué proveedores son?", pregunta: "¿De qué proveedores son los documentos sin total?" },
  ],
};

/** Chips «pregúntale más» de una tarjeta (vacío si no hay nada útil que ofrecer). */
export function chipsSeguimiento(t: Tarjeta): ChipSeguimiento[] {
  const serie = serieDeTarjeta(t);
  if (serie) return chipsSerie(serie);
  if (t.origen === "rapida" && t.resultado.estado === "ok") return CHIPS_RAPIDA[t.resultado.preguntaId] ?? [];
  return [];
}

// ─── Contexto de la tarjeta seleccionada ─────────────────────────────────────

const fechaEs = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const numeroEs = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Título corto de una tarjeta (cabecera, etiqueta «sobre …» del copiloto). */
export function tituloTarjeta(t: Tarjeta, etiquetaPregunta?: string): string {
  const serie = serieDeTarjeta(t);
  if (serie) return tituloSerie(serie);
  if (t.origen === "ia") return t.titulo;
  return etiquetaPregunta ?? "Consulta al instante";
}

/**
 * Descripción de la tarjeta para el modelo: qué gráfica es y con qué
 * parámetros, para que pueda responder sobre ella o volver a generarla
 * cambiada (otro periodo, otra unidad…).
 */
export function contextoTarjeta(t: Tarjeta, pregunta?: { etiqueta: string; descripcion: string }): string {
  const serie = serieDeTarjeta(t);
  if (serie) {
    const desde = serie.puntos[0]?.[0];
    const hasta = serie.puntos[serie.puntos.length - 1]?.[0];
    const unidad = serie.unidad ? ` €/${serie.unidad}` : " €";
    const partes = [
      `gráfica de evolución del precio unitario sin IVA de «${serie.producto}»${serie.unidad ? ` (unidad ${serie.unidad})` : ""}`,
      `proveedores: ${proveedoresUsados(serie).map((i) => nombreProveedor(serie, i)).join(", ")}`,
      desde && hasta ? `${serie.n} compras del ${fechaEs(desde)} al ${fechaEs(hasta)}` : `${serie.n} compras`,
      `último ${numeroEs(serie.ultimo)}${unidad}, mínimo ${numeroEs(serie.min)}${unidad}, máximo ${numeroEs(serie.max)}${unidad}` +
        (serie.variacion_pct === null ? "" : `, variación ${serie.variacion_pct > 0 ? "+" : ""}${numeroEs(serie.variacion_pct)} %`),
      `si te pido cambiarla (otro periodo u otra unidad), vuelve a generarla con grafico_precio para «${serie.producto}»`,
    ];
    return partes.join("; ");
  }
  if (t.origen === "rapida") {
    const nombre = pregunta?.etiqueta ?? t.resultado.preguntaId;
    return `respuesta al instante «${nombre}»${pregunta?.descripcion ? ` (${pregunta.descripcion})` : ""}; calcula las cifras con tus herramientas`;
  }
  return t.titulo;
}

const INICIO_CONTEXTO = "[Sobre la gráfica seleccionada: ";
const PATRON_CONTEXTO = /\n\n\[Sobre la gráfica seleccionada: ([\s\S]*)\]\s*$/;

/** Pregunta + contexto, tal y como se guarda y se manda a `chat-facturas`. */
export function componerMensaje(pregunta: string, contexto?: string | null): string {
  const limpio = contexto?.replace(/[[\]]/g, "").trim();
  return limpio ? `${pregunta.trim()}\n\n${INICIO_CONTEXTO}${limpio}]` : pregunta.trim();
}

/** Separa la pregunta del contexto para enseñarla en el copiloto. */
export function separarContexto(contenido: string): { pregunta: string; contexto: string | null } {
  const m = PATRON_CONTEXTO.exec(contenido);
  if (!m) return { pregunta: contenido, contexto: null };
  return { pregunta: contenido.slice(0, m.index).trim(), contexto: m[1] };
}

/** Cómo se llama la gráfica en la etiqueta «sobre …» de un mensaje ya enviado. */
export function asuntoDeContexto(contexto: string): string {
  const serie = /evolución del precio unitario sin IVA de «([^»]+)»/.exec(contexto);
  if (serie) return `precio de ${serie[1]}`;
  const rapida = /respuesta al instante «([^»]+)»/.exec(contexto);
  if (rapida) return rapida[1];
  return "la gráfica";
}
