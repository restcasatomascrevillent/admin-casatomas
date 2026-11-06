// Datos sintéticos de /instagram para las capturas (tablet y móvil) con el Supabase falso de esta carpeta.
// Todo lleva «SIM»: nada es real. Lo usan instagram-tablet.capturas.mjs e instagram-movil.capturas.mjs.
import { USER_ID } from "./supabase-falso.mjs";
import { rpcSinteticas, funcionesSinteticas } from "./datos-sinteticos.mjs";

const URL_SUPABASE = process.env.E2E_SUPABASE_URL ?? "https://e2e-falso.supabase.co";

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hoy = new Date();
const dia = (delta, hora = 12) => { const d = new Date(hoy); d.setUTCDate(d.getUTCDate() + delta); d.setUTCHours(hora - 1, 0, 0, 0); return d.toISOString(); };
const fecha = (delta) => dia(delta).slice(0, 10);
const ahora = hoy.toISOString();

const PIEZA = { formato: "post", plantilla: "ct-foto-titular", imagen_ruta: null, imagen_borrada_at: null, caption: "", alt_text: "", contenedor_id: null, permalink: null, media_id: null, tipo_medio: "imagen", error: null, created_at: ahora, updated_at: ahora };
export function piezas() {
  return [
    { ...PIEZA, id: uuid(501), marca: "casa-tomas", estado: "publicada", datos: { titular: "SIM Pulpo a feira" }, publicada_at: dia(-2), permalink: "https://www.instagram.com/p/SIM/" },
    { ...PIEZA, id: uuid(502), marca: "casa-tomas", estado: "prueba_ok", datos: { titular: "SIM Cocido de los viernes" }, publicada_at: null },
    { ...PIEZA, id: uuid(503), marca: "touza", plantilla: "tz-foto-titular", estado: "prueba_ok", datos: { titular: "SIM Noche de cócteles en la barra" }, publicada_at: null },
    { ...PIEZA, id: uuid(504), marca: "casa-tomas", estado: "borrador", datos: { titular: "SIM Revuelto de boletus" }, fecha_prevista: dia(5, 13), publicada_at: null },
    { ...PIEZA, id: uuid(505), marca: "casa-tomas", formato: "story", estado: "borrador", datos: { titular: "SIM Setas de temporada" }, fecha_prevista: dia(9, 20), publicada_at: null },
    { ...PIEZA, id: uuid(506), marca: "casa-tomas", plantilla: "del-mar", tipo_medio: "reel", estado: "generada", datos: {}, publicada_at: null },
  ];
}
export const programaciones = () => [
  { id: uuid(601), pieza_id: uuid(502), instagram_pieza_id: uuid(502), marca: "casa-tomas", programada_para: dia(1, 13), estado: "programada", intentos: 0, ultimo_error: null, siguiente_intento_at: dia(1, 13), created_at: ahora, updated_at: ahora },
  { id: uuid(602), pieza_id: uuid(503), instagram_pieza_id: uuid(503), marca: "touza", programada_para: dia(2, 21), estado: "programada", intentos: 0, ultimo_error: null, siguiente_intento_at: dia(2, 21), created_at: ahora, updated_at: ahora },
  { id: uuid(603), pieza_id: uuid(501), instagram_pieza_id: uuid(501), marca: "casa-tomas", programada_para: dia(3, 13), estado: "error", intentos: 3, ultimo_error: '{"error":{"message":"(#9004) Media download has failed.","code":9004}}', siguiente_intento_at: dia(3, 13), created_at: ahora, updated_at: ahora },
];
const encargo = (n, extra) => ({ id: uuid(700 + n), numero: n, modo: "oficiosos", formato: "reel", marca: "casa-tomas", idea: "SIM", estilo: null, plantilla: null, base_reel: "del-mar", texto: null, fecha_entrega_prevista: fecha(4), fecha_entrega: null, rondas_cambios: 0, rondas_incluidas: 2, motivo: null, pieza_id: null, creado_por: USER_ID, asignado_a: null, enviado_at: ahora, entregado_at: null, aprobado_at: null, created_at: ahora, updated_at: ahora, ...extra });
export const encargos = () => [
  encargo(31, { titulo: "SIM Foto del revuelto de boletus", formato: "post", estado: "enviado", fecha_deseada: fecha(4) }),
  encargo(32, { titulo: "SIM Vídeo «De la cesta al plato»", estado: "para_revisar", fecha_deseada: fecha(8) }),
  encargo(33, { titulo: "SIM Story de la barra de Touza", marca: "touza", formato: "story", modo: "automatico", estado: "en_curso", fecha_deseada: fecha(6) }),
  encargo(34, { titulo: "SIM Carrusel de vinos de Ribeira", formato: "post", estado: "aprobado", fecha_deseada: fecha(2) }),
  encargo(35, { titulo: "SIM Reel del mar", estado: "publicado", fecha_deseada: fecha(-3) }),
];
const piezaCampana = (n, extra) => ({ fecha: fecha(3 + n * 3), hora: "13:00", formato: "post", plantilla: "ct-foto-titular", platoId: null, plato: null, foto: "drive:1FotoSalonDrive000000001", faltaFoto: false, antetitulo: "", titular: `SIM Pieza ${n + 1}`, gancho: "", caption: "SIM", hashtags: [], altText: "", porQue: "SIM: los platos en primer plano funcionan mejor.", fase: n < 2 ? 0 : 1, encargoSugerido: "", avisos: [], ...extra });
export const campanas = () => [
  { id: uuid(801), marca: "casa-tomas", titulo: "SIM Temporada de setas", objetivo: "Llenar los mediodías", publico: "Familias", mensaje: "El otoño llega a la mesa", razonamiento: "SIM", peticion: "setas", desde: fecha(2), hasta: fecha(22), estado: "propuesta", piezas_aceptadas: null, created_at: ahora,
    propuesta: { titulo: "SIM Temporada de setas", objetivo: "Llenar los mediodías", publico: "Familias", mensaje: "El otoño llega a la mesa", razonamiento: "SIM", desde: fecha(2), hasta: fecha(22), fases: [{ nombre: "Anuncio", desde: fecha(2), hasta: fecha(8) }, { nombre: "Plato a plato", desde: fecha(9), hasta: fecha(22) }],
      piezas: [piezaCampana(0), piezaCampana(1, { foto: null, faltaFoto: true, titular: "SIM Revuelto de boletus", plato: { id: "boletus", nombre: "Revuelto de boletus" }, platoId: "boletus" }), piezaCampana(2), piezaCampana(3, { formato: "story" })] } },
  { id: uuid(802), marca: "touza", titulo: "SIM Cócteles de otoño", objetivo: "", publico: "", mensaje: "", razonamiento: "", peticion: null, desde: fecha(1), hasta: fecha(15), estado: "aceptada", piezas_aceptadas: [0], created_at: ahora,
    propuesta: { titulo: "SIM Cócteles de otoño", objetivo: "", publico: "", mensaje: "", razonamiento: "", desde: fecha(1), hasta: fecha(15), fases: [], piezas: [piezaCampana(0, { plantilla: "tz-foto-titular" })] } },
];

