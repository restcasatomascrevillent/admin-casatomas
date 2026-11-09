/**
 * Edge Function rrss-ia — la IA que PROPONE en el editor de RRSS. Nunca toca
 * un archivo ni publica nada: devuelve el plan de edición (que ejecuta el
 * motor de Vercel, api/rrss-foto y api/rrss-video), los textos, las ideas
 * para grabar o la transcripción de la voz de un clip.
 *
 *   POST `${SUPABASE_URL}/functions/v1/rrss-ia`   Authorization: Bearer <JWT> (Marketing con «Editar»)
 *
 *   { accion: "proponer",    proyectoId }                         → { ok, plan, avisos, modelo }
 *   { accion: "pieza",       proyectoId, indice, indicacion? }    → { ok, plan, pieza, avisos }   (solo esa foto)
 *   { accion: "textos",      proyectoId }                         → { ok, textos, avisos }        (solo el texto)
 *   { accion: "ideas",       marca, canal, tipo?, promocionar: { tipo, detalle, platoId?, vinoId? }, material? }
 *                                                                 → { ok, id, ideas, preguntas, avisos }
 *   { accion: "transcribir", archivoId }                          → { ok, segmentos, texto }
 *
 *   400 entrada · 401/403 sesión o permiso · 404 no existe · 409 archivos sin analizar
 *   429 cupo diario (80 por usuario) · 502 OpenAI · 503 falta la clave o la migración
 *
 * Instrucciones en tres capas separadas (prompts.ts): permanentes (sistema),
 * datos del restaurante (<<<DATOS) e instrucciones del usuario (<<<USUARIO).
 * La IA ve las imágenes: la previa de cada foto y la hoja de contactos de
 * cada vídeo (9 fotogramas con su segundo), por URL firmada de 15 minutos del
 * cubo privado «rrss». Todo con el JWT del usuario (RLS); la clave de OpenAI
 * (OPENAI_API_KEY, la general: claveOpenAI("otros")) solo vive aquí.
 *
 * Después del modelo: normalizarPlan (límites del motor y fidelidad: lo
 * creativo solo si el trabajo lo permite) y los validadores de textos
 * (_shared/rrss/validar.ts: precios, promociones, datos personales,
 * alérgenos, TOUZA sin reservas).
 */
import { claveOpenAI } from "../_shared/clave-openai.ts";
import { motivoErrorOpenAI } from "../_shared/error-openai.ts";
import { AcumuladorUso, registrarUso, type OpcionesRegistro } from "../_shared/registrar-uso-ia.ts";
import { json, jsonAuth, leerJson, opciones } from "../_shared/instagram/http.ts";
import { registrarSecreto, sanear } from "../_shared/instagram/secretos.ts";
import { autorizarMarketing, type Sesion } from "../_shared/instagram/supabase.ts";
import { anonimizar, type MarcaIA } from "../_shared/instagram/validar-ia.ts";
import { ErrorOpenAI, leerGuia, leerNombresCarta, leerPlato, leerVino, leerVinosMarca, pedirModelo, platoParaModelo, type Mensaje, type ParteMensaje } from "../instagram-ia/ia.ts";
import { esEstilo, ESTILOS, type EstiloId } from "../_shared/rrss/estilos.ts";
import { esCanal, esTipoContenido, formatoSalida, problemasArchivos, proporcion, type Canal, type FormatoSalida, type TipoContenido } from "../_shared/rrss/formatos.ts";
import { normalizarHashtags, normalizarPlan, MAX_HASHTAGS, type PiezaFoto, type PlanEdicion } from "../_shared/rrss/plan.ts";
import { revisarCampos, revisarTexto, type ContextoTexto } from "../_shared/rrss/validar.ts";
import {
  bloque,
  catalogoEstilos,
  ESQUEMA_IDEAS,
  ESQUEMA_PIEZA,
  ESQUEMA_PLAN,
  ESQUEMA_TEXTOS,
  INSTRUCCIONES_IDEAS,
  INSTRUCCIONES_PIEZA,
  INSTRUCCIONES_PROPONER,
  INSTRUCCIONES_TEXTOS,
  sistema,
} from "./prompts.ts";

export const FUNCION = "rrss-ia";
export const MODELO_POR_DEFECTO = "gpt-5.6-luna";
export const MODELO_TRANSCRIPCION = "whisper-1";
export const OPENAI = "https://api.openai.com/v1";
const MS = 15_000;
const MAX_INDICACION = 1000;
const ID = /^[0-9a-f-]{36}$/i;

