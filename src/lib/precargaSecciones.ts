/**
 * Ficheros de las secciones del menú (07/11/2026). `App.tsx` los usa con `lazy()` y el menú lateral los pide al
 * pasar el ratón o el dedo por el enlace (`precargarSeccion`), así que al pulsar la sección suele estar ya bajada.
 * `import()` repetido devuelve el mismo módulo: precargar dos veces no baja nada de más.
 */
export const CARGADORES_SECCION = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/reservas": () => import("@/pages/Reservas"),
  "/gestion-web": () => import("@/pages/GestorWeb"),
  "/marketing": () => import("@/pages/Marketing"),
  // RRSS (08/11/2026): antes «/instagram», que ahora redirige aquí.
  "/rrss": () => import("@/pages/RRSS"),
  "/cheques": () => import("@/pages/Cheques"),
  "/tienda": () => import("@/pages/Tienda"),
  "/facturas": () => import("@/pages/Facturas"),
  "/analisis": () => import("@/pages/AnalisisGeneral"),
  "/usuarios": () => import("@/pages/Usuarios"),
  "/avisos": () => import("@/pages/Avisos"),
  "/ayuda": () => import("@/pages/Ayuda"),
} as const;

const yaPedidas = new Set<string>();

/** Empieza a bajar el fichero de la sección de `url` (sin `?query`). Los fallos se ignoran: al entrar se reintenta. */
export function precargarSeccion(url: string) {
  const ruta = url.split(/[?#]/)[0] as keyof typeof CARGADORES_SECCION;
  const cargar = CARGADORES_SECCION[ruta];
  if (!cargar || yaPedidas.has(ruta)) return;
  yaPedidas.add(ruta);
  cargar().catch(() => yaPedidas.delete(ruta));
}
