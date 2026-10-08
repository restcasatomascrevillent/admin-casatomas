// ============================================================================
//  Contabilidad en `ia_uso` de las llamadas a OpenAI del OCR (08-oct-2026)
// ----------------------------------------------------------------------------
//  Une `crearClienteOpenAI({ alUsar })` con _shared/registrar-uso-ia.ts. Una
//  fila por llamada (visión, texto o embeddings):
//
//    funcion     'procesar-factura' (camino síncrono, sustituir) u
//                'ocr-trabajo' (piezas, pieza única, consolidación)
//    operacion   'vision' | 'embedding'  (el CHECK de ia_uso no admite más)
//    disparador  '<origen>#<etapa>': `trabajo:<uuid>#relectura`,
//                `subida:<uuid>#lectura`… La etapa (lectura, relectura, pie,
//                contador, embeddings) va detrás de '#' y el documento delante:
//                gasto_ia_resumen cuenta documentos con split_part(…, '#', 1).
//
//  NO BLOQUEA LA LECTURA: el INSERT sale en cuanto vuelve OpenAI, sin await, y
//  `esperar()` solo se llama al final de la petición (ya terminado casi
//  siempre) para que el runtime no congele el aislamiento con la fila a medio
//  escribir. registrarUso() nunca lanza: si falla, solo hay console.error.
// ============================================================================

import { AcumuladorUso, type OpcionesRegistro, registrarUso } from "../_shared/registrar-uso-ia.ts";
import type { UsoLlamada } from "./openai.ts";

export type FuncionOcr = "procesar-factura" | "ocr-trabajo";

export interface RegistroUsoOcr {
  alUsar: (u: UsoLlamada) => void;
  /** Espera a que acaben los INSERT pendientes. Nunca lanza. */
  esperar: () => Promise<void>;
}

export function crearRegistroUso(opciones: {
  funcion: FuncionOcr;
  /** Documento sin datos personales: `trabajo:<uuid>` o `subida:<uuid>`. */
  disparador: string;
  // deno-lint-ignore no-explicit-any
  cliente?: OpcionesRegistro["cliente"] | any;
  /** Para los tests. */
  registrar?: typeof registrarUso;
}): RegistroUsoOcr {
  const registrar = opciones.registrar ?? registrarUso;
  const pendientes: Promise<void>[] = [];

  const alUsar = (u: UsoLlamada) => {
    try {
      const a = new AcumuladorUso(opciones.funcion, u.modelo, u.operacion);
      a.sumar(u.usage);
      pendientes.push(
        Promise.resolve(
          registrar(a, {
            disparador: `${opciones.disparador}#${u.etapa}`.slice(0, 200),
            duracionMs: u.duracionMs,
            cliente: opciones.cliente ?? null,
          }),
        ).catch((e) => console.error("[ia-uso] registro OCR:", e)),
      );
    } catch (e) {
      console.error("[ia-uso] registro OCR:", e);
    }
  };

  const esperar = async () => {
    try {
      await Promise.allSettled(pendientes.splice(0));
    } catch {
      // nunca
    }
  };

  return { alUsar, esperar };
}