export type Accion = "proponer" | "pieza" | "textos" | "ideas" | "transcribir";
const ACCIONES: readonly Accion[] = ["proponer", "pieza", "textos", "ideas", "transcribir"];

export interface DependenciasRrssIA {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  registrar?: (uso: AcumuladorUso, opciones: OpcionesRegistro) => Promise<void>;
}

const NOMBRES_ENTORNO = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENAI_API_KEY", "RRSS_IA_MODEL", "RRSS_TRANSCRIPCION_MODEL"] as const;

export function entornoRrss(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO) salida[n] = deno?.env.get(n);
  return salida;
}

export class ErrorRrss extends Error {
  readonly estado: number;
  readonly extra: Record<string, unknown>;
  constructor(mensaje: string, estado = 400, extra: Record<string, unknown> = {}) {
    super(mensaje);
    this.estado = estado;
    this.extra = extra;
  }
}

// ── Lectura (como el usuario) ───────────────────────────────────────────────

const cab = (s: Sesion, extra: Record<string, string> = {}) => ({ apikey: s.sb.clave, Authorization: `Bearer ${s.token}`, ...extra });

async function textoError(r: Response): Promise<string> {
  return sanear(await r.text().catch(() => "")).slice(0, 300);
}

const faltaTabla = (estado: number, t: string) => estado === 404 || /relation .* does not exist|Could not find the table|PGRST205/i.test(t);

async function sel<T>(s: Sesion, tabla: string, consulta: string): Promise<T[]> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}?${consulta}`, { headers: cab(s, { Accept: "application/json" }), signal: AbortSignal.timeout(MS) });
  if (!r.ok) {
    const t = await textoError(r);
    if (faltaTabla(r.status, t)) throw new ErrorRrss("Falta aplicar la migración 20261118100000_rrss en este Supabase.", 503);
    throw new ErrorRrss(`No se pudo leer ${tabla} (${r.status})`, 502);
  }
  return (await r.json()) as T[];
}

async function patch(s: Sesion, tabla: string, filtro: string, cambios: Record<string, unknown>): Promise<void> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/${tabla}?${filtro}`, {
    method: "PATCH",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify(cambios),
    signal: AbortSignal.timeout(MS),
  });
  if (!r.ok) throw new ErrorRrss(`No se pudo guardar en ${tabla}: ${await textoError(r)}`, 502);
}

interface FilaProyecto {
  id: string;
  marca: MarcaIA;
  canal: Canal;
  tipo: TipoContenido;
  estilo: EstiloId;
  instrucciones: string;
  permitir_creativo: boolean;
  titulo: string;
  plan: unknown;
  textos: Record<string, unknown> | null;
}

interface FilaArchivo {
  id: string;
  tipo: "foto" | "video";
  estado: string;
  orden: number;
  ancho: number | null;
  alto: number | null;
  duracion_s: number | string | null;
  analisis: Record<string, unknown>;
}

async function leerProyecto(s: Sesion, id: string): Promise<FilaProyecto> {
  if (!ID.test(id)) throw new ErrorRrss("proyectoId no válido");
  const [p] = await sel<FilaProyecto>(s, "rrss_proyectos", `id=eq.${id}&select=id,marca,canal,tipo,estilo,instrucciones,permitir_creativo,titulo,plan,textos`);
  if (!p) throw new ErrorRrss("Ese trabajo no existe o no lo puedes ver", 404);
  return p;
}

async function leerArchivos(s: Sesion, proyecto: string): Promise<FilaArchivo[]> {
  return sel<FilaArchivo>(s, "rrss_archivos", `proyecto_id=eq.${proyecto}&select=id,tipo,estado,orden,ancho,alto,duracion_s,analisis&order=orden.asc`);
}

