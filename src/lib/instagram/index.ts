/**
 * Núcleo isomórfico de la sección Instagram (plantillas, validación, HTML y
 * comprobaciones de maquetación). Funciona en el navegador y en las funciones
 * de Vercel: sin fs, sin imports dinámicos, sin APIs de Node.
 */
export * from "./tipos.js";
export * from "./tokens.js";
export * from "./recursos.js";
export * from "./fotos.js";
export * from "./esquema.js";
export * from "./documento.js";
export * from "./maquetacion.js";
export * from "./ejemplos.js";
export {
  PLANTILLAS,
  esClasica,
  obtenerPlantilla,
  plantillaEnmarcada,
  plantillaPara,
  plantillasDe,
  plantillasVisibles,
  problemasDePlantilla,
  varianteConEncaje,
} from "./plantillas/index.js";
