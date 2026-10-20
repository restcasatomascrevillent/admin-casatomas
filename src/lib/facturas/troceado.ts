// ============================================================================
//  Troceado de documentos largos en el navegador (04b + decisión del dueño
//  del 05-oct-2026)
// ----------------------------------------------------------------------------
//  Una imagen MUY ALTA (captura de móvil con dos páginas de un PDF apiladas,
//  ticket largo) no se lee bien de una vez: el modelo «se cansa» y devuelve
//  una fracción de las filas (Luga ML/101511: 8 de 54). Se corta en FRANJAS
//  horizontales con SOLAPE; cada franja es una pieza del mismo trabajo de OCR
//  y la consolidación del servidor quita las filas repetidas del solape.
//
//  Lo puro (decidir y planificar) está separado del canvas para poder
//  probarlo con vitest y reutilizarlo en el banco de Node.
// ============================================================================

/** Relación alto/ancho a partir de la cual una imagen se trocea. Las capturas
 *  de pantalla de un móvil miden ~2,17 (945×2048, 738×1600); las fotos de una
 *  hoja A4, ~1,41-1,78. Fijado con el banco de 19 documentos reales: por
 *  encima de 1,9 solo quedan capturas de móvil de un PDF (Luga, Equipalia,
 *  Angelmar), y trocearlas no empeora las cortas (ver 04b §1.14). */
export const UMBRAL_RELACION = 1.9;
/** Alto mínimo en píxeles: una imagen alta pero pequeña (un recibo de 400 px)
 *  no gana nada troceándola. Subido de 1400 a 1800 (10/10/2026): una captura
 *  de móvil reenviada por WhatsApp (736×1600, factura 374 de Central de
 *  Carnes, 3 líneas) se partía en 5 franjas con 11 llamadas (0,0177 USD, 3,5×
 *  la media) y sus notas acababan en las observaciones. A 1600 px de alto el
 *  modelo ya la ve a resolución completa (lado corto < 768 px: no la reduce);
 *  las capturas largas de verdad (945×2048: Luga, Equipalia) se siguen
 *  troceando. 04b §1.14 ya medía que trocear las cortas no mejoraba nada. */
export const UMBRAL_ALTO_PX = 1800;
/** Alto de cada franja respecto del ancho (0,5-0,6 según el diagnóstico). */
export const ALTO_FRANJA_RELATIVO = 0.55;
/** Solape respecto del ancho (≈ 85 px en una captura de 945 px: 3-4 renglones). */
export const SOLAPE_RELATIVO = 0.09;
/** Ancho máximo que se manda (las franjas se reescalan si la imagen es mayor). */
export const ANCHO_MAX_FRANJA = 2000;
/** Máximo de franjas por imagen (el trabajo admite 40 piezas). */
export const MAX_FRANJAS = 12;

export interface Franja {
  /** 1..n */
  indice: number;
  /** Coordenada Y de inicio, en píxeles de la imagen original. */
  y: number;
  /** Alto en píxeles de la imagen original. */
  alto: number;
}

export function debeTrocear(ancho: number, alto: number): boolean {
  if (!(ancho > 0) || !(alto > 0)) return false;
  return alto / ancho >= UMBRAL_RELACION && alto >= UMBRAL_ALTO_PX;
}

/**
 * Plan de franjas para una imagen de ancho×alto. Cada franja mide
 * ~0,55×ancho y se solapa ~0,09×ancho con la anterior. Si la última quedaría
 * muy baja (< 35 % de una franja), se alarga la penúltima hasta el final.
 */
export function planificarFranjas(ancho: number, alto: number): Franja[] {
  const altoFranja = Math.max(200, Math.round(ancho * ALTO_FRANJA_RELATIVO));
  const solape = Math.min(220, Math.max(60, Math.round(ancho * SOLAPE_RELATIVO)));
  if (alto <= altoFranja * 1.2) return [{ indice: 1, y: 0, alto }];

  const franjas: Franja[] = [];
  let y = 0;
  while (y < alto) {
    const fin = Math.min(alto, y + altoFranja);
    franjas.push({ indice: franjas.length + 1, y, alto: fin - y });
    if (fin >= alto) break;
    y = fin - solape;
  }
  // Última franja enana: se funde con la anterior.
  if (franjas.length > 1) {
    const ultima = franjas[franjas.length - 1];
    if (ultima.alto < altoFranja * 0.35) {
      franjas.pop();
      const pen = franjas[franjas.length - 1];
      pen.alto = alto - pen.y;
    }
  }
  // Demasiadas franjas (imagen larguísima): se reparte en MAX_FRANJAS iguales.
  if (franjas.length > MAX_FRANJAS) {
    const paso = Math.ceil((alto + solape * (MAX_FRANJAS - 1)) / MAX_FRANJAS);
    const out: Franja[] = [];
    for (let i = 0; i < MAX_FRANJAS; i++) {
      const yi = Math.max(0, i * (paso - solape));
      const fi = i === MAX_FRANJAS - 1 ? alto : Math.min(alto, yi + paso);
      out.push({ indice: i + 1, y: yi, alto: fi - yi });
    }
    return out;
  }
  return franjas;
}

// ─── Canvas (solo navegador) ─────────────────────────────────────────────────

export interface ImagenTroceada {
  ancho: number;
  alto: number;
  franjas: { franja: Franja; blob: Blob }[];
}

/** Dimensiones reales de una imagen (con la orientación EXIF aplicada). */
export async function dimensionesImagen(file: Blob): Promise<{ ancho: number; alto: number }> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return { ancho: bmp.width, alto: bmp.height };
  } finally {
    bmp.close();
  }
}

/** Corta la imagen en franjas JPEG (calidad 0,92, sin recortar los lados). */
export async function trocearImagen(file: Blob): Promise<ImagenTroceada> {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const plan = planificarFranjas(bmp.width, bmp.height);
    const escala = Math.min(1, ANCHO_MAX_FRANJA / bmp.width);
    const franjas: ImagenTroceada["franjas"] = [];
    for (const f of plan) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bmp.width * escala);
      canvas.height = Math.round(f.alto * escala);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("El navegador no permite usar canvas para trocear la imagen");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bmp, 0, f.y, bmp.width, f.alto, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((ok, ko) =>
        canvas.toBlob((b) => (b ? ok(b) : ko(new Error("No se pudo codificar la franja"))), "image/jpeg", 0.92)
      );
      franjas.push({ franja: f, blob });
    }
    return { ancho: bmp.width, alto: bmp.height, franjas };
  } finally {
    bmp.close();
  }
}
