/**
 * PDF del informe: una diapositiva 16:9 por página.
 *
 * Cada diapositiva (lienzo de 1280 × 720 px) se rasteriza con html2canvas a ×3
 * (3840 × 2160, por debajo del límite de 16,7 Mpx de los canvas de Safari en
 * iPad) y se mete en una página de 960 × 540 pt, el tamaño de una diapositiva
 * panorámica: unos 290 ppp, texto nítido en pantalla e impreso. Se usa JPEG de
 * calidad alta porque jsPDF lo incrusta tal cual (rápido incluso en tablet).
 *
 * html2canvas y jsPDF ya están en el proyecto y se cargan aquí con `import()`:
 * no entran en el bundle de la página hasta que se pulsa «Descargar PDF».
 */
import { cssFuenteEmbebida, prepararFuenteInforme } from "./fuente";
import { ALTO_DIAPOSITIVA, ANCHO_DIAPOSITIVA, COLOR } from "./tema";

export const ESCALA_PDF = 3;
const ANCHO_PT = 960;
const ALTO_PT = 540;
const SVG_NS = "http://www.w3.org/2000/svg";

export interface OpcionesPdf {
  titulo: string;
  nombreArchivo: string;
  /** Asunto del PDF (propiedades del documento). Por defecto, el del informe de tráfico web. */
  asunto?: string;
  /** Avance: (diapositivas hechas, total). */
  alAvanzar?: (hechas: number, total: number) => void;
}

/** Genera el PDF con las diapositivas dadas (en orden) y devuelve el Blob. */
export async function crearPdfInforme(diapositivas: HTMLElement[], { titulo, asunto, alAvanzar }: Omit<OpcionesPdf, "nombreArchivo">): Promise<Blob> {
  if (diapositivas.length === 0) throw new Error("No hay diapositivas que exportar.");
  const [{ default: html2canvas }, { jsPDF }, cssFuente] = await Promise.all([
    import("html2canvas"),
    import("jspdf"),
    cssFuenteEmbebida(),
    prepararFuenteInforme(),
  ]);

  // html2canvas mide la línea base de cada fuente en el documento principal con
  // un <img> de 1 px en línea junto a un texto (un <div> oculto colgado de
  // <body>). El preflight de Tailwind pone `img { display: block }`: la imagen
  // baja de línea y todo el texto saldría desplazado hacia abajo, más cuanto
  // mayor es la letra. Mientras dura la exportación se devuelve ese <img> a su
  // sitio; el selector solo alcanza a ese <div> de medida.
  const arregloLineaBase = document.createElement("style");
  arregloLineaBase.textContent = 'body > div[style*="visibility: hidden"] > img { display: inline !important; }';
  document.head.appendChild(arregloLineaBase);
  try {
    return await rasterizar(diapositivas, { titulo, asunto, alAvanzar }, html2canvas, jsPDF, cssFuente);
  } finally {
    arregloLineaBase.remove();
  }
}

async function rasterizar(
  diapositivas: HTMLElement[],
  { titulo, asunto = "Informe mensual de tráfico web", alAvanzar }: Omit<OpcionesPdf, "nombreArchivo">,
  html2canvas: typeof import("html2canvas").default,
  jsPDF: typeof import("jspdf").jsPDF,
  cssFuente: string | null,
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [ANCHO_PT, ALTO_PT], compress: true });
  doc.setProperties({ title: titulo, subject: asunto, author: "Casa Tomás", creator: "Panel de Casa Tomás" });

  for (let i = 0; i < diapositivas.length; i++) {
    const graficos = svgsComoImagenes(diapositivas[i], cssFuente);
    const canvas = await html2canvas(diapositivas[i], {
      scale: ESCALA_PDF,
      width: ANCHO_DIAPOSITIVA,
      height: ALTO_DIAPOSITIVA,
      windowWidth: ANCHO_DIAPOSITIVA,
      windowHeight: ALTO_DIAPOSITIVA,
      backgroundColor: COLOR.papel,
      logging: false,
      useCORS: true,
      onclone: (documento, elemento) => {
        // Cada gráfica (SVG) se cambia por una <img> con el mismo SVG ya
        // serializado y con la fuente dentro (ver `svgsComoImagenes`).
        elemento.querySelectorAll("svg").forEach((svg, j) => {
          const g = graficos[j];
          if (!g) return;
          const img = documento.createElement("img");
          img.src = g.src;
          img.alt = "";
          img.style.cssText = `display:block;width:${g.ancho}px;height:${g.alto}px;max-width:none;`;
          svg.replaceWith(img);
        });
      },
    });
    const imagen = canvas.toDataURL("image/jpeg", 0.92);
    if (i > 0) doc.addPage([ANCHO_PT, ALTO_PT], "landscape");
    doc.addImage(imagen, "JPEG", 0, 0, ANCHO_PT, ALTO_PT, undefined, "FAST");
    // Libera la memoria del canvas antes del siguiente (importante en tablet).
    canvas.width = 0;
    canvas.height = 0;
    alAvanzar?.(i + 1, diapositivas.length);
  }
  return doc.output("blob");
}

/**
 * html2canvas pinta cada SVG como una imagen aislada, que no ve las fuentes del
 * documento: los textos de las gráficas saldrían con otra letra. Aquí se copia
 * cada SVG con la fuente incrustada (data: URI) y se convierte en imagen. Se
 * hace sobre una copia suelta, fuera del documento: si el <style> con la
 * fuente se metiera en el clon que maqueta html2canvas, la CSP del panel
 * (font-src 'self') lo bloquearía con un error en consola; dentro de una
 * imagen SVG sí se aplica.
 */
function svgsComoImagenes(diapositiva: HTMLElement, cssFuente: string | null): { src: string; ancho: number; alto: number }[] {
  const serializador = new XMLSerializer();
  return Array.from(diapositiva.querySelectorAll("svg")).map((svg) => {
    const ancho = Number(svg.getAttribute("width")) || svg.getBoundingClientRect().width;
    const alto = Number(svg.getAttribute("height")) || svg.getBoundingClientRect().height;
    const copia = svg.cloneNode(true) as SVGSVGElement;
    copia.setAttribute("xmlns", SVG_NS);
    copia.setAttribute("width", String(ancho));
    copia.setAttribute("height", String(alto));
    if (cssFuente) {
      const estilo = document.createElementNS(SVG_NS, "style");
      estilo.textContent = cssFuente;
      copia.insertBefore(estilo, copia.firstChild);
    }
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serializador.serializeToString(copia))}`, ancho, alto };
  });
}

/** Descarga un Blob con nombre de archivo (también en Safari de iPad, que lo abre para compartir/guardar). */
export function descargarBlob(blob: Blob, nombreArchivo: string): void {
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.rel = "noopener";
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function descargarPdfInforme(diapositivas: HTMLElement[], opciones: OpcionesPdf): Promise<void> {
  const blob = await crearPdfInforme(diapositivas, opciones);
  descargarBlob(blob, opciones.nombreArchivo);
}
