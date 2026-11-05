/**
 * Validadores de las campañas y las ideas de la semana que propone la IA de
 * Instagram (Edge Function instagram-ia, acciones proponer_campana e
 * ideas_semana), en el SERVIDOR, después del modelo y antes de devolver o
 * guardar nada. Lógica pura, sin red ni Deno: se prueba con vitest.
 *
 * Usan los MISMOS validadores que los textos (validar-ia.ts: emoji, precios,
 * alérgenos, datos personales, platos que no están en la carta, límites de
 * Instagram y de la plantilla, «Touza» en mayúsculas) y además:
 *   · platos SOLO por id y existentes: una pieza con un plato_id que no está
 *     en la carta activa de la marca se DESCARTA;
 *   · TOUZA sin «reservar» en NINGÚN texto (título, objetivo, mensaje, por
 *     qué, encargo, rótulos, texto y hashtags): la campaña o la pieza se
 *     descartan;
 *   · sin emoji en ningún texto (se quitan y se avisa);
 *   · fechas: cada pieza dentro de la campaña (o de la semana); las de fuera
 *     se DESCARTAN. Fases recortadas al rango;
 *   · plantilla de la marca y con ese formato; foto solo de la biblioteca o
 *     de la carta (si no, «falta foto»).
 *
 * Diseño: instagram-studio/propuesta/PROPUESTA.md, apartados 3.1 y 3.5.
 */
import {
  erroresAlergenos,
  erroresDatosPersonales,
  erroresPlatos,
  erroresPrecio,
  mencionaReservar,
  quitarEmoji,
  revisarRotulos,
  revisarVarianteTexto,
  tieneEmoji,
  touzaEnMayusculas,
  type MarcaIA,
  type PlantillaRotulos,
  type PlatoContexto,
} from "./validar-ia.ts";

/** Plato de la carta tal como llega de instagram_ia_contexto (sin precio). */
export interface PlatoCarta {
  id: string;
  nombre: string;
  categoria?: string | null;
  descripcion?: string | null;
  featured?: boolean;
  tiene_foto?: boolean;
  alergenos_oficiales?: unknown;
  sin_gluten_disponible?: boolean;
  /** Dietas confirmadas ('vegetariano', 'vegano'), si las hay (20261104151000). */
  etiquetas_dieteticas?: unknown;
}

/** Plantilla con lo que hace falta para planificar. */
export interface PlantillaCampana extends PlantillaRotulos {
  formatos: readonly ("post" | "story")[];
  /** La plantilla lleva foto (si no hay, la pieza sale con «falta foto»). */
  conFoto: boolean;
}

export type FormatoCampana = "post" | "story";
export const FORMATOS_CAMPANA: readonly FormatoCampana[] = ["post", "story"];

export interface ContextoCampana {
  marca: MarcaIA;
  /** Rango (AAAA-MM-DD, ambos incluidos). */
  desde: string;
  hasta: string;
  carta: PlatoCarta[];
  ctas: string[];
  /** Ids de foto de la biblioteca que se pueden sugerir («drive:<id>»). */
  fotos: string[];
  /** Plantillas de la marca que se pueden usar. */
  plantillas: PlantillaCampana[];
  /** Piezas pedidas (semanas × piezas por semana). */
  maxPiezas: number;
  /** Mínimo de piezas válidas para dar la campaña por buena. */
  minPiezas: number;
  cuentasPropias?: string[];
}

export interface PiezaCampana {
  fecha: string;
  hora: string;
  formato: FormatoCampana;
  plantilla: string;
  platoId: string | null;
  plato: { id: string; nombre: string } | null;
  /** «drive:<id>» o «carta:<id>»; null si falta. */
  foto: string | null;
  /** La plantilla lleva foto y no hay una buena: hay que hacerla o pedirla. */
  faltaFoto: boolean;
  antetitulo: string;
  titular: string;
  gancho: string;
  caption: string;
  hashtags: string[];
  altText: string;
  porQue: string;
  fase: number;
  encargoSugerido: string;
  avisos: string[];
}

