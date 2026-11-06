/**
 * Campañas e ideas de la semana de Instagram (fase 2). La IA (Edge Function
 * instagram-ia, acciones proponer_campana e ideas_semana) solo PROPONE: una
 * campaña se guarda como «propuesta» y aceptarla (RPC
 * instagram_aceptar_campana) crea BORRADORES con fecha prevista. Nada de aquí
 * programa ni publica.
 *
 * Tablas y RPC nuevas (20261109000000_instagram_campanas.sql) que aún no
 * están en src/integrations/supabase/types.ts: se usan sin tipos a propósito.
 * Contrato: supabase/functions/instagram-ia/campanas.ts y docs/instagram-campanas.md.
 */
import { supabase } from "@/integrations/supabase/client";
import { ErrorIA, llamar, type OpcionesLlamada } from "@/components/instagram/ia/api";
import type { PiezaInstagram } from "@/components/marketing/instagram/usePiezasInstagram";
import type { MarcaId } from "@/lib/instagram";

export { ErrorIA };

/** Clave de TanStack Query de las campañas. */
export const CLAVE_CAMPANAS = ["instagram_campanas"] as const;

export type FormatoCampana = "post" | "story";
export type EstadoCampana = "propuesta" | "aceptada" | "en_curso" | "cerrada" | "descartada";
export type MotivoIdea = "fecha_senalada" | "temporada" | "plato" | "novedad" | "metricas";

export interface PiezaCampanaIA {
  fecha: string;
  hora: string;
  formato: FormatoCampana;
  plantilla: string;
  platoId: string | null;
  plato: { id: string; nombre: string } | null;
  foto: string | null;
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

export interface PropuestaCampana {
  titulo: string;
  objetivo: string;
  publico: string;
  mensaje: string;
  razonamiento: string;
  desde: string;
  hasta: string;
  fases: FaseCampana[];
  piezas: PiezaCampanaIA[];
}

/** Fila de instagram_campanas. */
export interface CampanaInstagram {
  id: string;
  marca: MarcaId;
  titulo: string;
  objetivo: string | null;
  publico: string | null;
  mensaje: string | null;
  razonamiento: string | null;
  peticion: string | null;
  desde: string;
  hasta: string;
  estado: EstadoCampana;
  propuesta: PropuestaCampana;
  piezas_aceptadas: number | null;
  created_at: string;
}

export interface PeticionCampana {
  marca: MarcaId;
  /** AAAA-MM-DD; por defecto, mañana. */
  desde?: string;
  semanas?: number;
  piezasPorSemana?: number;
  /** «¿Qué quieres empujar?» */
  objetivo?: string;
}

export interface RespuestaCampana {
  campanaId: string;
  campana: PropuestaCampana;
  descartadas: Array<{ donde: string; motivos: string[] }>;
  avisos: string[];
}

export interface IdeaSemanaIA {
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

export interface RespuestaIdeas {
  desde: string;
  hasta: string;
  ideas: IdeaSemanaIA[];
  fechas: FechaSenalada[];
  avisos: string[];
}

export interface FechaSenalada {
  titulo: string;
  desde: string;
  hasta: string;
  verificacion?: string;
  ambito?: string;
  idea?: string | null;
}

const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

function normalizarPieza(v: unknown): PiezaCampanaIA {
  const o = (v ?? {}) as Record<string, unknown>;
  const plato = o.plato as { id?: unknown; nombre?: unknown } | null;
  return {
    fecha: texto(o.fecha),
    hora: texto(o.hora) || "13:00",
    formato: o.formato === "story" ? "story" : "post",
    plantilla: texto(o.plantilla),
    platoId: typeof o.platoId === "string" ? o.platoId : null,
    plato: plato && typeof plato.id === "string" ? { id: plato.id, nombre: texto(plato.nombre) } : null,
    foto: typeof o.foto === "string" && o.foto ? o.foto : null,
    faltaFoto: o.faltaFoto === true,
    antetitulo: texto(o.antetitulo),
    titular: texto(o.titular),
    gancho: texto(o.gancho),
    caption: texto(o.caption),
    hashtags: textos(o.hashtags),
    altText: texto(o.altText),
    porQue: texto(o.porQue),
    fase: Number.isInteger(o.fase) ? (o.fase as number) : 0,
    encargoSugerido: texto(o.encargoSugerido),
    avisos: textos(o.avisos),
  };
}

export function normalizarPropuesta(v: unknown, respaldo: { desde?: string; hasta?: string } = {}): PropuestaCampana {
  const o = (v ?? {}) as Record<string, unknown>;
  return {
    titulo: texto(o.titulo),
    objetivo: texto(o.objetivo),
    publico: texto(o.publico),
    mensaje: texto(o.mensaje),
    razonamiento: texto(o.razonamiento),
    desde: texto(o.desde) || respaldo.desde || "",
    hasta: texto(o.hasta) || respaldo.hasta || "",
    fases: (Array.isArray(o.fases) ? o.fases : []).map((f) => {
      const x = (f ?? {}) as Record<string, unknown>;
      return { nombre: texto(x.nombre), desde: texto(x.desde), hasta: texto(x.hasta) };
    }),
    piezas: (Array.isArray(o.piezas) ? o.piezas : []).map(normalizarPieza),
  };
}

/** Pide una campaña a la IA. Se guarda como propuesta: nada se programa. */
export async function proponerCampana(p: PeticionCampana, opts?: OpcionesLlamada): Promise<RespuestaCampana> {
  const c = await llamar(
    {
      accion: "proponer_campana",
      marca: p.marca,
      desde: p.desde || undefined,
      semanas: p.semanas,
      piezasPorSemana: p.piezasPorSemana,
      objetivo: p.objetivo?.trim() || undefined,
    },
    opts,
  );
  return {
    campanaId: texto(c.campanaId),
    campana: normalizarPropuesta(c.campana),
    descartadas: (Array.isArray(c.descartadas) ? c.descartadas : []).map((d) => ({
      donde: texto((d as { donde?: unknown })?.donde),
      motivos: textos((d as { motivos?: unknown })?.motivos),
    })),
    avisos: textos(c.avisos),
  };
}

/** 3 a 5 ideas para una semana (no guarda nada salvo el registro de la sugerencia). */
export async function pedirIdeasSemana(marca: MarcaId, semana?: string, opts?: OpcionesLlamada): Promise<RespuestaIdeas> {
  const c = await llamar({ accion: "ideas_semana", marca, semana: semana || undefined }, opts);
  return {
    desde: texto(c.desde),
    hasta: texto(c.hasta),
    ideas: (Array.isArray(c.ideas) ? c.ideas : []).map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const plato = o.plato as { id?: unknown; nombre?: unknown } | null;
      return {
        fecha: texto(o.fecha),
        titulo: texto(o.titulo),
        idea: texto(o.idea),
        motivo: (texto(o.motivo) || "plato") as MotivoIdea,
        formato: o.formato === "story" ? "story" : "post",
        plantilla: texto(o.plantilla),
        platoId: typeof o.platoId === "string" ? o.platoId : null,
        plato: plato && typeof plato.id === "string" ? { id: plato.id, nombre: texto(plato.nombre) } : null,
        gancho: texto(o.gancho),
        avisos: textos(o.avisos),
      } satisfies IdeaSemanaIA;
    }),
    fechas: (Array.isArray(c.fechas) ? c.fechas : []) as FechaSenalada[],
    avisos: textos(c.avisos),
  };
}