/** URL firmada (15 min) de un objeto del cubo privado: la que «ve» la IA. */
async function firmar(s: Sesion, ruta: string): Promise<string | null> {
  try {
    const r = await s.fetch(`${s.sb.url}/storage/v1/object/sign/rrss/${ruta.split("/").map(encodeURIComponent).join("/")}`, {
      method: "POST",
      headers: cab(s, { "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: 900 }),
      signal: AbortSignal.timeout(MS),
    });
    if (!r.ok) return null;
    const j = (await r.json().catch(() => null)) as { signedURL?: string; signedUrl?: string } | null;
    const rel = j?.signedURL ?? j?.signedUrl;
    if (!rel) return null;
    return rel.startsWith("http") ? rel : `${s.sb.url}/storage/v1${rel.startsWith("/") ? "" : "/"}${rel}`;
  } catch {
    return null;
  }
}

/** Reserva el cupo (el disparador de la tabla lo cuenta). 429 si se ha llegado al tope. */
async function reservar(s: Sesion, accion: Accion, proyecto: string | null, modelo: string): Promise<number | null> {
  const r = await s.fetch(`${s.sb.url}/rest/v1/rrss_ia_peticiones?select=id`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ accion, proyecto_id: proyecto, modelo }),
    signal: AbortSignal.timeout(MS),
  });
  if (r.ok) {
    const filas = (await r.json().catch(() => [])) as Array<{ id?: number }>;
    return filas?.[0]?.id ?? null;
  }
  const t = await textoError(r);
  if (/rrss_cupo_ia/.test(t)) throw new ErrorRrss("Has llegado al tope de 80 peticiones a la IA por hoy. Mañana se renueva.", 429, { tipo: "cupo" });
  if (faltaTabla(r.status, t)) throw new ErrorRrss("Falta aplicar la migración 20261118100000_rrss en este Supabase.", 503);
  if (r.status === 403 || r.status === 401) throw new ErrorRrss("Hace falta «Editar» en Marketing para usar la IA", 403);
  throw new ErrorRrss(`No se pudo reservar el cupo de la IA (${r.status})`, 502);
}

async function marcar(s: Sesion, id: number | null, ok: boolean): Promise<void> {
  if (id === null) return;
  await patch(s, "rrss_ia_peticiones", `id=eq.${id}`, { ok }).catch(() => undefined);
}

// ── Contexto del restaurante (DATOS) ────────────────────────────────────────

async function datosRestaurante(s: Sesion, marca: MarcaIA, avisos: string[]) {
  const guia = await leerGuia(s, marca).catch(() => {
    avisos.push("No se pudo leer la guía de la marca: la IA trabaja con las reglas generales");
    return null;
  });
  const carta = await leerNombresCarta(s, marca).catch(() => [] as string[]);
  const vinos = (await leerVinosMarca(s, marca)).slice(0, 150).map((v) => ({ nombre: v.nombre, tipo: (v as { categoria?: string }).categoria ?? null, do: (v as { denominacion_origen?: string }).denominacion_origen ?? null }));
  return {
    marca: marca === "touza" ? "TOUZA Cocktail Bar (Crevillent)" : "Restaurante Casa Tomás (Crevillent)",
    guia: guia?.guia ?? null,
    hashtags_de_la_casa: guia?.hashtags_base ?? [],
    llamadas_a_la_accion: guia?.ctas ?? [],
    carta_platos: carta.slice(0, 300),
    carta_vinos: vinos,
  };
}

function datosFormato(f: FormatoSalida) {
  return {
    canal: f.canal,
    tipo: f.tipo,
    medio: f.medio,
    medidas: `${f.ancho}×${f.alto} (${proporcion(f)})`,
    duracion_s: f.duracion ?? null,
    zona_segura_px: f.zonaSegura,
  };
}

function datosArchivo(a: FilaArchivo) {
  const tr = Array.isArray(a.analisis?.transcripcion) ? (a.analisis.transcripcion as Array<{ inicio: number; fin: number; texto: string }>) : [];
  return {
    id: a.id,
    tipo: a.tipo,
    medidas: a.ancho && a.alto ? `${a.ancho}×${a.alto}` : null,
    duracion_s: a.duracion_s === null ? null : Number(a.duracion_s),
    hdr: a.analisis?.hdr === true,
    sonido: a.tipo === "video" ? (a.analisis?.tiene_audio ? "sí" : "no") : undefined,
    voz_transcrita: tr.length
      ? tr
          .map((x) => `[${Number(x.inicio).toFixed(1)}-${Number(x.fin).toFixed(1)} s] ${x.texto}`)
          .join(" ")
          .slice(0, 2500)
      : null,
    hoja_de_contactos_segundos: a.analisis?.hoja_instantes ?? null,
  };
}

async function imagenesArchivos(s: Sesion, archivos: FilaArchivo[], detalleFotos: "low" | "high"): Promise<ParteMensaje[]> {
  const partes: ParteMensaje[] = [];
  for (const a of archivos) {
    const ruta = (a.tipo === "video" ? a.analisis?.hoja_ruta : a.analisis?.previa_ruta) as string | undefined;
    if (!ruta) continue;
    const url = await firmar(s, ruta);
    if (!url) continue;
    partes.push({ type: "text", text: a.tipo === "video" ? `Hoja de contactos del vídeo ${a.id} (cada fotograma lleva su segundo):` : `Foto ${a.id}:` });
    partes.push({ type: "image_url", image_url: { url, detail: a.tipo === "video" ? "high" : detalleFotos } });
  }
  return partes;
}