export interface FaseCampana {
  nombre: string;
  desde: string;
  hasta: string;
}

export interface Campana {
  titulo: string;
  objetivo: string;
  publico: string;
  mensaje: string;
  razonamiento: string;
  desde: string;
  hasta: string;
  fases: FaseCampana[];
  piezas: PiezaCampana[];
}

export interface Descartada {
  /** «Pieza 3 (2026-11-12)», o «Campaña» si es un fallo de toda la campaña. */
  donde: string;
  motivos: string[];
}

export interface RevisionCampana {
  ok: boolean;
  valor: Campana;
  /** Fallos que tumban la campaña entera (y los resúmenes de piezas descartadas). */
  errores: string[];
  descartadas: Descartada[];
  correcciones: string[];
}

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_FOTO_DRIVE = /^drive:[A-Za-z0-9_-]{10,200}$/;
const RE_FOTO_CARTA = /^carta:([A-Za-z0-9_-]{1,100})$/;
const HORA_POR_DEFECTO = "13:00";

const texto = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max).trim() : "");
const listaTextos = (v: unknown, max = 40): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, max) : [];

/** true si es AAAA-MM-DD y existe ese día. */
export function esFecha(v: unknown): boolean {
  if (typeof v !== "string" || !RE_FECHA.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** AAAA-MM-DD + n días. */
export function sumarDiasFecha(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Lunes de la semana de ese día. */
export function lunesDe(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  return sumarDiasFecha(dia, -((d.getUTCDay() + 6) % 7));
}

/** El plato de la carta para los validadores de texto (sin precio: cualquier precio es un error). */
export function platoParaValidar(p: PlatoCarta | null): PlatoContexto | null {
  if (!p) return null;
  return {
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion ?? null,
    categoria: p.categoria ?? null,
    precio_eur: null,
    unidad: null,
    alergenos_oficiales: p.alergenos_oficiales ?? null,
    sin_gluten_disponible: p.sin_gluten_disponible === true,
    etiquetas_dieteticas: p.etiquetas_dieteticas ?? null,
  };
}

/**
 * Texto libre de la campaña (título, objetivo, mensaje, por qué…): quita los
 * emoji, pone «TOUZA» y devuelve los fallos (precios, alérgenos, datos
 * personales, platos que no están en la carta y, en TOUZA, «reservar»).
 */
export function revisarTextoLibre(
  bruto: unknown,
  ctx: Pick<ContextoCampana, "marca" | "carta" | "cuentasPropias">,
  plato: PlatoCarta | null,
  max: number,
): { valor: string; errores: string[]; emoji: boolean } {
  const crudo = texto(bruto, max * 2);
  const emoji = tieneEmoji(crudo);
  let valor = quitarEmoji(crudo).replace(/[ \t]+/g, " ");
  if (ctx.marca === "touza") valor = touzaEnMayusculas(valor);
  if ([...valor].length > max) valor = [...valor].slice(0, max).join("").trim();
  const errores: string[] = [];
  if (valor) {
    errores.push(...erroresPrecio(valor, platoParaValidar(plato)));
    errores.push(...erroresAlergenos(valor, platoParaValidar(plato)));
    if (ctx.marca === "touza" && mencionaReservar(valor)) errores.push("TOUZA no admite reservas: no puede decir «reservar».");
    errores.push(...erroresDatosPersonales(valor, ctx.cuentasPropias));
    errores.push(...erroresPlatos(valor, [], { nombresCarta: ctx.carta.map((p) => p.nombre) }));
  }
  return { valor, errores: [...new Set(errores)], emoji };
}

function buscarPlato(id: unknown, carta: readonly PlatoCarta[]): { id: string | null; plato: PlatoCarta | null; error: string | null } {
  const v = typeof id === "string" ? id.trim() : "";
  if (!v) return { id: null, plato: null, error: null };
  const plato = carta.find((p) => p.id === v) ?? null;
  if (!plato) return { id: v, plato: null, error: `El plato «${v.slice(0, 60)}» no está en la carta activa de la marca (solo se citan platos por id y existentes).` };
  return { id: v, plato, error: null };
}

/** Comprueba y corrige una pieza de campaña. Nunca lanza. */
export function revisarPiezaCampana(bruta: unknown, ctx: ContextoCampana): { ok: boolean; valor: PiezaCampana; errores: string[]; correcciones: string[] } {
  const o = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
  const errores: string[] = [];
  const correcciones: string[] = [];

  // Fecha y hora.
  const fecha = texto(o.fecha, 20);
  if (!esFecha(fecha)) errores.push(`Fecha no válida («${fecha.slice(0, 20)}»).`);
  else if (fecha < ctx.desde || fecha > ctx.hasta) errores.push(`La fecha ${fecha} cae fuera de la campaña (${ctx.desde} a ${ctx.hasta}).`);
  let hora = texto(o.hora, 10);
  if (!RE_HORA.test(hora)) {
    correcciones.push(`Hora no válida: se ha puesto ${HORA_POR_DEFECTO}.`);
    hora = HORA_POR_DEFECTO;
  }

  // Formato y plantilla.
  const formato = texto(o.formato, 20) as FormatoCampana;
  if (!FORMATOS_CAMPANA.includes(formato)) errores.push(`Formato no válido («${formato.slice(0, 20)}»): solo post o story.`);
  const idPlantilla = texto(o.plantilla, 80);
  const plantilla = ctx.plantillas.find((p) => p.id === idPlantilla) ?? null;
  if (!plantilla) errores.push(`La plantilla «${idPlantilla}» no es de la marca.`);
  else if (FORMATOS_CAMPANA.includes(formato) && !plantilla.formatos.includes(formato)) {
    errores.push(`La plantilla «${plantilla.id}» no admite el formato ${formato}.`);
  }

  // Plato: solo por id y existente.
  const pl = buscarPlato(o.plato_id ?? o.platoId, ctx.carta);
  if (pl.error) errores.push(pl.error);

  // Foto: de la biblioteca o del plato de la carta (si tiene foto); si no, «falta foto».
  let foto: string | null = null;
  let faltaFoto = false;
  if (plantilla?.conFoto) {
    const pedida = texto(o.foto_sugerida ?? o.foto, 220);
    const deCarta = RE_FOTO_CARTA.exec(pedida)?.[1];
    if (RE_FOTO_DRIVE.test(pedida) && ctx.fotos.includes(pedida)) foto = pedida;
    else if (deCarta && ctx.carta.some((p) => p.id === deCarta && p.tiene_foto)) foto = pedida;
    else {
      if (pedida) correcciones.push("La foto sugerida no está en la biblioteca ni en la carta: queda como «falta foto».");
      faltaFoto = true;
    }
  }

  // Rótulos con los límites de la plantilla (titular ≤ 6 palabras…).
  let antetitulo = "";
  let titular = "";
  const platoCtx = platoParaValidar(pl.plato);
  const ctxIA = { marca: ctx.marca, plato: platoCtx, nombresCarta: ctx.carta.map((p) => p.nombre), ctas: ctx.ctas, cuentasPropias: ctx.cuentasPropias };
  if (plantilla) {
    const rot = revisarRotulos({ antetitulo: o.antetitulo, titular: o.titular }, plantilla, ctxIA);
    antetitulo = rot.valor.antetitulo ?? "";
    titular = rot.valor.titular ?? "";
    errores.push(...rot.errores);
    correcciones.push(...rot.correcciones);
  }

  // Texto, hashtags y texto alternativo: los MISMOS validadores que sugerir_texto.
  const txt = revisarVarianteTexto(
    { gancho: o.gancho, caption: o.caption, hashtags: o.hashtags, alt_text: o.alt_text ?? o.altText, platos_citados: pl.plato ? [pl.plato.nombre] : [] },
    ctxIA,
  );
  errores.push(...txt.errores);
  correcciones.push(...txt.correcciones);

  // Por qué y encargo sugerido.
  const porQue = revisarTextoLibre(o.por_que ?? o.porQue, ctx, pl.plato, 300);
  const encargo = revisarTextoLibre(o.encargo_sugerido ?? o.encargoSugerido, ctx, pl.plato, 300);
  errores.push(...porQue.errores, ...encargo.errores);
  if (porQue.emoji || encargo.emoji) correcciones.push("Se han quitado los emoji (la marca no los usa).");

  const fase = Number.isInteger(o.fase) && (o.fase as number) >= 0 ? (o.fase as number) : 0;
  return {
    ok: errores.length === 0,
    valor: {
      fecha,
      hora,
      formato,
      plantilla: idPlantilla,
      platoId: pl.plato ? pl.plato.id : null,
      plato: pl.plato ? { id: pl.plato.id, nombre: pl.plato.nombre } : null,
      foto,
      faltaFoto,
      antetitulo,
      titular,
      gancho: txt.valor.gancho,
      caption: txt.valor.caption,
      hashtags: txt.valor.hashtags,
      altText: txt.valor.altText,
      porQue: porQue.valor,
      fase,
      encargoSugerido: encargo.valor,
      avisos: [...new Set(correcciones)],
    },
    errores: [...new Set(errores)],
    correcciones: [...new Set(correcciones)],
  };
}

const MAX_CAMPOS = { titulo: 120, objetivo: 600, publico: 400, mensaje: 300, razonamiento: 1500 } as const;

/** Comprueba y corrige una campaña entera. Nunca lanza. */
export function revisarCampana(bruta: unknown, ctx: ContextoCampana): RevisionCampana {
  const o = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
  const errores: string[] = [];
  const correcciones: string[] = [];
  const descartadas: Descartada[] = [];

  const campos = {} as Record<keyof typeof MAX_CAMPOS, string>;
  let emoji = false;
  for (const [campo, max] of Object.entries(MAX_CAMPOS) as Array<[keyof typeof MAX_CAMPOS, number]>) {
    const r = revisarTextoLibre(o[campo], ctx, null, max);
    campos[campo] = r.valor;
    emoji ||= r.emoji;
    errores.push(...r.errores.map((e) => `${campo[0].toUpperCase()}${campo.slice(1)}: ${e}`));
  }
  if (!campos.titulo) errores.push("La campaña no tiene título.");
  if (emoji) correcciones.push("Se han quitado los emoji (la marca no los usa).");

  // Fases, recortadas al rango de la campaña.
  const fases: FaseCampana[] = [];
  for (const f of Array.isArray(o.fases) ? o.fases.slice(0, 6) : []) {
    const x = (f ?? {}) as Record<string, unknown>;
    const nombre = revisarTextoLibre(x.nombre, ctx, null, 60);
    if (!nombre.valor || nombre.errores.length) continue;
    let desde = esFecha(x.desde) ? (x.desde as string) : ctx.desde;
    let hasta = esFecha(x.hasta) ? (x.hasta as string) : ctx.hasta;
    if (desde < ctx.desde) desde = ctx.desde;
    if (hasta > ctx.hasta) hasta = ctx.hasta;
    if (hasta < desde) continue;
    fases.push({ nombre: nombre.valor, desde, hasta });
  }

  // Piezas: cada una se corrige o se descarta.
  const buenas: PiezaCampana[] = [];
  const brutas = Array.isArray(o.piezas) ? o.piezas.slice(0, 40) : [];
  brutas.forEach((b, i) => {
    const r = revisarPiezaCampana(b, ctx);
    if (r.ok) buenas.push(r.valor);
    else descartadas.push({ donde: `Pieza ${i + 1}${r.valor.fecha ? ` (${r.valor.fecha})` : ""}`, motivos: r.errores });
  });
  buenas.sort((a, b) => `${a.fecha} ${a.hora}`.localeCompare(`${b.fecha} ${b.hora}`));
  let piezas = buenas;
  if (piezas.length > ctx.maxPiezas) {
    correcciones.push(`Se han dejado ${ctx.maxPiezas} piezas, las que se pidieron.`);
    piezas = piezas.slice(0, ctx.maxPiezas);
  }
  for (const p of piezas) if (p.fase >= Math.max(fases.length, 1)) p.fase = 0;
  if (piezas.length < ctx.minPiezas) {
    errores.push(`Solo ${piezas.length} de ${brutas.length} piezas han pasado las comprobaciones (hacen falta ${ctx.minPiezas}).`);
  }
  if (errores.length) descartadas.unshift({ donde: "Campaña", motivos: [...new Set(errores)] });

  return {
    ok: errores.length === 0,
    valor: { ...campos, desde: ctx.desde, hasta: ctx.hasta, fases, piezas },
    errores: [...new Set(errores)],
    descartadas,
    correcciones: [...new Set(correcciones)],
  };
}

// ── Ideas de la semana ──────────────────────────────────────────────────────

export type MotivoIdea = "fecha_senalada" | "temporada" | "plato" | "novedad" | "metricas";
export const MOTIVOS_IDEA: readonly MotivoIdea[] = ["fecha_senalada", "temporada", "plato", "novedad", "metricas"];

export interface IdeaSemana {
  fecha: string;
  titulo: string;
  idea: string;
  motivo: MotivoIdea;
  formato: FormatoCampana;
  plantilla: string;
  platoId: string | null;
  plato: { id: string; nombre: string } | null;
  gancho: string;
  avisos: string[];
}

/** Comprueba y corrige una idea de la semana. Nunca lanza. */
export function revisarIdea(bruta: unknown, ctx: ContextoCampana): { ok: boolean; valor: IdeaSemana; errores: string[] } {
  const o = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
  const errores: string[] = [];
  const avisos: string[] = [];
  const fecha = texto(o.fecha, 20);
  if (!esFecha(fecha)) errores.push(`Fecha no válida («${fecha.slice(0, 20)}»).`);
  else if (fecha < ctx.desde || fecha > ctx.hasta) errores.push(`La fecha ${fecha} cae fuera de la semana (${ctx.desde} a ${ctx.hasta}).`);
  const formato = texto(o.formato, 20) as FormatoCampana;
  if (!FORMATOS_CAMPANA.includes(formato)) errores.push(`Formato no válido («${formato.slice(0, 20)}»).`);
  const plantilla = texto(o.plantilla, 80);
  const p = ctx.plantillas.find((x) => x.id === plantilla);
  if (!p) errores.push(`La plantilla «${plantilla}» no es de la marca.`);
  else if (FORMATOS_CAMPANA.includes(formato) && !p.formatos.includes(formato)) errores.push(`La plantilla «${plantilla}» no admite ${formato}.`);
  const motivo = (MOTIVOS_IDEA as readonly string[]).includes(texto(o.motivo, 30)) ? (texto(o.motivo, 30) as MotivoIdea) : "plato";
  const pl = buscarPlato(o.plato_id ?? o.platoId, ctx.carta);
  if (pl.error) errores.push(pl.error);
  let emoji = false;
  const campos: Record<"titulo" | "idea" | "gancho", string> = { titulo: "", idea: "", gancho: "" };
  for (const [campo, max] of [["titulo", 120], ["idea", 500], ["gancho", 160]] as const) {
    const r = revisarTextoLibre(o[campo], ctx, pl.plato, max);
    campos[campo] = r.valor;
    emoji ||= r.emoji;
    errores.push(...r.errores);
  }
  if (!campos.titulo || !campos.idea) errores.push("Idea sin título o sin texto.");
  if (emoji) avisos.push("Se han quitado los emoji (la marca no los usa).");
  return {
    ok: errores.length === 0,
    valor: {
      fecha,
      titulo: campos.titulo,
      idea: campos.idea,
      motivo,
      formato,
      plantilla,
      platoId: pl.plato ? pl.plato.id : null,
      plato: pl.plato ? { id: pl.plato.id, nombre: pl.plato.nombre } : null,
      gancho: campos.gancho,
      avisos,
    },
    errores: [...new Set(errores)],
  };
}
