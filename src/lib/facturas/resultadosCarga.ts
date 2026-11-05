// ============================================================================
//  Resultados de la pestaña «Cargar» — cuentas puras (sin DOM)
// ----------------------------------------------------------------------------
//  · `tipoDocumento`: Factura o Albarán según lo que devolvió el servidor, con
//    el mismo criterio para la fila, el toast y la campana. Sin tipo reconocible
//    devuelve null (no se inventa «Factura»).
//  · `ordenarPorGravedad`: lo que pide atención va arriba:
//    en marcha → fallido → aviso → duplicado → ok.
//  · `lineaEstado`: UNA línea de estado por documento (nivel + texto).
// ============================================================================

import {
  clasificarResultado,
  type ElementoCola,
  normalizarTipo,
  type ResultadoProcesamiento,
  type TipoDocumento,
} from "./colaSubida";

/** Tipo REAL del documento leído: lo que dice el resultado, nunca un valor por defecto. */
export function tipoDocumento(r: ResultadoProcesamiento | undefined | null): TipoDocumento | null {
  if (!r) return null;
  const resp = r.respuesta as { tipo?: unknown } | null | undefined;
  return normalizarTipo(r.tipo) ?? normalizarTipo(resp?.tipo);
}

export const ETIQUETA_TIPO: Record<TipoDocumento, string> = { factura: "Factura", albaran: "Albarán" };

export type NivelFila = "marcha" | "fallido" | "aviso" | "duplicado" | "ok";

/** Orden de aparición: en marcha, luego de más a menos grave. */
const ORDEN_NIVEL: Record<NivelFila, number> = { marcha: 0, fallido: 1, aviso: 2, duplicado: 3, ok: 4 };

export function nivelFila(e: ElementoCola): NivelFila {
  if (e.fase !== "terminado") return "marcha";
  switch (clasificarResultado(e.resultado)) {
    case "fallida":
      return "fallido";
    case "en_servidor":
      // Sigue (o se quedó parado) en el servidor: no es un fallo, no va en rojo.
      return "aviso";
    case "avisos":
    case "sin_original":
      return "aviso";
    case "duplicada":
    case "pendiente":
      return "duplicado";
    default:
      return "ok"; // guardada, sustituida
  }
}

/**
 * Ordena por gravedad. Dentro de un mismo nivel, el último enviado primero
 * (el orden de `elementos` es el de envío).
 */
export function ordenarPorGravedad(elementos: ElementoCola[]): ElementoCola[] {
  return elementos
    .map((e, i) => ({ e, i, n: ORDEN_NIVEL[nivelFila(e)] }))
    .sort((a, b) => a.n - b.n || b.i - a.i)
    .map((x) => x.e);
}

/** «312 KB», «1,4 MB»: el tamaño de un fichero para la cola. */
export function formatoTamano(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 })} MB`;
}

export type ClaseFichero = "imagen" | "pdf" | "otro";

/** Clase de fichero para elegir el icono de la fila cuando no hay miniatura real. */
export function claseFichero(e: Pick<ElementoCola, "file" | "nombre">): ClaseFichero {
  const mime = e.file?.type ?? "";
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|heic|gif)$/i.test(e.nombre)) return "imagen";
  if (mime === "application/pdf" || /\.pdf$/i.test(e.nombre)) return "pdf";
  return "otro";
}

export interface LineaEstado {
  nivel: NivelFila;
  texto: string;
}

/** La única línea de estado de un documento enviado. */
export function lineaEstado(e: ElementoCola): LineaEstado {
  const nivel = nivelFila(e);
  const r = e.resultado;
  const piezas = e.piezas ?? 0;
  if (nivel === "marcha") {
    const base = e.progreso || "En cola…";
    return { nivel, texto: piezas > 1 ? `${base} · Documento largo: se lee en ${piezas} trozos en el servidor.` : base };
  }
  if (nivel === "fallido") return { nivel, texto: r?.error || "No se pudo leer el documento." };
  if (r && !r.success && (r.sigueEnServidor || r.parado)) return { nivel, texto: r.error || "Sigue en el servidor." };
  if (nivel === "duplicado") {
    return {
      nivel,
      texto: r?.descartado
        ? "Ya existía: has decidido dejar la que había. No se ha creado otra."
        : r?.anadible
        ? `Es la página ${r.anadible.pagina.actual} de ${r.anadible.pagina.total} de la factura ${r.anadible.existente.numero_documento}: ` +
          "puedes añadirla arriba, en «Pendientes de decidir»."
        : r?.sustituible
          ? "Ya existía: está arriba, en «Pendientes de decidir»."
          : "Ya existía un documento con el mismo número y proveedor: no se ha creado uno nuevo." +
            (r?.motivoNoSustituible ? ` No se ofrece sustituirlo: ${r.motivoNoSustituible}.` : ""),
    };
  }
  const partes: string[] = [];
  const guardado = tipoDocumento(r) === "factura" ? "Guardada" : "Guardado";
  if (nivel === "aviso") {
    const n = r?.alertas?.length ?? 0;
    if (r?.archivoGuardado === false) {
      partes.push(`${guardado} · sin original: el fichero no se ha podido archivar; guarda una copia a mano.`);
    }
    if (n > 0) partes.push(`${n} aviso${n > 1 ? "s" : ""}: ${r!.alertas!.map((a) => a.mensaje).join(" · ")}`);
  } else {
    partes.push(
      r?.paginaAnadida
        ? "Añadido como página a la factura que ya existía."
        : r?.sustituida
          ? "Factura existente sustituida por este documento."
          : guardado,
    );
  }
  // Drive falló: el original espera en una copia temporal y se sube solo.
  if (r?.archivoEstado === "temporal") partes.push("original pendiente de subir a Drive (se subirá solo)");
  if (piezas > 1) partes.push(`Leído en ${piezas} trozos y unido.`);
  return { nivel, texto: partes.join(" · ") };
}