const c = (actual, anterior, variacion) => ({ actual, anterior, variacion });
const resumen = (dias, f) => ({ dias, desde: fecha(-dias), hasta: fecha(-1), diasConDatos: dias, diasConDatosAnterior: dias, metricas: { alcance: c(18420 * f, 16400 * f, 12), visualizaciones: c(40210 * f, 39000 * f, 3), interacciones: c(1236 * f, 1144 * f, 8), cuentasInteraccion: c(640 * f, 600 * f, 6.7), visitasPerfil: c(310, 290, 6.9), toquesEnlaces: c(42, 50, -16), seguidores: { ...c(2140, 1998, -4), cambio: 142 } } });
export const metricas = () => ({
  ok: true, igUserId: "1", cuentas: [{ igUserId: "1", marcas: ["casa-tomas", "touza"] }], hoy: fecha(0), ultimoDia: fecha(-1),
  resumen: { d7: resumen(7, 0.25), d28: resumen(28, 1) },
  serie: Array.from({ length: 28 }, (_, i) => ({ fecha: fecha(i - 28), alcance: 500 + ((i * 37) % 300) + i * 12, seguidores: 2000 + i * 5, visualizaciones: 1200 + i * 20, interacciones: 30 + ((i * 7) % 25) })),
  publicaciones: [], ultimaCaptura: { inicio: ahora, fin: ahora, ok: true, origen: "cron", errorTipo: null, error: null, avisos: [] }, ultimaCorrecta: null,
  queFunciona: { periodo_dias: 90, minimo: 3, publicaciones: 30, tasa_media: 4.1, suficiente: true, aviso: null, por: {}, mejores: [], peores: [],
    conclusiones: [{ eje: "dia", estado: "mejor", clave: "jueves", texto: "" }, { eje: "franja", estado: "mejor", clave: "12-14", texto: "" }] },
});
export const FOTOS_DRIVE = [
  { driveId: "1FotoSalonDrive000000001", nombre: "salon.jpg", ancho: 1080, alto: 1350, tipo: "sala", descripcion: "SIM Salón", filaId: "f1", creada: null, problema: null },
  { driveId: "1FotoVinoDrive0000000002", nombre: "vino.jpg", ancho: 1080, alto: 1350, tipo: "bebida", descripcion: "SIM Vino", filaId: "f2", creada: null, problema: null },
];
export const funciones = {
  ...funcionesSinteticas,
  "instagram-estado": () => ({ ok: true, identidad: { igUserId: "1", username: "oficiososia" }, cuentasPorMarca: [], cuota: { usadas: 3, total: 100, ventanaHoras: 24 }, variables: [], comprobaciones: [], avisos: [] }),
  "instagram-metricas": () => metricas(),
  "instagram-drive": (req) => {
    let cuerpo = {}; try { cuerpo = JSON.parse(req.postData() || "{}"); } catch { /* GET */ }
    if (cuerpo.accion === "listar") return { ok: true, marca: cuerpo.marca, alcance: "completo", avisos: [], fotos: cuerpo.marca === "casa-tomas" ? FOTOS_DRIVE : [] };
    if (cuerpo.accion === "preparar") return { ok: true, ruta: "tmp/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg", url: `${URL_SUPABASE}/storage/v1/object/public/instagram/tmp/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d.jpg`, ancho: 1080, alto: 1350 };
    return { ok: true };
  },
};
export const rpc = { ...rpcSinteticas, marketing_fechas_entre: () => [{ titulo: "SIM San Martín y la matanza", desde: fecha(3), hasta: fecha(3), verificacion: "verificada" }] };

/** Las tablas de Instagram que se añaden a `tablas()` de datos-sinteticos.mjs. */
export const tablasInstagram = () => ({ instagram_piezas: piezas(), instagram_programaciones: programaciones(), instagram_encargos: encargos(), instagram_campanas: campanas(), instagram_encargos_ajustes: [{ plazo_dias_laborables: 5, rondas_incluidas: 2, cupo_mensual: null }], instagram_trabajos_render: [], Platos: [] });
