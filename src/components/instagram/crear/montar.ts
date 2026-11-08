/**
 * Cliente de «Montar con IA» (acción `montar_pieza` de la Edge Function
 * instagram-ia). Contrato: src/lib/instagram/montar.ts. El servidor lo hace
 * otro encargo; aquí van la llamada, la normalización defensiva de la
 * respuesta y un montador SIMULADO para las pruebas y la maqueta local.
 *
 * La IA solo propone: nada de aquí publica ni programa.
 */
import { ErrorIA, llamar, type OpcionesLlamada } from "@/components/instagram/ia/api";
import { cubreFormato, obtenerPlantilla, plantillaEnmarcada, plantillasDe } from "@/lib/instagram";
import {
  MAX_FOTOS_CARRUSEL,
  type DiapositivaMontada,
  type FormatoMontado,
  type PeticionMontar,
  type RespuestaMontar,
} from "@/lib/instagram/montar";

/** Lo que manda el panel (sin la acción, que la pone el cliente). */
export type EntradaMontar = Omit<PeticionMontar, "accion">;

/** Función que monta: la real (montarPieza) o una simulada. */
export type Montador = (p: EntradaMontar) => Promise<RespuestaMontar>;

const FORMATOS: readonly FormatoMontado[] = ["post", "carrusel", "story"];
const texto = (v: unknown): string => (typeof v === "string" ? v : "");
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Respuesta del servidor → RespuestaMontar. Se queda solo con las imágenes de
 * fotos que se mandaron (sin repetir) y no inventa nada: si falta algo, va vacío.
 */
export function normalizarRespuestaMontar(crudo: unknown, idsFotos: readonly string[]): RespuestaMontar {
  const c = (crudo && typeof crudo === "object" ? crudo : {}) as Record<string, unknown>;
  const validas = new Set(idsFotos);
  const vistas = new Set<string>();
  const diapositivas: DiapositivaMontada[] = [];
  for (const d of Array.isArray(c.diapositivas) ? c.diapositivas : []) {
    const o = (d && typeof d === "object" ? d : {}) as Record<string, unknown>;
    const foto = texto(o.foto);
    if (!validas.has(foto) || vistas.has(foto)) continue;
    vistas.add(foto);
    diapositivas.push({
      foto,
      plantilla: texto(o.plantilla),
      datos: o.datos && typeof o.datos === "object" && !Array.isArray(o.datos) ? (o.datos as Record<string, unknown>) : {},
      altText: texto(o.altText),
    });
    if (diapositivas.length >= MAX_FOTOS_CARRUSEL) break;
  }
  const formatoPedido = FORMATOS.includes(c.formato as FormatoMontado) ? (c.formato as FormatoMontado) : null;
  const formato: FormatoMontado = diapositivas.length > 1 ? "carrusel" : formatoPedido === "story" ? "story" : "post";
  const hora = texto(c.horaSugerida);
  return {
    ok: true,
    formato,
    diapositivas,
    caption: texto(c.caption),
    hashtags: textos(c.hashtags),
    horaSugerida: hora && !Number.isNaN(new Date(hora).getTime()) ? hora : null,
    resumen: texto(c.resumen),
    avisos: textos(c.avisos),
  };
}

/** Llama a instagram-ia → montar_pieza con el JWT de la sesión. */
export async function montarPieza(p: EntradaMontar, opts?: OpcionesLlamada): Promise<RespuestaMontar> {
  const cuerpo: Record<string, unknown> = {
    accion: "montar_pieza",
    marca: p.marca,
    fotos: p.fotos,
    formato: p.formato ?? "auto",
    tono: p.tono,
  };
  const indicacion = p.indicacion?.trim();
  if (indicacion) cuerpo.indicacion = indicacion.slice(0, 500);
  const c = await llamar(cuerpo, opts);
  if (c.ok === false) {
    const tipo = c.tipo === "cupo" ? "cupo" : "rechazada";
    throw new ErrorIA(texto(c.error) || "La IA no ha podido montar la publicación.", tipo);
  }
  const r = normalizarRespuestaMontar(c, p.fotos.map((f) => f.id));
  if (!r.diapositivas.length) throw new ErrorIA("La IA no ha devuelto ninguna imagen montada. Prueba otra vez.", "servidor");
  return r;
}