// ── Base de datos (sin tipos: tablas y RPC nuevas) ──────────────────────────

type Respuesta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface Consulta<T> extends Respuesta<T> {
  select(c: string): Consulta<T>;
  eq(c: string, v: unknown): Consulta<T>;
  in(c: string, v: unknown[]): Consulta<T>;
  order(c: string, o?: { ascending?: boolean }): Consulta<T>;
  limit(n: number): Consulta<T>;
  maybeSingle(): Respuesta<T extends Array<infer U> ? U : T>;
}
type ClienteSinTipos = {
  from<T = unknown[]>(tabla: string): Consulta<T>;
  rpc<T = unknown>(nombre: string, args: Record<string, unknown>): Respuesta<T>;
};
const sb = supabase as unknown as ClienteSinTipos;

/** Mensaje legible de un error de PostgREST/RPC. */
export function mensajeErrorBD(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? "No se pudo completar la acción";
  if (/Could not find the (function|table)|PGRST20[0-9]|does not exist/i.test(m)) {
    return "Falta aplicar la migración de campañas (20261109000000) en este Supabase";
  }
  return m;
}

export const COLUMNAS_CAMPANA = "id,marca,titulo,objetivo,publico,mensaje,razonamiento,peticion,desde,hasta,estado,propuesta,piezas_aceptadas,created_at";

/** Últimas campañas (propuestas y aceptadas) de una marca o de las dos. */
export async function listarCampanas(marca?: MarcaId | "todas"): Promise<CampanaInstagram[]> {
  let q = sb.from<CampanaInstagram[]>("instagram_campanas").select(COLUMNAS_CAMPANA).in("estado", ["propuesta", "aceptada", "en_curso"]);
  if (marca && marca !== "todas") q = q.eq("marca", marca);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(30);
  if (error) throw new Error(mensajeErrorBD(error));
  return (data ?? []).map((c) => ({ ...c, propuesta: normalizarPropuesta(c.propuesta, c) }));
}

/** Crea como BORRADORES las piezas elegidas (índices de la propuesta). Nunca programa. */
export async function aceptarCampana(campanaId: string, indices: number[]): Promise<{ piezas: Array<{ id: string; indice: number; fechaPrevista: string }> }> {
  const { data, error } = await sb.rpc<{ piezas?: Array<{ id: string; indice: number; fechaPrevista: string }> }>("instagram_aceptar_campana", {
    p_campana_id: campanaId,
    p_piezas: indices,
  });
  if (error) throw new Error(mensajeErrorBD(error));
  return { piezas: data?.piezas ?? [] };
}

export async function descartarCampana(campanaId: string): Promise<void> {
  const { error } = await sb.rpc("instagram_descartar_campana", { p_campana_id: campanaId });
  if (error) throw new Error(mensajeErrorBD(error));
}

/** Borradores que salieron de una campaña. */
export async function borradoresDeCampana(campanaId: string): Promise<PiezaInstagram[]> {
  const { data, error } = await sb
    .from<PiezaInstagram[]>("instagram_piezas")
    .select("*")
    .eq("campana_id", campanaId)
    .order("fecha_prevista", { ascending: true })
    .limit(40);
  if (error) throw new Error(mensajeErrorBD(error));
  return data ?? [];
}

/** Una pieza por id (para abrir un borrador en «Crear»). */
export async function leerPieza(id: string): Promise<PiezaInstagram | null> {
  const { data, error } = await sb.from<PiezaInstagram[]>("instagram_piezas").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(mensajeErrorBD(error));
  return (data as PiezaInstagram | null) ?? null;
}

/** Fechas señaladas que caen en el rango (RPC marketing_fechas_entre; no gasta IA). */
export async function fechasEntre(desde: string, hasta: string, marca: MarcaId): Promise<FechaSenalada[]> {
  const { data, error } = await sb.rpc<FechaSenalada[]>("marketing_fechas_entre", { p_desde: desde, p_hasta: hasta, p_marca: marca });
  if (error) throw new Error(mensajeErrorBD(error));
  return data ?? [];
}