// ── Revisión de textos ──────────────────────────────────────────────────────

function revisarPlan(plan: PlanEdicion, ctx: ContextoTexto, canal: Canal): PlanEdicion {
  const avisos: string[] = [...plan.avisos];
  const piezas = plan.piezas.map((p) => {
    if (p.tipo === "foto") {
      const rotulos = p.rotulos ? revisarCampos(p.rotulos, ["antetitulo", "titulo", "subtitulo", "cta"], ctx, avisos) : null;
      return { ...p, rotulos, altText: revisarTexto(p.altText, ctx).texto };
    }
    const titulos = p.titulos.map((t) => ({ ...t, texto: revisarTexto(t.texto, ctx).texto })).filter((t) => t.texto);
    const cierre = revisarCampos(p.cierre, ["titulo", "cta"], ctx, avisos);
    return { ...p, titulos, cierre };
  });
  const caption = revisarTexto(plan.textos.caption, ctx);
  const titular = revisarTexto(plan.textos.titular, ctx);
  avisos.push(...caption.avisos, ...titular.avisos);
  let hashtags = normalizarHashtags(plan.textos.hashtags, MAX_HASHTAGS[canal]);
  if (ctx.marca === "touza") hashtags = hashtags.filter((h) => !/reserv/i.test(h));
  return { ...plan, piezas, textos: { caption: caption.texto, hashtags, titular: titular.texto }, avisos: [...new Set(avisos)] };
}

/** De la respuesta del modelo (fotos[] + video) a la forma de PlanEdicion. */
function planDesdeModelo(d: Record<string, unknown>, estilo: EstiloId): Record<string, unknown> {
  const fotos = Array.isArray(d.fotos) ? d.fotos.map((f) => ({ ...(f as object), tipo: "foto" })) : [];
  const video = d.video && typeof d.video === "object" ? [{ ...(d.video as object), tipo: "video" }] : [];
  return { resumen: d.resumen, preguntas: d.preguntas, estilo, piezas: [...fotos, ...video], textos: d.textos, avisos: d.avisos };
}

// ── Acciones ────────────────────────────────────────────────────────────────

interface Llamada {
  s: Sesion;
  f: typeof fetch;
  clave: string;
  modelo: string;
  uso: AcumuladorUso;
  cuerpo: Record<string, unknown>;
}

function contextoPlan(p: FilaProyecto, archivos: FilaArchivo[]) {
  const formato = formatoSalida(p.canal, p.tipo, archivos.some((a) => a.tipo === "video"));
  return {
    formato,
    ctx: {
      archivos: archivos.map((a) => ({ id: a.id, tipo: a.tipo, duracion_s: a.duracion_s === null ? null : Number(a.duracion_s) })),
      formato,
      estilo: esEstilo(p.estilo) ? p.estilo : ("elegante" as EstiloId),
      permitirCreativo: p.permitir_creativo === true,
      conVoz: archivos.filter((a) => Array.isArray(a.analisis?.transcripcion) && (a.analisis.transcripcion as unknown[]).length > 0).map((a) => a.id),
    },
  };
}

async function proponer({ s, f, clave, modelo, uso, cuerpo }: Llamada): Promise<Response> {
  const p = await leerProyecto(s, String(cuerpo.proyectoId ?? ""));
  const archivos = await leerArchivos(s, p.id);
  const pendientes = archivos.filter((a) => a.estado !== "listo");
  if (pendientes.length) throw new ErrorRrss("Espera a que terminen de prepararse todos los archivos (o quita los que dieron error)", 409);
  const { formato, ctx } = contextoPlan(p, archivos);
  const problemas = problemasArchivos(formato, archivos);
  if (problemas.length) throw new ErrorRrss(problemas[0], 400, { problemas });
  const avisos: string[] = [];
  const datos = {
    restaurante: await datosRestaurante(s, p.marca, avisos),
    formato: datosFormato(formato),
    estilo_elegido: { id: ctx.estilo, ...catalogoEstilos().find((e) => e.id === ctx.estilo) },
    estilos: catalogoEstilos(),
    trabajo: { permitir_transformaciones_creativas: ctx.permitirCreativo, archivos: archivos.map(datosArchivo) },
  };
  const usuario = anonimizar([p.titulo ? `Título: ${p.titulo}` : "", p.instrucciones].filter(Boolean).join("\n")).slice(0, MAX_INDICACION);
  const imagenes = await imagenesArchivos(s, archivos, archivos.filter((a) => a.tipo === "foto").length > 3 ? "low" : "high");
  const mensajes: Mensaje[] = [
    { role: "system", content: sistema(INSTRUCCIONES_PROPONER) },
    { role: "user", content: [{ type: "text", text: bloque("DATOS", datos) }, ...imagenes, { type: "text", text: bloque("USUARIO", usuario || "(sin instrucciones: decide tú con el estilo y los archivos)") }] },
  ];
  const r = await pedirModelo(f, clave, modelo, mensajes, ESQUEMA_PLAN, uso, 6000);
  let plan = normalizarPlan(planDesdeModelo(r.datos, ctx.estilo), ctx);
  plan = revisarPlan(plan, { marca: p.marca, permitido: p.instrucciones ?? "" }, p.canal);
  plan.avisos = [...new Set([...avisos, ...plan.avisos])];
  if (plan.piezas.length === 0) throw new ErrorRrss("La IA no devolvió ninguna pieza válida: prueba otra vez o usa la edición básica", 422);
  await patch(s, "rrss_proyectos", `id=eq.${p.id}`, { plan, plan_ia: plan, textos: plan.textos, ...(p.titulo ? {} : { titulo: plan.textos.titular.slice(0, 120) }) });
  return json(200, { ok: true, accion: "proponer", plan, avisos: plan.avisos, modelo });
}