// ─── Simulado (pruebas y maqueta local) ────────────────────────────────────

export interface OpcionesMontadorSimulado {
  /** Milisegundos de espera, para ver el «Montando…». */
  retraso?: number;
  /** Si se da, falla con este mensaje. */
  fallo?: string;
  /** Hora sugerida (ISO). Por defecto, el jueves siguiente a las 13:00 de Madrid. */
  horaSugerida?: string | null;
  /** Invierte el orden de las fotos (para probar que se aplica el de la IA). */
  invertirOrden?: boolean;
}

/** Próximo jueves a las 13:00 (hora de Madrid en invierno, UTC+1). */
function proximoJueves(ahora = new Date()): string {
  const d = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + 1));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() + 1);
  return `${d.toISOString().slice(0, 10)}T13:00:00+01:00`;
}

/**
 * Montador falso y determinista: primera plantilla con foto de la marca,
 * titular corto por imagen, texto y hashtags fijos. Registra las peticiones.
 */
export function crearMontadorSimulado(o: OpcionesMontadorSimulado = {}): Montador & { peticiones: EntradaMontar[] } {
  const peticiones: EntradaMontar[] = [];
  const montador = (async (p: EntradaMontar) => {
    peticiones.push(p);
    if (o.retraso) await new Promise((r) => setTimeout(r, o.retraso));
    if (o.fallo) throw new ErrorIA(o.fallo, "servidor");
    const fotos = o.invertirOrden ? [...p.fotos].reverse() : p.fotos;
    const formato: FormatoMontado = fotos.length > 1 ? "carrusel" : p.formato === "story" ? "story" : "post";
    const formatoImg = formato === "story" ? "story" : "post";
    const plantilla = plantillasDe(p.marca, formatoImg).find((x) => x.admitidos.includes("foto"));
    // Como el servidor: una foto que no cubre el lienzo (las de la carta, 1200×900) va enmarcada.
    const enmarcada = plantillaEnmarcada(p.marca, formatoImg);
    const titulares = ["Recién llegado", "Del mar a la mesa", "Para compartir", "Hecho al momento", "Te esperamos"];
    const diapositivas: DiapositivaMontada[] = fotos.map((f, i) => {
      const noCubre = !!f.ancho && !!f.alto && !cubreFormato({ ancho: f.ancho, alto: f.alto }, formatoImg);
      const id = (noCubre && enmarcada ? enmarcada : plantilla)?.id ?? "";
      return {
        foto: f.id,
        plantilla: id,
        datos: {
          titular: titulares[i % titulares.length],
          ...(i === 0 && obtenerPlantilla(id)?.admitidos.includes("antetitulo") ? { antetitulo: "Esta semana" } : {}),
        },
        altText: `Foto ${i + 1} de ${fotos.length} de la publicación.`,
      };
    });
    const tema = p.indicacion?.trim() ? `«${p.indicacion.trim()}»` : "lo que se ve en las fotos";
    return {
      ok: true as const,
      formato,
      diapositivas,
      caption: `Hoy os enseñamos ${tema}. Pasad a probarlo, os esperamos.`,
      hashtags: ["#casatomas", "#crevillent", "#comerbien"],
      horaSugerida: o.horaSugerida === undefined ? proximoJueves() : o.horaSugerida,
      resumen: `He entendido: ${fotos.length === 1 ? "1 foto" : `${fotos.length} fotos`} sobre ${tema}.`,
      avisos: [],
    };
  }) as Montador & { peticiones: EntradaMontar[] };
  montador.peticiones = peticiones;
  return montador;
}
