// ============================================================================
//  Partir un PDF de varias páginas en el navegador (04b, tarea E2)
// ----------------------------------------------------------------------------
//  Cada página sale como un PDF de UNA página (OpenAI `type: "file"` sigue
//  mandando texto + imagen de esa página). Si una página es muy alta (un
//  ticket o un PDF «continuo»), además se corta en franjas con solape
//  recortando el MediaBox/CropBox, con el mismo plan que las imágenes.
//  pdf-lib (MIT) se carga con import() dinámico: no engorda el bundle inicial.
// ============================================================================

import { debeTrocear, planificarFranjas } from "./troceado";

export interface PiezaPdf {
  /** Página del documento (1..). */
  pagina: number;
  /** Índice de franja dentro de la página, o null si es la página entera. */
  franja: number | null;
  franjasPagina: number | null;
  bytes: Uint8Array;
}

export interface PdfDividido {
  numPaginas: number;
  piezas: PiezaPdf[];
}

/** Nº de páginas sin partir nada (para decidir el camino). */
export async function contarPaginasPdf(bytes: ArrayBuffer | Uint8Array): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.getPageCount();
}

/** ¿Hay que trocear este PDF? (más de una página o alguna muy alta) */
export async function analizarPdf(bytes: ArrayBuffer | Uint8Array): Promise<{ paginas: number; alguna_alta: boolean }> {
  const { PDFDocument } = await import("pdf-lib");
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const alguna = doc.getPages().some((p) => {
    const { width, height } = p.getSize();
    return debeTrocear(width * 4, height * 4); // puntos → px aproximados a ~288 DPI para el umbral de alto
  });
  return { paginas: doc.getPageCount(), alguna_alta: alguna };
}

export async function dividirPdf(bytes: ArrayBuffer | Uint8Array): Promise<PdfDividido> {
  const { PDFDocument } = await import("pdf-lib");
  const origen = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  const n = origen.getPageCount();
  const piezas: PiezaPdf[] = [];
  for (let i = 0; i < n; i++) {
    const pagina = origen.getPage(i);
    const { width, height } = pagina.getSize();
    const alta = debeTrocear(width * 4, height * 4);
    if (!alta) {
      const nuevo = await PDFDocument.create();
      const [copia] = await nuevo.copyPages(origen, [i]);
      nuevo.addPage(copia);
      piezas.push({ pagina: i + 1, franja: null, franjasPagina: null, bytes: await nuevo.save() });
      continue;
    }
    // Franjas: mismo plan que una imagen, en puntos PDF. El origen de
    // coordenadas del PDF está ABAJO: la franja 1 (arriba) va de height-y-alto
    // a height-y.
    const plan = planificarFranjas(width, height);
    for (const f of plan) {
      const nuevo = await PDFDocument.create();
      const [copia] = await nuevo.copyPages(origen, [i]);
      const base = pagina.getMediaBox();
      const yAbajo = base.y + (height - f.y - f.alto);
      copia.setMediaBox(base.x, yAbajo, width, f.alto);
      copia.setCropBox(base.x, yAbajo, width, f.alto);
      nuevo.addPage(copia);
      piezas.push({ pagina: i + 1, franja: f.indice, franjasPagina: plan.length, bytes: await nuevo.save() });
    }
  }
  return { numPaginas: n, piezas };
}
