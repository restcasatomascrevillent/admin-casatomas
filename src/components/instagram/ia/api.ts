/**
 * Llamadas de «Sugerir texto» a la Edge Function instagram-ia, con la clave
 * pública (`apikey`) y el JWT de la sesión, como el resto de funciones del
 * panel. La función solo PROPONE: nada de aquí publica ni programa.
 * Contrato: supabase/functions/instagram-ia/ia.ts y docs/instagram-ia.md.
 */
import { supabase } from "@/integrations/supabase/client";
import { auditDeviceId } from "@/lib/audit-device";
import type { FormatoId, MarcaId } from "@/lib/instagram";

const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "");
const CLAVE_PUBLICA = String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || "");

export const URL_IA = `${SUPABASE_URL}/functions/v1/instagram-ia`;

export type TonoIA = "cercano" | "elegante" | "retranca";

export const TONOS_IA: ReadonlyArray<{ id: TonoIA; etiqueta: string }> = [
  { id: "cercano", etiqueta: "Cercano" },
  { id: "elegante", etiqueta: "Elegante" },
  { id: "retranca", etiqueta: "Con retranca" },
];

export type CampoRotuloIA = "antetitulo" | "titular" | "cita" | "cta" | "pie";

/** Lo que el panel sabe de la pieza que se está creando. */
export interface ContextoPiezaIA {
  marca: MarcaId;
  formato: FormatoId;
  /** id de la plantilla (p. ej. «ct-foto-titular»). */
  plantilla: string;
  /** id de la foto; si es «carta:<id>», la IA usa ese plato de la carta. */
  foto?: string | null;
  /** id del plato de la tabla "Platos" (si no viene, se saca de la foto «carta:<id>»). */
  platoId?: string | null;
  /** id de la pieza en instagram_piezas, si ya está guardada (para el registro). */
  piezaId?: string | null;
  /** Textos que ya lleva la pieza. */
  textos?: Partial<Record<CampoRotuloIA, string>>;
}

export interface VarianteTextoIA {
  gancho: string;
  caption: string;
  hashtags: string[];
  altText: string;
  platosCitados: string[];
  avisos: string[];
}

export type RotulosIA = Partial<Record<CampoRotuloIA, string>>;
export interface VarianteRotulosIA extends RotulosIA {
  avisos: string[];
}

interface RespuestaBase {
  sugerenciaId: string | null;
  modelo: string;
  plato: { id: string; nombre: string } | null;
  descartadas: Array<{ motivos: string[] }>;
  avisos: string[];
}
export interface RespuestaTextoIA extends RespuestaBase {
  variantes: VarianteTextoIA[];
}
export interface RespuestaRotulosIA extends RespuestaBase {
  variantes: VarianteRotulosIA[];
}

export interface PeticionIA {
  tono: TonoIA;
  indicaciones?: string;
  incluirPrecio?: boolean;
}

export type TipoErrorIA = "sesion" | "sin_permiso" | "rechazada" | "cupo" | "configuracion" | "no_desplegada" | "servidor" | "red";

export class ErrorIA extends Error {
  constructor(
    mensaje: string,
    readonly tipo: TipoErrorIA,
    readonly estado?: number,
    /** Motivos de las propuestas descartadas (422). */
    readonly descartadas: Array<{ motivos: string[] }> = [],
  ) {
    super(mensaje);
    this.name = "ErrorIA";
  }
}

export interface OpcionesLlamada {
  fetch?: typeof fetch;
  /** JWT; por defecto el de la sesión actual. */
  token?: string | null;
}

