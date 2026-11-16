// Presupuesto de proveedor adjunto al chat de Facturas (16/11/2026).
// El archivo viaja en base64 a la Edge Function chat-facturas, que lo lee y
// pregunta por el descuento. No se guarda como factura.

/** Mismo tope que la función (chat-facturas/presupuesto.ts). */
export const MAX_BYTES_PRESUPUESTO = 8 * 1024 * 1024;

/** Para el `accept` del selector de archivos. */
export const ACEPTA_PRESUPUESTO =
  ".pdf,.xlsx,.xlsm,.xls,.csv,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp,text/csv";

const EXTENSIONES = /\.(pdf|xlsx|xlsm|xls|csv|png|jpe?g|webp)$/i;

/** null si vale; si no, el motivo para enseñar al usuario. */
export function problemaConPresupuesto(archivo: { name: string; type: string; size: number }): string | null {
  if (!EXTENSIONES.test(archivo.name) && !/^(application\/pdf|image\/(png|jpeg|webp)|text\/csv)$/.test(archivo.type)) {
    return "Adjunta el presupuesto en PDF, Excel (.xlsx, .xls, .csv) o foto (JPG, PNG).";
  }
  if (archivo.size <= 0) return "El archivo está vacío.";
  if (archivo.size > MAX_BYTES_PRESUPUESTO) return "El archivo pesa más de 8 MB.";
  return null;
}

/** Contenido del archivo en base64 (sin el prefijo `data:`). */
export function archivoABase64(archivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(lector.error ?? new Error("No se pudo leer el archivo"));
    lector.onload = () => {
      const r = String(lector.result ?? "");
      resolve(r.slice(r.indexOf(",") + 1));
    };
    lector.readAsDataURL(archivo);
  });
}
