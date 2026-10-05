// ============================================================================
//  ALTURA DE LA PESTAÑA «CARGAR» — cuentas puras (sin DOM)
// ----------------------------------------------------------------------------
//  Encargo del dueño (05-oct-2026): «quítame el scroll; que se calcule por
//  porcentaje del máximo para que siempre quede sin scroll y quepa».
//
//  1. La página Facturas mide su alto con `useAlturaDisponible` (el mismo hook
//     que Calendario, Newsletter y Próximas reservas): alto del viewport visual
//     − posición del bloque − relleno inferior del <main>, con suelo
//     `ALTURA_MINIMA_FACTURAS`. La pestaña «Cargar» ocupa justo lo que queda
//     bajo la botonera.
//  2. Dentro de la tarjeta: cabecera, zona de subida, barra de progreso y
//     botones son FIJOS (`shrink-0`); la lista (pendientes de decidir +
//     documentos) se queda con el resto y hace scroll POR DENTRO solo si no cabe.
//  3. La zona de subida grande (icono, texto, dos botones, ayuda) mide
//     ~`ALTO_ZONA_AMPLIA`. Con lista, la zona no puede pasar de
//     `PROPORCION_MAX_ZONA` del alto de la tarjeta (la lista se queda con ≥ 65 %):
//     si no cabe, pasa a la COMPACTA (una fila con los dos botones, ~76 px) y
//     se quita la descripción de la cabecera. Sin lista, siempre la grande.
// ============================================================================

/** Suelo (px) del bloque de la página Facturas: por debajo, scroll de página. */
export const ALTURA_MINIMA_FACTURAS = 420;

/** Alto de la zona de subida grande, medido en el navegador (p-8, icono, texto, botones h-12, ayuda). */
export const ALTO_ZONA_AMPLIA = 260;

/** Con lista, la zona de subida no ocupa más de esta fracción del alto de la tarjeta. */
export const PROPORCION_MAX_ZONA = 0.35;

export type ModoZona = "amplia" | "compacta";

export interface RepartoCargar {
  zona: ModoZona;
  /** Se enseña la descripción bajo el título de la tarjeta. */
  descripcion: boolean;
}

/**
 * Cómo se reparte la tarjeta «Subida de facturas» según su alto REAL (px) y
 * si hay algo que listar. `alto` null (sin medir: jsdom, primer pintado) se
 * trata como pantalla pequeña cuando hay lista.
 */
export function repartoCargar({ alto, hayLista }: { alto: number | null; hayLista: boolean }): RepartoCargar {
  if (!hayLista) return { zona: "amplia", descripcion: true };
  const cabe = alto !== null && Number.isFinite(alto) && alto * PROPORCION_MAX_ZONA >= ALTO_ZONA_AMPLIA;
  return cabe ? { zona: "amplia", descripcion: true } : { zona: "compacta", descripcion: false };
}

/** Alto mínimo de tarjeta (px) con el que la zona grande cabe junto a la lista. */
export const alturaParaZonaAmplia = () => Math.ceil(ALTO_ZONA_AMPLIA / PROPORCION_MAX_ZONA);