async function tokenSesion(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

function normalizarBase(c: Record<string, unknown>): RespuestaBase {
  const plato = c.plato as { id?: unknown; nombre?: unknown } | null;
  return {
    sugerenciaId: typeof c.sugerenciaId === "string" ? c.sugerenciaId : null,
    modelo: texto(c.modelo),
    plato: plato && typeof plato.id === "string" ? { id: plato.id, nombre: texto(plato.nombre) } : null,
    descartadas: Array.isArray(c.descartadas) ? c.descartadas.map((d) => ({ motivos: textos((d as { motivos?: unknown })?.motivos) })) : [],
    avisos: textos(c.avisos),
  };
}

async function llamar(cuerpo: Record<string, unknown>, opts: OpcionesLlamada = {}): Promise<Record<string, unknown>> {
  const token = opts.token === undefined ? await tokenSesion() : opts.token;
  if (!token) throw new ErrorIA("No hay sesión: vuelve a entrar en el panel.", "sesion", 401);
  const f = opts.fetch ?? fetch;
  let r: Response;
  try {
    r = await f(URL_IA, {
      method: "POST",
      body: JSON.stringify(cuerpo),
      headers: {
        "Content-Type": "application/json",
        apikey: CLAVE_PUBLICA,
        "x-client-info": `adminpanel/${auditDeviceId()}/${crypto.randomUUID()}`,
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (e) {
    throw new ErrorIA((e as Error)?.message || "Sin conexión", "red");
  }
  let c: Record<string, unknown> = {};
  try {
    c = ((await r.json()) ?? {}) as Record<string, unknown>;
  } catch {
    throw new ErrorIA(`Respuesta no válida del servidor (${r.status})`, "servidor", r.status);
  }
  if (r.ok) return c;
  const mensaje = typeof c.error === "string" ? c.error : typeof c.message === "string" ? c.message : `El servidor respondió ${r.status}`;
  // La pasarela de Supabase contesta 404 { message } si la función no está desplegada.
  if (r.status === 404 && typeof c.error !== "string") {
    throw new ErrorIA("La función de IA de Instagram no está desplegada en este Supabase (docs/instagram-ia.md).", "no_desplegada", 404);
  }
  if (r.status === 401) throw new ErrorIA(mensaje, "sesion", 401);
  if (r.status === 403) throw new ErrorIA(mensaje, "sin_permiso", 403);
  if (r.status === 422) throw new ErrorIA(mensaje, "rechazada", 422, normalizarBase(c).descartadas);
  if (r.status === 429) throw new ErrorIA(mensaje, "cupo", 429);
  if (r.status === 503) throw new ErrorIA(mensaje, "configuracion", 503);
  throw new ErrorIA(mensaje, "servidor", r.status);
}

function cuerpoComun(ctx: ContextoPiezaIA, p: PeticionIA): Record<string, unknown> {
  return {
    marca: ctx.marca,
    formato: ctx.formato,
    plantilla: ctx.plantilla,
    foto: ctx.foto ?? undefined,
    platoId: ctx.platoId ?? undefined,
    piezaId: ctx.piezaId ?? undefined,
    textos: ctx.textos ?? {},
    tono: p.tono,
    indicaciones: p.indicaciones?.trim() || undefined,
  };
}

/** 3 variantes de texto (caption, hashtags y texto alternativo) ya validadas en el servidor. */
export async function sugerirTexto(ctx: ContextoPiezaIA, p: PeticionIA, opts?: OpcionesLlamada): Promise<RespuestaTextoIA> {
  const c = await llamar({ accion: "sugerir_texto", ...cuerpoComun(ctx, p), incluirPrecio: p.incluirPrecio === true }, opts);
  const variantes = (Array.isArray(c.variantes) ? c.variantes : []).map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return {
      gancho: texto(o.gancho),
      caption: texto(o.caption),
      hashtags: textos(o.hashtags),
      altText: texto(o.altText),
      platosCitados: textos(o.platosCitados),
      avisos: textos(o.avisos),
    };
  });
  return { ...normalizarBase(c), variantes };
}

/** Rótulos cortos para la plantilla (solo los campos que usa), ya validados en el servidor. */
export async function sugerirRotulos(ctx: ContextoPiezaIA, p: PeticionIA, opts?: OpcionesLlamada): Promise<RespuestaRotulosIA> {
  const c = await llamar({ accion: "sugerir_rotulos", ...cuerpoComun(ctx, p) }, opts);
  const campos: CampoRotuloIA[] = ["antetitulo", "titular", "cita", "cta", "pie"];
  const variantes = (Array.isArray(c.variantes) ? c.variantes : []).map((v) => {
    const o = (v ?? {}) as Record<string, unknown>;
    const r: VarianteRotulosIA = { avisos: textos(o.avisos) };
    for (const k of campos) if (typeof o[k] === "string" && o[k]) r[k] = o[k] as string;
    return r;
  });
  return { ...normalizarBase(c), variantes };
}

// La tabla es nueva (20261108000000_instagram_ia.sql) y aún no está en
// src/integrations/supabase/types.ts: se usa sin tipos a propósito.
type TablaSinTipos = {
  from(tabla: string): {
    update(v: Record<string, unknown>): { eq(columna: string, valor: string): PromiseLike<{ error: unknown }> };
  };
};

/**
 * Anota qué variante se eligió (para medir qué propuestas se usan). Nunca
 * lanza: si falla (p. ej. migración sin aplicar), la elección sigue adelante.
 */
export async function marcarElegida(sugerenciaId: string | null, indice: number): Promise<void> {
  if (!sugerenciaId) return;
  try {
    await (supabase as unknown as TablaSinTipos)
      .from("instagram_sugerencias_ia")
      .update({ aceptada: true, variante_elegida: indice })
      .eq("id", sugerenciaId);
  } catch {
    /* solo es estadística */
  }
}

export function textoError(e: unknown): string {
  return e instanceof Error ? e.message : "Error desconocido";
}
