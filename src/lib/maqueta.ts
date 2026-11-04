import { VERSION_APP, type VersionApp } from "@/lib/version";

/**
 * Maquetas: pantallas que el dueño quiere ver en la demo antes de decidir si
 * van a producción (03/11/2026: la Tienda «queda como maqueta solo en la
 * demo»). Existen en la demo, en los preview y en local; en producción ni
 * salen en el menú ni tienen ruta (caen en el 404) ni aparecen en la tabla de
 * permisos de Usuarios. En pantalla no llevan aviso ni insignia de «Maqueta»
 * (dueño, 04/11/2026). El entorno es el mismo que enseña `VersionPanel`
 * (lo calcula `scripts/version.mjs` al compilar).
 */
export const maquetaVisibleEn = (entorno: VersionApp["entorno"]): boolean => entorno !== "produccion";

/** ¿Se ven las maquetas en este panel? Se lee al usarla (los tests cambian el entorno). */
export const maquetasVisibles = (): boolean => maquetaVisibleEn(VERSION_APP.entorno);
