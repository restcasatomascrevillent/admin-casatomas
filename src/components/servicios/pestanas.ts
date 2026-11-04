/**
 * Pestañas de Super Admin › Servicios (sin React: lo importa App.tsx para la
 * redirección de la ruta vieja sin cargar la página).
 *
 *   Resumen     lo esencial de un vistazo (por defecto, sin `?tab=`)
 *   Servicios   una tarjeta por servicio en uso con su consumo
 *   Costes      coste del mes por proveedor y la IA por proceso (antes «Costes»)
 *   Configurar  añadir, quitar, borrar y editar servicios; tipo de cambio
 */
export const RUTA_SERVICIOS = "/super-admin/servicios";

export const PESTANAS_SERVICIOS = ["resumen", "servicios", "costes", "configurar"] as const;
export type PestanaServicios = (typeof PESTANAS_SERVICIOS)[number];

export const PESTANA_POR_DEFECTO: PestanaServicios = "resumen";

export const pestanaDeUrl = (v: string | null): PestanaServicios =>
  (PESTANAS_SERVICIOS as readonly string[]).includes(v ?? "") ? (v as PestanaServicios) : PESTANA_POR_DEFECTO;

/** «/super-admin/servicios?tab=costes» (la pestaña por defecto va sin `?tab=`). */
export const rutaServicios = (pestana: PestanaServicios = PESTANA_POR_DEFECTO): string =>
  pestana === PESTANA_POR_DEFECTO ? RUTA_SERVICIOS : `${RUTA_SERVICIOS}?tab=${pestana}`;