async function pieza({ s, f, clave, modelo, uso, cuerpo }: Llamada): Promise<Response> {
  const p = await leerProyecto(s, String(cuerpo.proyectoId ?? ""));
  const indice = Number(cuerpo.indice);
  const archivos = await leerArchivos(s, p.id);
  const { formato, ctx } = contextoPlan(p, archivos);
  if (formato.medio !== "foto") throw new ErrorRrss("Regenerar una parte con la IA es para fotos; en el vídeo ajusta las tomas a mano o vuelve a proponer el montaje");
  const actual = normalizarPlan(p.plan, ctx);
  const objetivo = actual.piezas[indice] as PiezaFoto | undefined;
  if (!Number.isInteger(indice) || !objetivo) throw new ErrorRrss("Esa pieza no existe en el plan");
  const archivo = archivos.find((a) => a.id === objetivo.archivo);
  if (!archivo) throw new ErrorRrss("Falta la foto de esa pieza", 404);
  const avisos: string[] = [];
  const datos = {
    restaurante: await datosRestaurante(s, p.marca, avisos),
    formato: datosFormato(formato),
    estilo_elegido: catalogoEstilos().find((e) => e.id === ctx.estilo),
    trabajo: { permitir_transformaciones_creativas: ctx.permitirCreativo, resumen: actual.resumen },
    resto_del_trabajo: actual.piezas.map((x, i) => (x.tipo === "foto" ? { posicion: i + 1, archivo: x.archivo, rotulos: x.rotulos, encuadre: x.encuadre } : null)),
    pieza_a_rehacer: { posicion: indice + 1, archivo: objetivo.archivo, propuesta_actual: objetivo },
  };
  const usuario = anonimizar([p.instrucciones, typeof cuerpo.indicacion === "string" ? `Para esta pieza: ${cuerpo.indicacion}` : ""].filter(Boolean).join("\n")).slice(0, MAX_INDICACION);
  const imagenes = await imagenesArchivos(s, [archivo], "high");
  const r = await pedirModelo(f, clave, modelo, [
    { role: "system", content: sistema(INSTRUCCIONES_PIEZA) },
    { role: "user", content: [{ type: "text", text: bloque("DATOS", datos) }, ...imagenes, { type: "text", text: bloque("USUARIO", usuario || "(sin indicación nueva)") }] },
  ], ESQUEMA_PIEZA, uso, 1500);
  const foto = { ...((r.datos.foto ?? {}) as object), tipo: "foto", archivo: objetivo.archivo };
  const sola = normalizarPlan({ piezas: [foto], estilo: ctx.estilo }, { ...ctx, formato: { ...formato, tipo: "publicacion", maxArchivos: 1 } });
  const nueva = revisarPlan(sola, { marca: p.marca, permitido: `${p.instrucciones ?? ""} ${String(cuerpo.indicacion ?? "")}` }, p.canal);
  if (!nueva.piezas[0]) throw new ErrorRrss("La IA no devolvió una pieza válida", 422);
  const plan: PlanEdicion = { ...actual, piezas: actual.piezas.map((x, i) => (i === indice ? nueva.piezas[0] : x)), avisos: [...new Set([...avisos, ...nueva.avisos])] };
  await patch(s, "rrss_proyectos", `id=eq.${p.id}`, { plan });
  return json(200, { ok: true, accion: "pieza", indice, pieza: nueva.piezas[0], plan, avisos: plan.avisos, modelo });
}

