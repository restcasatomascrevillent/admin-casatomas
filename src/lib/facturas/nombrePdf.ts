/** Nombre de fichero para descargar el original de un documento («Factura 123 · Makro.pdf»). */
export function nombrePdf(titulo: string): string {
  const limpio = titulo.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${limpio || "original"}.pdf`;
}
