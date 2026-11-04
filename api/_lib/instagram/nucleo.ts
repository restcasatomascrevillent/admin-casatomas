/**
 * Puente con el núcleo isomórfico de las piezas (src/lib/instagram/): el
 * MISMO código valida y construye el HTML en el panel (vista previa) y aquí
 * (render a JPEG). Las funciones de Vercel solo lo usan a través de este
 * fichero.
 */
import { validarPieza } from "../../../src/lib/instagram/esquema.js";
import { construirDocumento } from "../../../src/lib/instagram/documento.js";
import { CODIGO_COMPROBAR_MAQUETACION, CODIGO_ESPERAR_RECURSOS } from "../../../src/lib/instagram/maquetacion.js";
import { baseFotosPublica, baseRecursosPanel, RUTA_RECURSOS_PANEL } from "../../../src/lib/instagram/recursos.js";
import { FORMATOS, MARCAS } from "../../../src/lib/instagram/tokens.js";
import type { DatosPieza } from "../../../src/lib/instagram/tipos.js";

export { validarPieza, construirDocumento, CODIGO_COMPROBAR_MAQUETACION, CODIGO_ESPERAR_RECURSOS, baseFotosPublica, baseRecursosPanel, RUTA_RECURSOS_PANEL, FORMATOS };
export type { DatosPieza };

/** Medidas del formato de la pieza. */
export function medidas(datos: DatosPieza): { ancho: number; alto: number } {
  const f = FORMATOS[datos.formato];
  return { ancho: f.ancho, alto: f.alto };
}

/** Color de fondo de la marca (para aplanar transparencias al pasar a JPEG). */
export function fondoDeMarca(datos: DatosPieza): string {
  const m = MARCAS[datos.marca] as unknown as { colores: Record<string, string>; roles: Record<string, string> } | undefined;
  const color = m?.colores?.[m.roles?.fondo];
  return typeof color === "string" && color.startsWith("#") ? color : "#ffffff";
}
