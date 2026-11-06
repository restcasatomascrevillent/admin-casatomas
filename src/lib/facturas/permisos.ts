/**
 * Qué puede hacer cada uno en Facturas (decisiones del dueño, 06/11/2026).
 *
 *   · «Ver» en Facturas       → CONSULTAR Análisis y Compras (tablero,
 *     explorador, chips, detalle, documentos, original, CSV y «Personalizar» su
 *     vista). Sin la pestaña Cargar, sin editar, borrar, verificar, clasificar,
 *     ajustes ni IA.
 *   · «Facturas · Subida»     → la pestaña Cargar: subir, ver el progreso,
 *     decidir sobre los duplicados (sustituir o completar solo lo suyo) y
 *     corregir los datos leídos de lo que ha subido él. Va por libre: con solo
 *     Subida no se ven Análisis ni Compras.
 *   · «Editar» en Facturas    → todo, como siempre (IA y Cargar incluidas).
 *   · Super admin             → todo (useCanAccessSection ya da true).
 *
 * El servidor lo hace cumplir: migración 20261106510000_permisos_facturas_subida,
 * procesar-factura y chat-facturas. Aquí solo se decide qué se ENSEÑA: lo que no
 * se puede usar se oculta (no se desactiva) y arriba sale «Solo lectura».
 */
export interface PermisosFacturas {
  /** Análisis y Compras en lectura: «Ver» o «Editar». */
  consultar: boolean;
  /** Todo lo de Facturas, IA incluida: «Editar». */
  editar: boolean;
  /** Pestaña Cargar: «Facturas · Subida» o «Editar». */
  subir: boolean;
}

export const SIN_PERMISOS_FACTURAS: PermisosFacturas = { consultar: false, editar: false, subir: false };

/** De los permisos de las dos secciones (facturas y facturas_subida) a lo que se puede hacer. */
export function permisosFacturas(p: { ver: boolean; editar: boolean; subida: boolean }): PermisosFacturas {
  return { consultar: p.ver || p.editar, editar: p.editar, subir: p.subida || p.editar };
}

/** Valor de las pestañas de /facturas (`chat` = Análisis). */
export type PestanaFacturas = "chat" | "compras" | "cargar";

/** Pestañas que se ven, en el orden de la barra. */
export function pestanasFacturas(p: PermisosFacturas): PestanaFacturas[] {
  return [...(p.consultar ? (["chat", "compras"] as const) : []), ...(p.subir ? (["cargar"] as const) : [])];
}

/**
 * La pestaña que se abre: la pedida si se puede ver; si no, la primera que sí
 * (con solo Subida, un enlace a Análisis o a Compras lleva a Cargar). Null si
 * no se puede ver ninguna (la ruta ya lo habrá rechazado).
 */
export function pestanaPermitida(pedida: PestanaFacturas, p: PermisosFacturas): PestanaFacturas | null {
  const visibles = pestanasFacturas(p);
  return visibles.includes(pedida) ? pedida : (visibles[0] ?? null);
}

/**
 * ¿Puede corregir los datos leídos de este documento? Con «Editar», cualquiera;
 * con Subida, solo los que subió él (`subido_por`).
 */
export function puedeCorregirDocumento(p: PermisosFacturas, subidoPor: string | null | undefined, usuarioId: string | null | undefined): boolean {
  if (p.editar) return true;
  return p.subir && !!usuarioId && !!subidoPor && subidoPor === usuarioId;
}
