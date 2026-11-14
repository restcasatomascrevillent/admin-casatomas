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
  // «Subir albaranes» (10/11/2026): la única pantalla del tipo de usuario «Albaranes».
  "/albaranes": () => import("@/pages/Albaranes"),
  "/usuarios": () => import("@/pages/Usuarios"),
  "/avisos": () => import("@/pages/Avisos"),
  "/ayuda": () => import("@/pages/Ayuda"),
  // «Nueva petición» (13/11/2026): para todos los usuarios del panel.
  "/peticiones": () => import("@/pages/Peticiones"),
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

// ── Abrir el panel directamente en «Reservas › Hoy» (09/11/2026, mala cobertura) ──────────────────────
// Lo que va a hacer falta se pide en paralelo a la validación de la sesión, en vez de después:
//   1. al arrancar (`App.tsx`, antes de pintar): el fichero de Reservas y el de la precarga de «Hoy»;
//   2. con la sesión confirmada (`App.tsx` › `PrecargaHoy`): las lecturas de «Hoy», todas a la vez
//      (`lib/reservas/precargaHoy.ts`), sin esperar a rol y permisos ni al fichero de la página.

/** ¿La URL es la de «Hoy»? (`/reservas` sin pestaña, o con `?tab=hoy`). */
export function esRutaHoy(pathname: string, search: string): boolean {
  if (pathname.replace(/\/+$/, "") !== "/reservas") return false;
  const tab = new URLSearchParams(search).get("tab");
  return !tab || tab === "hoy";
}

type ModuloPrecargaHoy = typeof import("@/lib/reservas/precargaHoy");
let moduloPrecargaHoy: Promise<ModuloPrecargaHoy> | null = null;

/** Paso 1. Llamar al arrancar: si la URL es «Hoy», empieza a bajar los ficheros. Devuelve si lo es. */
export function prepararArranqueEnHoy(ubicacion: Pick<Location, "pathname" | "search"> = window.location): boolean {
  if (!esRutaHoy(ubicacion.pathname, ubicacion.search)) return false;
  // Primero el fichero pequeño de la precarga (las lecturas salen en cuanto haya sesión) y después el de la
  // página, que es grande: con poca cobertura, si van a la vez, el pequeño queda a la cola del grande.
  const modulo = import("@/lib/reservas/precargaHoy");
  moduloPrecargaHoy = modulo;
  modulo.then(
    () => precargarSeccion("/reservas"),
    () => {
      if (moduloPrecargaHoy === modulo) moduloPrecargaHoy = null;
      precargarSeccion("/reservas");
    },
  );
  return true;
}

/**
 * Paso 2. Con la sesión confirmada: lanza las lecturas de «Hoy» UNA vez (solo si se arrancó en «Hoy» y
 * se sigue ahí). `escritorio`: también los planos de las salas (el móvil no los pinta).
 */
export function lanzarPrecargaHoy(
  qc: import("@tanstack/react-query").QueryClient,
  { escritorio, ubicacion = window.location }: { escritorio: boolean; ubicacion?: Pick<Location, "pathname" | "search"> },
): void {
  const modulo = moduloPrecargaHoy;
  moduloPrecargaHoy = null;
  if (!modulo || !esRutaHoy(ubicacion.pathname, ubicacion.search)) return;
  modulo.then((m) => m.precargarHoy(qc, { escritorio })).catch(() => undefined);
}
