/**
 * Dónde vive el modelo del recorte («sticker» de las fotos de la carta) y en
 * qué Cache Storage lo guarda el worker. Fichero aparte para que la página
 * (precarga, comprobar si ya está guardado) lo use sin importar el worker ni
 * onnxruntime-web.
 */
export const URL_MODELO = "/modelos/isnet-general-use-u8.onnx";
export const CACHE_MODELO = "modelos-recorte-v1";
