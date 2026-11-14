// ============================================================================
//  Hojas de un PDF como imágenes, con pdf.js, en el navegador (13/11/2026)
// ----------------------------------------------------------------------------
//  «La factura en PDF no se ve en el panel»: el original de Drive llega como
//  blob y la CSP del panel no deja incrustarlo (`object-src 'none'`, `frame-src`
//  sin blob:). En vez de abrir la CSP, el panel pinta cada hoja en un <canvas>
//  y la enseña como imagen (`img-src` ya admite blob:). De paso se ven TODAS
//  las hojas también en el iPad, donde un PDF incrustado solo enseña la primera.
//
//  · El worker de pdf.js va empaquetado (`?url`, mismo origen: `worker-src 'self'`).
//  · Lo que pdf.js pide aparte (decodificadores wasm de JBIG2/JPEG 2000, típicos
//    de facturas escaneadas, y las fuentes Symbol/ZapfDingbats) se sirve con un
//    `BinaryDataFactory` propio que apunta a esos ficheros empaquetados: sin
//    tocar la configuración de Vite ni pedir nada a otros dominios.
//  · Solo se carga al abrir un PDF (import dinámico desde VisorPdf).
// ============================================================================
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import urlTrabajador from "pdfjs-dist/legacy/build/pdf.worker.min.mjs?url";
import urlJbig2 from "pdfjs-dist/wasm/jbig2.wasm?url";
import urlOpenjpeg from "pdfjs-dist/wasm/openjpeg.wasm?url";
import urlSimbolos from "pdfjs-dist/standard_fonts/FoxitSymbol.pfb?url";
import urlDingbats from "pdfjs-dist/standard_fonts/FoxitDingbats.pfb?url";

GlobalWorkerOptions.workerSrc = urlTrabajador;

/** Lo que pdf.js puede pedir por nombre y va empaquetado. */
const FICHEROS: Record<string, string> = {
  "jbig2.wasm": urlJbig2,
  "openjpeg.wasm": urlOpenjpeg,
  "FoxitSymbol.pfb": urlSimbolos,
  "FoxitDingbats.pfb": urlDingbats,
};

/** `BinaryDataFactory` de pdf.js: devuelve los ficheros empaquetados por su nombre. */
class FicherosEmpaquetados {
  // pdf.js la construye con { cMapUrl, standardFontDataUrl, wasmUrl }: no se usan.
  constructor(_opciones?: unknown) {}

  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = FICHEROS[filename];
    if (!url) throw new Error(`pdf.js pide «${kind}/${filename}», que no va empaquetado`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`No se pudo cargar ${filename} (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

/** Ancho en píxeles de cada hoja pintada: nítida al ampliar sin gastar de más (≈ 2,8 Mpx por hoja A4). */
export const ANCHO_HOJA_PX = 1400;
/** Tope de hojas que se pintan (las facturas tienen 1–3; un PDF enorme no bloquea la ficha). */
export const MAX_HOJAS = 15;

export interface HojasPdf {
  /** blob URL de cada hoja pintada (PNG), en orden. Quien las recibe las libera. */
  hojas: string[];
  /** Hojas que tiene el PDF (puede ser más que las pintadas). */
  total: number;
}

/**
 * Pinta las primeras `MAX_HOJAS` hojas del PDF. `alHoja` avisa de cada una en
 * cuanto está, para enseñarla sin esperar al resto. `cancelado()` corta entre
 * hojas (la ficha se ha cerrado o ha cambiado de documento).
 */
export async function pintarHojasPdf(
  datos: ArrayBuffer,
  opciones: { alHoja?: (url: string, indice: number, total: number) => void; cancelado?: () => boolean } = {},
): Promise<HojasPdf> {
  const tarea = getDocument({
    data: new Uint8Array(datos),
    BinaryDataFactory: FicherosEmpaquetados,
    useWorkerFetch: false,
    // Ni formularios XFA ni scripts del PDF: solo se quiere ver el papel.
    enableXfa: false,
  });
  const hojas: string[] = [];
  try {
    const pdf = await tarea.promise;
    const total = pdf.numPages;
    for (let n = 1; n <= Math.min(total, MAX_HOJAS); n++) {
      if (opciones.cancelado?.()) break;
      const pagina = await pdf.getPage(n);
      const base = pagina.getViewport({ scale: 1 });
      const escala = Math.min(4, Math.max(0.5, ANCHO_HOJA_PX / base.width));
      const vista = pagina.getViewport({ scale: escala });
      const lienzo = document.createElement("canvas");
      lienzo.width = Math.floor(vista.width);
      lienzo.height = Math.floor(vista.height);
      await pagina.render({ canvas: lienzo, viewport: vista, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob | null>((ok) => lienzo.toBlob(ok, "image/png"));
      // Libera la memoria del lienzo enseguida (en iPad cuenta).
      lienzo.width = 0;
      lienzo.height = 0;
      pagina.cleanup();
      if (!blob) throw new Error(`No se pudo pintar la hoja ${n}`);
      const url = URL.createObjectURL(blob);
      hojas.push(url);
      opciones.alHoja?.(url, n - 1, total);
    }
    return { hojas, total };
  } catch (e) {
    for (const u of hojas) URL.revokeObjectURL(u);
    throw e;
  } finally {
    void tarea.destroy();
  }
}