async function textos({ s, f, clave, modelo, uso, cuerpo }: Llamada): Promise<Response> {
  const p = await leerProyecto(s, String(cuerpo.proyectoId ?? ""));
  const archivos = await leerArchivos(s, p.id);
  const { formato, ctx } = contextoPlan(p, archivos);
  const avisos: string[] = [];
  const plan = p.plan ? normalizarPlan(p.plan, ctx) : null;
  const datos = {
    restaurante: await datosRestaurante(s, p.marca, avisos),
    formato: datosFormato(formato),
    estilo_elegido: catalogoEstilos().find((e) => e.id === ctx.estilo),
    plan: plan ? { resumen: plan.resumen, rotulos: plan.piezas.map((x) => (x.tipo === "foto" ? x.rotulos : x.titulos)) } : null,
    textos_actuales: p.textos ?? null,
  };
  const usuario = anonimizar([p.instrucciones, typeof cuerpo.indicacion === "string" ? cuerpo.indicacion : ""].filter(Boolean).join("\n")).slice(0, MAX_INDICACION);
  const imagenes = await imagenesArchivos(s, archivos.slice(0, 6), "low");
  const r = await pedirModelo(f, clave, modelo, [
    { role: "system", content: sistema(INSTRUCCIONES_TEXTOS) },
    { role: "user", content: [{ type: "text", text: bloque("DATOS", datos) }, ...imagenes, { type: "text", text: bloque("USUARIO", usuario || "(sin instrucciones)") }] },
  ], ESQUEMA_TEXTOS, uso, 1200);
  const bruto = (r.datos.textos ?? {}) as Record<string, unknown>;
  const base = normalizarPlan({ textos: bruto, piezas: [] }, ctx);
  const revisado = revisarPlan(base, { marca: p.marca, permitido: `${p.instrucciones ?? ""} ${String(cuerpo.indicacion ?? "")}` }, p.canal);
  await patch(s, "rrss_proyectos", `id=eq.${p.id}`, { textos: revisado.textos, ...(plan ? { plan: { ...plan, textos: revisado.textos } } : {}) });
  return json(200, { ok: true, accion: "textos", textos: revisado.textos, avisos: [...new Set([...avisos, ...revisado.avisos])], modelo });
}

const TIPOS_PROMOCION = ["plato", "vino", "menu", "evento", "ambiente", "equipo"] as const;

