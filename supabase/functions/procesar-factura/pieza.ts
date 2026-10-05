// ============================================================================
//  pieza.ts · Leer UNA pieza (página o franja) de un documento largo
// ----------------------------------------------------------------------------
//  04b §1.7. Extracción con el esquema de página + contador de filas SIEMPRE
//  (en paralelo) + verificador del pie (solo la última pieza) + UNA relectura
//  correctiva en la misma llamada si hay motivos LOCALES y queda tiempo.
//  Sin base de datos ni Deno: lo usan ocr-trabajo y el banco local de Node.
// ============================================================================

import { compararExpansion, contarCambiosNumericos, MAX_CAMBIOS_RELECTURA, type RecuentoFilas, type VerificacionPie } from "./esquema.ts";
import type { BloqueContenido, ClienteOpenAI } from "./openai.ts";
import {
  construirContexto,
  type ContextoPagina,
  contextoComoTexto,
  mensajeCorrectivoPagina,
  type MotivoRelectura,
  motivosLocales,
  PAGINA_JSON_SCHEMA,
  paginaComoDocumento,
  pesoMotivos,
  type ResultadoPagina,
  validarPaginaOLanzar,
} from "./pagina.ts";
import { anexoPieza, type DescripcionPieza, textoContadorPieza, VISION_SYSTEM_PROMPT } from "./prompts.ts";

export interface PiezaLeida {
  resultado: ResultadoPagina;
  recuento: RecuentoFilas | null;
  verificacionPie: VerificacionPie | null;
  /** 0 o 1: relecturas correctivas hechas en esta llamada. */
  relecturas: number;
  /** Motivos que quedan sin resolver (la consolidación decide). */
  motivos: MotivoRelectura[];
  /** Solo en la pieza 1: el contexto para las demás. */
  contexto: ContextoPagina | null;
  duracionMs: number;
}

export interface OpcionesPieza {
  /** Contexto de la pieza 1 (null en la propia pieza 1). */
  contexto: ContextoPagina | null;
  /** Es la última pieza del trabajo: se verifica el pie. */
  esUltima: boolean;
  /** Ya se releyó una vez (relectura diferida pedida por la consolidación). */
  yaReleida: boolean;
  /** Motivos que pidió la consolidación (relectura diferida). */
  motivosPrevios?: MotivoRelectura[] | null;
  /** Presupuesto: no se hace la relectura si ya se han gastado más ms. */
  presupuestoRelecturaMs?: number;
  ahora?: () => number;
}

/** Acepta la relectura solo si COMPLETA (expansión) o corrige pocos números y
 *  no empeora: las mismas defensas anti-«cuadre inventado» que el camino de
 *  una página (index.ts v101 / extraccion.ts). */
export function aceptarRelectura(
  primera: ResultadoPagina,
  segunda: ResultadoPagina,
  motivos1: MotivoRelectura[],
  motivos2: MotivoRelectura[],
): boolean {
  const a = paginaComoDocumento(primera);
  const b = paginaComoDocumento(segunda);
  if (compararExpansion(a, b).esExpansion) return true;
  // Contracción legítima: la primera lectura escribió un bloque dos veces y la
  // segunda lo quita sin tocar ningún otro importe (todas sus filas estaban).
  const habiaBucle = motivos1.some((m) => m.codigo === "bloque_repetido");
  const quedaBucle = motivos2.some((m) => m.codigo === "bloque_repetido");
  if (habiaBucle && !quedaBucle && b.productos.length < a.productos.length &&
    compararExpansion(b, a).importesPerdidos === 0) {
    return true;
  }
  if (contarCambiosNumericos(a, b).total > MAX_CAMBIOS_RELECTURA) return false;
  return pesoMotivos(motivos2) <= pesoMotivos(motivos1);
}

export async function leerPieza(
  cliente: ClienteOpenAI,
  bloque: BloqueContenido,
  d: DescripcionPieza,
  o: OpcionesPieza,
): Promise<PiezaLeida> {
  const ahora = o.ahora ?? Date.now;
  const t0 = ahora();
  const textoUsuario = anexoPieza(d, contextoComoTexto(o.contexto));
  // deno-lint-ignore no-explicit-any
  const mensajes: any[] = [
    { role: "system", content: VISION_SYSTEM_PROMPT },
    { role: "user", content: [bloque, { type: "text", text: textoUsuario }] },
  ];
  // Relectura diferida: se manda el motivo en el primer turno.
  if (o.motivosPrevios && o.motivosPrevios.length > 0) {
    mensajes[1].content.push({ type: "text", text: mensajeCorrectivoPagina(o.motivosPrevios) });
  }

  const [crudo, recuento, verificacionPie] = await Promise.all([
    cliente.llamarVision(mensajes, PAGINA_JSON_SCHEMA),
    cliente.contarFilas(bloque, textoContadorPieza(d)),
    o.esUltima ? cliente.verificarPie(bloque) : Promise.resolve(null),
  ]);
  let resultado = validarPaginaOLanzar(crudo, `pieza ${d.numero}`);
  let motivos = motivosLocales(resultado, recuento, o.contexto);
  let relecturas = o.yaReleida || (o.motivosPrevios?.length ?? 0) > 0 ? 1 : 0;

  const presupuesto = o.presupuestoRelecturaMs ?? 70_000;
  if (motivos.length > 0 && relecturas === 0 && ahora() - t0 < presupuesto) {
    try {
      mensajes.push({ role: "assistant", content: JSON.stringify(resultado) });
      mensajes.push({ role: "user", content: mensajeCorrectivoPagina(motivos) });
      const segunda = validarPaginaOLanzar(await cliente.llamarVision(mensajes, PAGINA_JSON_SCHEMA), `pieza ${d.numero} relectura`);
      const motivos2 = motivosLocales(segunda, recuento, o.contexto);
      relecturas = 1;
      if (aceptarRelectura(resultado, segunda, motivos, motivos2)) {
        // filas_tabla no puede bajar entre lecturas (conservarRecuentoFilas).
        const filas = Math.max(resultado.filas_tabla ?? 0, segunda.filas_tabla ?? 0) || null;
        resultado = { ...segunda, filas_tabla: filas };
        motivos = motivos2;
      }
    } catch (e) {
      console.warn(`[pieza ${d.numero}] la relectura falló, se conserva la primera lectura:`, e);
      relecturas = 1;
    }
  }

  return {
    resultado,
    recuento,
    verificacionPie,
    relecturas,
    motivos,
    contexto: d.numero === 1 ? construirContexto(resultado, d.total) : null,
    duracionMs: ahora() - t0,
  };
}
