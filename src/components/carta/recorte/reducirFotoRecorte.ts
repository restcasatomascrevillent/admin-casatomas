/**
 * Reduce una foto ANTES de decodificarla a tamaño completo (móvil: una foto
 * de cámara de 12-48 MP ocupa 50-200 MB descomprimida, memoria que el iPhone
 * no tiene si además va a cargar el modelo del recorte).
 *
 *   1. Lee las medidas de la CABECERA del fichero (JPEG / PNG / WebP), sin
 *      decodificar píxeles.
 *   2. Si es grande, pide al navegador el bitmap YA reducido
 *      (`createImageBitmap(foto, { resizeWidth })`: Safari y Chrome decodifican
 *      a la medida pedida). Solo se da el ancho: el alto sale proporcional y
 *      no se deforma aunque la orientación EXIF gire la foto.
 *   3. Si no se conocen las medidas o el navegador no admite la reducción,
 *      cae al redimensionado de siempre (redimensionarFoto).
 */
import { redimensionarFoto } from "../redimensionarFoto";
import { anchoReducido, medidasFoto, type Medidas } from "../medidasFoto";

export { anchoReducido, medidasCabecera, type Medidas } from "../medidasFoto";

/**
 * Foto lista para el recorte con el lado mayor ≈ `lado` (JPEG 0,9), o la
 * propia foto si ya es pequeña. Nunca decodifica a tamaño completo si el
 * navegador sabe reducir al decodificar.
 */
export async function reducirFotoRecorte(foto: Blob, lado: number): Promise<Blob> {
  const medidas: Medidas | null = await medidasFoto(foto);
  if (medidas && Math.max(medidas.ancho, medidas.alto) <= lado) return foto;
  const ancho = medidas ? anchoReducido(medidas, lado) : null;
  if (ancho && typeof createImageBitmap === "function") {
    let bmp: ImageBitmap | null = null;
    try {
      bmp = await createImageBitmap(foto, { imageOrientation: "from-image", resizeWidth: ancho, resizeQuality: "high" });
      // Lado mayor ≤ ~1,4 × lado aunque el giro EXIF se aplique después de reducir.
      const escala = Math.min(1, lado / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * escala));
      const h = Math.max(1, Math.round(bmp.height * escala));
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) throw new Error("Canvas no disponible");
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      bmp = null;
      const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.9));
      c.width = c.height = 0;
      if (blob && blob.size > 0) return blob;
    } catch (e) {
      console.info("[recorte] el navegador no reduce al decodificar; se usa el redimensionado normal", e);
    } finally {
      bmp?.close();
    }
  }
  return (await redimensionarFoto(foto)).blob;
}