async function ideas({ s, f, clave, modelo, uso, cuerpo }: Llamada): Promise<Response> {
  const marca = cuerpo.marca === "touza" ? "touza" : cuerpo.marca === "casa-tomas" ? "casa-tomas" : null;
  if (!marca) throw new ErrorRrss("Marca no válida");
  const canal: Canal = esCanal(cuerpo.canal) ? cuerpo.canal : "instagram";
  const tipo = esTipoContenido(cuerpo.tipo) ? cuerpo.tipo : null;
  const prom = (cuerpo.promocionar ?? {}) as Record<string, unknown>;
  const que = TIPOS_PROMOCION.includes(prom.tipo as (typeof TIPOS_PROMOCION)[number]) ? String(prom.tipo) : null;
  if (!que) throw new ErrorRrss("Elige qué quieres promocionar: un plato, un vino, un menú, un evento, el ambiente o el equipo");
  const detalle = anonimizar(typeof prom.detalle === "string" ? prom.detalle : "").slice(0, 600);
  const material = anonimizar(typeof cuerpo.material === "string" ? cuerpo.material : "").slice(0, 400);
  const avisos: string[] = [];
  let plato: Record<string, unknown> | null = null;
  let vino: Record<string, unknown> | null = null;
  if (typeof prom.platoId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(prom.platoId)) plato = platoParaModelo(await leerPlato(s, prom.platoId).catch(() => null));
  if (typeof prom.vinoId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(prom.vinoId)) {
    const v = (await leerVino(s, prom.vinoId).catch(() => null)) as Record<string, unknown> | null;
    if (v) vino = { nombre: v.nombre, tipo: v.categoria ?? null, do: v.denominacion_origen ?? null, uva: v.ingredientes ?? null, descripcion: String(v.descripcion ?? "").slice(0, 400) || null };
  }
  const datos = {
    restaurante: await datosRestaurante(s, marca, avisos),
    canal,
    formato_preferido: tipo,
    promocionar: { que, plato_de_la_carta: plato, vino_de_la_carta: vino },
  };
  const usuario = [`Quiero promocionar: ${que}.`, detalle ? `Detalle: ${detalle}` : "", material ? `Material disponible: ${material}` : ""].filter(Boolean).join("\n");
  const r = await pedirModelo(f, clave, modelo, [
    { role: "system", content: sistema(INSTRUCCIONES_IDEAS) },
    { role: "user", content: `${bloque("DATOS", datos)}\n\n${bloque("USUARIO", usuario)}\n\nDevuelve 3 propuestas distintas entre sí.` },
  ], ESQUEMA_IDEAS, uso, 5000);
  const ctx: ContextoTexto = { marca, permitido: `${detalle} ${material}` };
  const lista = (Array.isArray(r.datos.ideas) ? r.datos.ideas : []).slice(0, 5).map((bruta) => {
    const i = bruta as Record<string, unknown>;
    const fuera: string[] = [];
    const limpio = revisarCampos(i, ["titulo", "idea", "objetivo", "gancho", "voz_en_off", "copy", "cta"], ctx, fuera);
    const listaTexto = (v: unknown) => (Array.isArray(v) ? v.map((x) => revisarTexto(String(x ?? ""), ctx)).map((x) => (fuera.push(...x.avisos), x.texto)).filter(Boolean).slice(0, 12) : []);
    const planos = (Array.isArray(i.planos) ? i.planos : []).slice(0, 12).map((pl) => {
      const o = pl as Record<string, unknown>;
      return { ...revisarCampos(o, ["descripcion", "luz", "encuadre", "movimiento"], ctx, fuera), duracion_s: Math.max(1, Math.min(60, Number(o.duracion_s) || 3)) };
    });
    avisos.push(...fuera);
    return { ...limpio, guion: listaTexto(i.guion), texto_pantalla: listaTexto(i.texto_pantalla), material: listaTexto(i.material), planos, duracion_total_s: Math.max(3, Math.min(180, Number(i.duracion_total_s) || planos.reduce((a, x) => a + x.duracion_s, 0))) };
  });
  if (lista.length === 0) throw new ErrorRrss("La IA no devolvió ideas válidas: prueba otra vez", 422);
  const preguntas = (Array.isArray(r.datos.preguntas) ? r.datos.preguntas : []).map(String).slice(0, 3);
  let id: string | null = null;
  const rr = await s.fetch(`${s.sb.url}/rest/v1/rrss_ideas?select=id`, {
    method: "POST",
    headers: cab(s, { "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ marca, canal, tipo, objetivo: { que, detalle, material, platoId: prom.platoId ?? null, vinoId: prom.vinoId ?? null }, propuestas: lista, modelo }),
    signal: AbortSignal.timeout(MS),
  });
  if (rr.ok) id = ((await rr.json().catch(() => [])) as Array<{ id?: string }>)?.[0]?.id ?? null;
  else avisos.push("No se pudieron guardar las ideas (se ven igual)");
  return json(200, { ok: true, accion: "ideas", id, ideas: lista, preguntas, avisos: [...new Set(avisos)], modelo });
}

async function transcribir({ s, f, clave, uso, cuerpo, modeloAudio }: Llamada & { modeloAudio: string }): Promise<Response> {
  const id = String(cuerpo.archivoId ?? "");
  if (!ID.test(id)) throw new ErrorRrss("archivoId no válido");
  const [a] = await sel<FilaArchivo & { proyecto_id: string }>(s, "rrss_archivos", `id=eq.${id}&select=id,proyecto_id,tipo,estado,orden,ancho,alto,duracion_s,analisis`);
  if (!a) throw new ErrorRrss("Ese archivo no existe", 404);
  const ruta = a.analisis?.audio_ruta;
  if (typeof ruta !== "string" || !ruta) throw new ErrorRrss("Este vídeo no tiene voz que transcribir (sin audio o en silencio)");
  const audio = await s.fetch(`${s.sb.url}/storage/v1/object/authenticated/rrss/${ruta.split("/").map(encodeURIComponent).join("/")}`, { headers: cab(s), signal: AbortSignal.timeout(60_000) });
  if (!audio.ok) throw new ErrorRrss("No se pudo leer el audio del vídeo", 502);
  const forma = new FormData();
  forma.append("file", new Blob([await audio.arrayBuffer()], { type: "audio/mp4" }), "audio.m4a");
  forma.append("model", modeloAudio);
  forma.append("response_format", "verbose_json");
  forma.append("timestamp_granularities[]", "segment");
  forma.append("language", "es");
  let res: Response;
  try {
    res = await f(`${OPENAI}/audio/transcriptions`, { method: "POST", headers: { Authorization: `Bearer ${clave}` }, body: forma, signal: AbortSignal.timeout(120_000) });
  } catch (e) {
    uso.sumar(undefined);
    throw new ErrorOpenAI(`No se pudo hablar con OpenAI: ${sanear((e as Error)?.message ?? e)}`);
  }
  uso.sumar(undefined);
  if (!res.ok) throw new ErrorOpenAI(motivoErrorOpenAI(res.status, await res.text().catch(() => "")));
  const j = (await res.json().catch(() => null)) as { text?: string; segments?: Array<{ start: number; end: number; text: string; no_speech_prob?: number }> } | null;
  const segmentos = (j?.segments ?? [])
    .filter((x) => (x.no_speech_prob ?? 0) < 0.8 && String(x.text ?? "").trim())
    .slice(0, 300)
    .map((x) => ({ inicio: Math.round(Number(x.start) * 100) / 100, fin: Math.round(Number(x.end) * 100) / 100, texto: String(x.text).trim().slice(0, 300) }));
  const texto = segmentos.map((x) => x.texto).join(" ").slice(0, 6000);
  await patch(s, "rrss_archivos", `id=eq.${a.id}`, { analisis: { ...a.analisis, transcripcion: segmentos, transcripcion_texto: texto } });
  return json(200, { ok: true, accion: "transcribir", segmentos, texto });
}

// ── Manejador ───────────────────────────────────────────────────────────────

export async function manejarRrssIA(request: Request, deps: DependenciasRrssIA = {}): Promise<Response> {
  if (request.method === "OPTIONS") return opciones();
  if (request.method !== "POST") return json(405, { ok: false, error: "Método no permitido" });
  const env = deps.env ?? entornoRrss();
  const f = deps.fetch ?? fetch;
  const auth = await autorizarMarketing(request.headers.get("authorization"), { env, fetch: f, permiso: "editar" });
  if (!auth.ok) return jsonAuth(auth.estado, auth.motivo);
  const s = auth.sesion;
  const leido = await leerJson(request, 64 * 1024);
  if (!leido.ok) return json(leido.estado, { ok: false, error: leido.error });
  const cuerpo = (leido.valor && typeof leido.valor === "object" ? leido.valor : {}) as Record<string, unknown>;
  const accion = cuerpo.accion as Accion;
  if (!ACCIONES.includes(accion)) return json(400, { ok: false, error: "Acción no válida" });

  const clave = claveOpenAI("otros", (n) => env[n]);
  if (!clave) return json(503, { ok: false, error: "Falta OPENAI_API_KEY en los secretos de Supabase", tipo: "ia_no_disponible" });
  registrarSecreto(clave);
  const modelo = (env.RRSS_IA_MODEL ?? "").trim() || MODELO_POR_DEFECTO;
  const modeloAudio = (env.RRSS_TRANSCRIPCION_MODEL ?? "").trim() || MODELO_TRANSCRIPCION;
  const uso = new AcumuladorUso(FUNCION, accion === "transcribir" ? modeloAudio : modelo, accion === "transcribir" ? "otro" : "vision");
  const registrar = deps.registrar ?? registrarUso;
  const t0 = Date.now();
  const proyecto = typeof cuerpo.proyectoId === "string" && ID.test(cuerpo.proyectoId) ? cuerpo.proyectoId : null;
  let reserva: number | null = null;
  let ok = false;
  try {
    reserva = await reservar(s, accion, proyecto, uso.modelo);
    const llamada: Llamada = { s, f, clave, modelo, uso, cuerpo };
    const r =
      accion === "proponer" ? await proponer(llamada)
      : accion === "pieza" ? await pieza(llamada)
      : accion === "textos" ? await textos(llamada)
      : accion === "ideas" ? await ideas(llamada)
      : await transcribir({ ...llamada, modeloAudio });
    ok = r.status < 400;
    return r;
  } catch (e) {
    uso.marcarError();
    if (e instanceof ErrorRrss) return json(e.estado, { ok: false, error: e.message, ...e.extra });
    if (e instanceof ErrorOpenAI) return json(502, { ok: false, error: e.message, tipo: "ia_no_disponible" });
    const estado = (e as { estado?: number }).estado;
    return json(typeof estado === "number" ? estado : 502, { ok: false, error: sanear((e as Error)?.message ?? e) });
  } finally {
    await marcar(s, reserva, ok);
    await registrar(uso, { disparador: proyecto ? `rrss:${proyecto}` : `usuario:${s.usuario}`, duracionMs: Date.now() - t0 });
  }
}
