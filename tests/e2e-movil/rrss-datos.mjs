// Datos de RRSS (Facebook y Subida de fotos) para las capturas con el Supabase falso de esta carpeta: trabajos del
// editor IA (rrss_proyectos, rrss_archivos, rrss_generaciones, rrss_resultados), ideas para grabar (rrss_ideas y la
// Edge Function rrss-ia simulada) y los ficheros del cubo privado «rrss» (originales, previas y resultados).
//
// Son datos de muestra: los platos y textos suenan reales, pero no son registros de nadie. Los originales son las
// fotos de public/instagram/reels/muestras. Los RESULTADOS (fotos editadas y el reel) salen del motor real
// (api/_lib/rrss/foto.ts editarFoto + recetaFoto y video.ts montarVideo + recetaVideo) con las piezas que hay aquí
// abajo (PIEZAS_CARRUSEL, PIEZA_REEL) y se pasan en una carpeta (RRSS_DATOS) con:
//   carrusel-0.jpg, carrusel-1.jpg, carrusel-2.jpg  (instagram/carrusel 1080×1350, estilo «elegante», casa-tomas)
//   reel.mp4, reel-portada.jpg                      (instagram/reel 1080×1920, estilo «elegante», casa-tomas)
// Si falta alguno, se usa un recorte simple de la foto original (sharp), para que el script funcione igual.
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { USER_ID } from "./supabase-falso.mjs";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MUESTRAS = path.join(RAIZ, "public/instagram/reels/muestras");

const id = (prefijo, n) => `${prefijo}-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hace = (min) => new Date(Date.now() - min * 60_000).toISOString();

// ── Trabajos ────────────────────────────────────────────────────────────────
export const P_CARRUSEL = id("a0000000", 1);
export const P_REEL = id("a0000000", 2);
const P_STORY = id("a0000000", 3);
const P_TOUZA = id("a0000000", 4);
const P_FB_ALBUM = id("a0000000", 11);
const P_FB_ANIMADA = id("a0000000", 12);
const G_CARRUSEL = id("c0000000", 1);
const G_REEL = id("c0000000", 2);
const G_TOUZA = id("c0000000", 4);
const G_FB_ALBUM = id("c0000000", 11);

const FOTOS_CARRUSEL = [
  { id: id("b0000000", 11), foto: "arroz" },
  { id: id("b0000000", 12), foto: "gambas" },
  { id: id("b0000000", 13), foto: "chuleton" },
];
const FOTOS_REEL = [
  { id: id("b0000000", 21), foto: "chuleton" },
  { id: id("b0000000", 22), foto: "gambas" },
  { id: id("b0000000", 23), foto: "arroz" },
  { id: id("b0000000", 24), foto: "vino-ritus" },
];
const FOTOS_STORY = [{ id: id("b0000000", 31), foto: "vino-ritus" }];

const NEUTRA = { exposicion: 0, contraste: 0, saturacion: 0, temperatura: 0, nitidez: 0 };

/** Las tres piezas del carrusel (las mismas con las que el motor hizo carrusel-N.jpg). */
export const PIEZAS_CARRUSEL = [
  {
    tipo: "foto", archivo: FOTOS_CARRUSEL[0].id, autoNiveles: true, logo: true, creativo: "ninguno",
    correccion: { exposicion: 0.1, contraste: 0.1, saturacion: 0.05, temperatura: 0.05, nitidez: 0.3 },
    encuadre: { x: 0.5, y: 0.62, zoom: 1.15 },
    rotulos: { antetitulo: "Temporada", titulo: "Arroz del señorito", subtitulo: "Con producto de la lonja de Santa Pola", cta: "Reserva", posicion: "abajo" },
    altText: "Paella de hierro con arroz rojo y meloso sobre un mantel mostaza y negro, vista desde arriba.",
    nota: "Abro con el arroz, que es el plato con más color. Subo un poco la luz y cierro el encuadre para que la paella mande; el rótulo va abajo, sobre el mantel.",
  },
  {
    tipo: "foto", archivo: FOTOS_CARRUSEL[1].id, autoNiveles: false, logo: false, creativo: "ninguno",
    correccion: { exposicion: 0.15, contraste: 0.1, saturacion: 0.1, temperatura: 0, nitidez: 0.35 },
    encuadre: { x: 0.5, y: 0.5, zoom: 1.25 },
    rotulos: { antetitulo: "Del mar", titulo: "Gamba roja a la plancha", posicion: "abajo" },
    altText: "Nueve gambas rojas a la plancha en fila sobre una tabla de pizarra con medio limón.",
    nota: "Encuadre más cerrado sobre la tabla para que las gambas llenen el cuadro, y algo más de nitidez para la textura del caparazón.",
  },
  {
    tipo: "foto", archivo: FOTOS_CARRUSEL[2].id, autoNiveles: false, logo: false, creativo: "ninguno",
    correccion: { exposicion: 0.05, contraste: 0.15, saturacion: 0.05, temperatura: 0.1, nitidez: 0.3 },
    encuadre: { x: 0.5, y: 0.6, zoom: 1.2 },
    rotulos: { titulo: "Chuletón a la brasa", cta: "Reserva tu mesa", posicion: "abajo" },
    altText: "Chuletón a la brasa cortado en tiras, rosado por dentro, en una bandeja de piedra.",
    nota: "Cierro con el chuletón y la llamada a reservar. Un poco más de contraste y calidez para que se vea el punto de la carne.",
  },
];

/** El reel (el mismo con el que el motor hizo reel.mp4). */
export const PIEZA_REEL = {
  tipo: "video",
  tomas: [
    { archivo: FOTOS_REEL[0].id, medio: "foto", inicio: 0, fin: 3, encuadre: { x: 0.5, y: 0.55, zoom: 1 }, movimiento: "acercar", motivo: "Abre con la brasa: es lo que más llama la atención." },
    { archivo: FOTOS_REEL[1].id, medio: "foto", inicio: 0, fin: 2.5, encuadre: { x: 0.5, y: 0.5, zoom: 1 }, movimiento: "izquierda", motivo: "El paso al mar, con las gambas en fila." },
    { archivo: FOTOS_REEL[2].id, medio: "foto", inicio: 0, fin: 3, encuadre: { x: 0.5, y: 0.6, zoom: 1 }, movimiento: "alejar", motivo: "El arroz, para compartir." },
    { archivo: FOTOS_REEL[3].id, medio: "foto", inicio: 0, fin: 2.5, encuadre: { x: 0.5, y: 0.45, zoom: 1 }, movimiento: "acercar", motivo: "El vino antes del cierre." },
  ],
  titulos: [
    { texto: "Hoy en Casa Tomás", inicio: 0.2, fin: 2.6, posicion: "abajo" },
    { texto: "De la brasa y de la lonja", inicio: 2.8, fin: 7.6, posicion: "abajo" },
  ],
  subtitulos: false,
  transicion: "fundido",
  duracionTransicion: 0.5,
  audio: "silencio",
  correccion: { exposicion: 0.05, contraste: 0.1, saturacion: 0.05, temperatura: 0.05, nitidez: 0.2 },
  cierre: { mostrar: true, titulo: "Te esperamos", cta: "Reserva tu mesa" },
  logo: true,
  nota: "Montaje con las cuatro fotos en movimiento suave: abre con la brasa, pasa por el mar y cierra con el vino y la invitación a reservar. Sin sonido: pensado para verse sin audio.",
};

const TEXTOS_CARRUSEL = {
  caption:
    "Esta semana, tres platos para compartir sin prisa:\n\n· Arroz del señorito, con producto de la lonja de Santa Pola.\n· Gamba roja a la plancha.\n· Chuletón a la brasa, cortado en la mesa.\n\nTe esperamos en Casa Tomás, en Crevillent. Reserva desde el enlace de la bio o llámanos.",
  hashtags: ["#CasaTomás", "#Crevillent", "#CocinaGallega", "#ArrozDelSeñorito", "#Brasa"],
  titular: "Arroz, gamba roja y brasa",
};
const TEXTOS_REEL = {
  caption: "De la brasa y de la lonja, todo en la misma mesa: chuletón, gamba roja, arroz del señorito y un Ritus Balbás para acompañar.\n\nTe esperamos en Crevillent.",
  hashtags: ["#CasaTomás", "#Crevillent", "#CocinaGallega", "#Brasa"],
  titular: "De la brasa y de la lonja",
};

const plan = (estilo, resumen, piezas, textos) => ({ version: 1, estilo, resumen, preguntas: [], piezas, textos, avisos: [] });
const PLAN_CARRUSEL = plan(
  "elegante",
  "Tres fotos de platos sobre el mantel mostaza y negro del pase. Propongo un carrusel que abre con el arroz, sigue con la gamba roja y cierra con el chuletón y la llamada a reservar. Solo luz, color y encuadre: no se cambia nada de los platos.",
  PIEZAS_CARRUSEL,
  TEXTOS_CARRUSEL,
);
const PLAN_REEL = plan("elegante", "Cuatro fotos de la carta (chuletón, gamba roja, arroz y el Ritus Balbás). Hago un reel de unos 12 s con acercamientos lentos, dos rótulos y un cierre con el logo.", [PIEZA_REEL], TEXTOS_REEL);

const proyecto = (extra) => ({
  marca: "casa-tomas", canal: "instagram", estilo: "elegante", instrucciones: "", permitir_creativo: false, origen: "editor", titulo: "", plan: null, plan_ia: null, textos: {},
  estado: "borrador", creado_por: USER_ID, ...extra, plan_ia: extra.plan ?? null,
});

function proyectos() {
  return [
    proyecto({ id: P_CARRUSEL, tipo: "carrusel", titulo: "Carrusel de temporada: arroz, gamba roja y chuletón", instrucciones: "Que se vea bien el producto, sin cambiar los platos. Empezar por el arroz.", plan: PLAN_CARRUSEL, textos: TEXTOS_CARRUSEL, created_at: hace(70), updated_at: hace(18) }),
    proyecto({ id: P_REEL, tipo: "reel", titulo: "Reel «De la brasa y de la lonja»", plan: PLAN_REEL, textos: TEXTOS_REEL, estado: "listo", created_at: hace(60 * 26), updated_at: hace(60 * 3) }),
    proyecto({ id: P_STORY, tipo: "story", estilo: "natural", titulo: "Story del Ritus Balbás", created_at: hace(60 * 30), updated_at: hace(60 * 28) }),
    proyecto({ id: P_TOUZA, marca: "touza", tipo: "publicacion", estilo: "moderno", titulo: "Barra de TOUZA el viernes", estado: "listo", created_at: hace(60 * 24 * 4), updated_at: hace(60 * 24 * 3) }),
    proyecto({ id: P_FB_ALBUM, canal: "facebook", origen: "facebook", tipo: "carrusel", estilo: "natural", titulo: "Álbum de marisco para Facebook", created_at: hace(60 * 5), updated_at: hace(60 * 4) }),
    proyecto({ id: P_FB_ANIMADA, canal: "facebook", origen: "facebook", tipo: "animada", estilo: "moderno", titulo: "Vídeo cuadrado del chuletón", created_at: hace(60 * 24 * 2), updated_at: hace(60 * 24 * 2) }),
  ];
}

const bytesDe = (foto) => statSync(path.join(MUESTRAS, `${foto}.jpg`)).size;
const archivo = (proyectoId, f, orden) => ({
  id: f.id, proyecto_id: proyectoId, tipo: "foto", ruta: `originales/${proyectoId}/${f.id}.jpg`, nombre: `${f.foto}.jpg`, mime: "image/jpeg", bytes: bytesDe(f.foto),
  ancho: 720, alto: 960, duracion_s: null, orden, estado: "listo", analisis: { previa_ruta: `previas/${proyectoId}/${f.id}.jpg`, hdr: false }, error: null, creado_por: USER_ID, created_at: hace(65),
});
const archivos = () => [
  ...FOTOS_CARRUSEL.map((f, i) => archivo(P_CARRUSEL, f, i)),
  ...FOTOS_REEL.map((f, i) => archivo(P_REEL, f, i)),
  ...FOTOS_STORY.map((f, i) => archivo(P_STORY, f, i)),
];

const generacion = (gid, proyectoId, medio, plan, minutos) => ({
  id: gid, proyecto_id: proyectoId, medio, piezas: null, plan, estado: "listo", progreso: { fraccion: 1, paso: "Terminado" }, avisos: [], error: null, lease_hasta: null, intentos: 1,
  creado_por: USER_ID, created_at: hace(minutos + 2), updated_at: hace(minutos), terminado_at: hace(minutos),
});
const generaciones = () => [
  generacion(G_CARRUSEL, P_CARRUSEL, "foto", PLAN_CARRUSEL, 20),
  generacion(G_REEL, P_REEL, "video", PLAN_REEL, 60 * 3 + 5),
  generacion(G_TOUZA, P_TOUZA, "foto", plan("moderno", "", [], { caption: "", hashtags: [], titular: "" }), 60 * 24 * 3),
  generacion(G_FB_ALBUM, P_FB_ALBUM, "foto", plan("natural", "", [], { caption: "", hashtags: [], titular: "" }), 60 * 4),
];

const resultados = () => [
  // Una versión anterior (no vigente) de la primera foto: el panel solo enseña las vigentes.
  { id: id("d0000000", 10), proyecto_id: P_CARRUSEL, generacion_id: G_CARRUSEL, indice: 0, medio: "foto", ruta: `resultados/${P_CARRUSEL}/${id("c0000000", 99)}/0.jpg`, portada_ruta: null, ancho: 1080, alto: 1350, duracion_s: null, bytes: 300000, receta: {}, avisos: [], vigente: false, created_at: hace(40) },
  ...PIEZAS_CARRUSEL.map((_, i) => ({
    id: id("d0000000", 11 + i), proyecto_id: P_CARRUSEL, generacion_id: G_CARRUSEL, indice: i, medio: "foto", ruta: `resultados/${P_CARRUSEL}/${G_CARRUSEL}/${i}.jpg`, portada_ruta: null,
    ancho: 1080, alto: 1350, duracion_s: null, bytes: 340000, receta: { estilo: "elegante" }, avisos: [], vigente: true, created_at: hace(20),
  })),
  {
    id: id("d0000000", 21), proyecto_id: P_REEL, generacion_id: G_REEL, indice: 0, medio: "video", ruta: `resultados/${P_REEL}/${G_REEL}/0.mp4`, portada_ruta: `resultados/${P_REEL}/${G_REEL}/0-portada.jpg`,
    ancho: 1080, alto: 1920, duracion_s: "11.67", bytes: 4020417, receta: { estilo: "elegante" }, avisos: [], vigente: true, created_at: hace(60 * 3 + 5),
  },
];

// ── Ideas para grabar ───────────────────────────────────────────────────────
export const PETICION_IDEAS = {
  detalle: "El pulpo á feira: que se vea cómo se corta con tijera y se aliña en la tabla.",
  material: "Solo el móvil y la luz de la ventana de la cocina a mediodía.",
};

const IDEAS = [
  {
    titulo: "El corte del pulpo, de la olla a la tabla",
    idea: "Un reel corto que sigue el pulpo desde que sale de la olla hasta que llega a la mesa, cortado con tijera y aliñado delante de la cámara.",
    objetivo: "Dar a conocer el pulpo á feira a quien todavía no lo ha probado.",
    formato: "reel",
    gancho: "Plano cenital: la tijera entra en el pulpo recién sacado de la olla y sale el vapor.",
    guion: ["El pulpo sale de la olla, todavía humeando.", "Se corta con tijera sobre la tabla de madera, rodaja a rodaja.", "Pimentón, sal gorda y un buen chorro de aceite.", "La tabla llega a la mesa y alguien pincha la primera rodaja."],
    planos: [
      { descripcion: "La olla destapada y el pulpo saliendo", duracion_s: 4, orientacion: "vertical", luz: "Ventana a un lado; apaga la luz de la campana", encuadre: "Cenital, con la olla ocupando medio cuadro", movimiento: "Fijo, con el móvil apoyado" },
      { descripcion: "La tijera cortando rodajas sobre la tabla", duracion_s: 5, orientacion: "vertical", luz: "Natural y lateral, que brille la piel", encuadre: "Primer plano a la altura de la tabla", movimiento: "Fijo; repite la toma hasta que caigan bien las rodajas" },
      { descripcion: "Pimentón, sal y aceite cayendo", duracion_s: 5, orientacion: "vertical", luz: "Contraluz suave para que se vea el aceite", encuadre: "Detalle muy cerrado de la tabla", movimiento: "Cámara lenta si el móvil la tiene" },
      { descripcion: "La tabla en la mesa y el primer pincho", duracion_s: 6, orientacion: "vertical", luz: "La del comedor a mediodía, sin flash", encuadre: "Plano medio de la mesa, sin caras", movimiento: "Acercarse despacio a la tabla" },
    ],
    duracion_total_s: 20,
    texto_pantalla: ["Pulpo á feira", "Cortado al momento", "Como en Galicia"],
    voz_en_off: null,
    material: ["El móvil en vertical, con la lente limpia", "Un vaso o un trípode pequeño para apoyarlo", "La tabla de madera y la tijera", "Pimentón, sal gorda y aceite a mano"],
    copy: "El pulpo á feira se corta delante de ti: tijera, pimentón, sal gorda y aceite. Así lo hacemos en Casa Tomás, como en las ferias de Galicia.",
    cta: "Reserva tu mesa desde el enlace de la bio.",
  },
  {
    titulo: "¿Dulce o picante?",
    idea: "Una story en el pase: el pimentón cae sobre el pulpo y se pregunta a los seguidores cómo lo prefieren.",
    objetivo: "Conversar con los seguidores y recordar el plato entre semana.",
    formato: "story",
    gancho: "Primer plano del pimentón cayendo sobre el pulpo, con el rótulo «¿Dulce o picante?».",
    guion: ["El pulpo ya cortado en la tabla.", "Cae el pimentón en primer plano.", "Rótulo con la pregunta y la encuesta de Instagram encima."],
    planos: [
      { descripcion: "El pimentón cayendo sobre las rodajas", duracion_s: 6, orientacion: "vertical", luz: "La del pase, sin flash; que no se vea la sombra del móvil", encuadre: "Detalle cerrado, con la tabla llenando el cuadro", movimiento: "Fijo" },
      { descripcion: "La tabla terminada, con el aceite brillando", duracion_s: 6, orientacion: "vertical", luz: "Ventana o luz de sala", encuadre: "Cenital", movimiento: "Acercarse despacio" },
    ],
    duracion_total_s: 12,
    texto_pantalla: ["¿Dulce o picante?", "Pulpo á feira"],
    voz_en_off: null,
    material: ["El pulpo cocido y cortado", "Pimentón dulce y picante", "Un trapo limpio para la tabla", "La pegatina de encuesta de Instagram al publicarla"],
    copy: "¿Cómo te gusta el pulpo á feira: con pimentón dulce, picante o mitad y mitad?",
    cta: "Vota en la encuesta.",
  },
  {
    titulo: "Tres claves del pulpo á feira",
    idea: "El cocinero cuenta con su voz las tres claves del plato mientras se ven la olla, la tijera y el aliño.",
    objetivo: "Enseñar el oficio de la cocina y dar ganas de probar el plato.",
    formato: "reel",
    gancho: "«Tres cosas que no pueden faltar en un pulpo á feira», sobre el plano de la olla humeando.",
    guion: ["Las manos del cocinero y el delantal, sin cara.", "Clave 1: la cocción (plano de la olla).", "Clave 2: cortarlo con tijera (plano de la tabla).", "Clave 3: pimentón, sal gorda y aceite.", "El plato terminado en la mesa del comedor."],
    planos: [
      { descripcion: "Las manos del cocinero sacando el pulpo de la olla", duracion_s: 6, orientacion: "vertical", luz: "Ventana de la cocina; apaga la campana si hace reflejos", encuadre: "Plano medio de las manos y la olla", movimiento: "Fijo, con el móvil apoyado" },
      { descripcion: "La tijera cortando rodajas", duracion_s: 6, orientacion: "vertical", luz: "Lateral", encuadre: "Primer plano de la tabla", movimiento: "Fijo" },
      { descripcion: "El aliño: pimentón, sal y aceite", duracion_s: 6, orientacion: "vertical", luz: "Contraluz suave", encuadre: "Detalle", movimiento: "Paneo lento de izquierda a derecha" },
      { descripcion: "El plato en la mesa del comedor", duracion_s: 7, orientacion: "vertical", luz: "Luz de sala a mediodía", encuadre: "Plano medio de la mesa puesta", movimiento: "Alejarse despacio" },
    ],
    duracion_total_s: 25,
    texto_pantalla: ["1. La cocción", "2. Con tijera", "3. Pimentón, sal y aceite"],
    voz_en_off: "Tres cosas que no pueden faltar en un pulpo á feira. Una cocción con calma. Cortarlo con tijera, al momento. Y pimentón, sal gorda y un buen aceite. Así lo servimos en Casa Tomás.",
    material: ["El móvil en vertical y algo para apoyarlo", "Los auriculares con micro para grabar la voz en un sitio sin ruido", "El pulpo, la tabla de madera y la tijera", "Un delantal limpio"],
    copy: "Tres claves de nuestro pulpo á feira: cocción con calma, tijera al momento y pimentón, sal gorda y aceite. Cocina gallega en Crevillent.",
    cta: "Ven a probarlo: reserva desde el enlace de la bio.",
  },
];

const ideasAnteriores = () => [
  { id: id("e0000000", 1), marca: "casa-tomas", canal: "instagram", tipo: "reel", objetivo: { que: "vino", detalle: "El Ritus Balbás por copas" }, propuestas: IDEAS.slice(0, 1), modelo: "simulado", guardada: true, creado_por: USER_ID, created_at: hace(60 * 24 * 2) },
  { id: id("e0000000", 2), marca: "touza", canal: "instagram", tipo: null, objetivo: { que: "ambiente", detalle: "La barra de TOUZA un viernes" }, propuestas: IDEAS.slice(1, 2), modelo: "simulado", guardada: false, creado_por: USER_ID, created_at: hace(60 * 24 * 5) },
];

/** Platos de la carta que ofrece «Dame ideas» al elegir «Un plato». */
const platos = () =>
  [["Arroz del señorito", "Arroces"], ["Chuletón de vaca a la brasa", "Carnes"], ["Gamba roja a la plancha", "Del mar"], ["Pulpo á feira", "Del mar"], ["Zamburiñas a la plancha", "Del mar"]].map(([nombre, categoria], i) => ({
    id: id("f0000000", i + 1), nombre, categoria, activado: true, restaurante: true, touza: false, orden: i,
  }));

/** Tablas de RRSS que se añaden a `tablas()` de datos-sinteticos.mjs (y a las de Instagram). */
export const tablasRrss = () => ({
  rrss_proyectos: proyectos(),
  rrss_archivos: archivos(),
  rrss_generaciones: generaciones(),
  rrss_resultados: resultados(),
  rrss_ideas: ideasAnteriores(),
  rrss_ia_peticiones: [],
  Platos: platos(),
});

/** Edge Function rrss-ia simulada: solo «ideas» (el resto de acciones no se usan en las capturas). */
export async function rrssIa(req) {
  let c = {};
  try {
    c = JSON.parse(req.postData() || "{}");
  } catch {
    /* sin cuerpo */
  }
  await new Promise((ok) => setTimeout(ok, 700));
  if (c.accion === "ideas") return { id: id("e0000000", 99), ideas: IDEAS, preguntas: [], avisos: [] };
  return { error: `acción «${c.accion}» no simulada` };
}

// ── Ficheros del cubo «rrss» ────────────────────────────────────────────────

/** Recorte simple (cover) de una muestra, para cuando no hay resultado del motor. */
async function recorte(foto, ancho, alto, dir) {
  const destino = path.join(dir, `${foto}-${ancho}x${alto}.jpg`);
  if (!existsSync(destino)) writeFileSync(destino, await sharp(path.join(MUESTRAS, `${foto}.jpg`)).resize(ancho, alto, { fit: "cover" }).jpeg({ quality: 85 }).toBuffer());
  return destino;
}

/**
 * Ruta del cubo → fichero local. `datos` es la carpeta con los resultados del motor (puede faltar).
 * Devuelve también qué resultados han caído al recorte simple.
 */
export async function ficherosCubo(datos) {
  const tmp = path.join(os.tmpdir(), "rrss-capturas-recortes");
  mkdirSync(tmp, { recursive: true });
  const mapa = {};
  const sustitutos = [];
  const delMotor = async (nombre, foto, ancho, alto) => {
    const f = datos ? path.join(datos, nombre) : null;
    if (f && existsSync(f)) return f;
    sustitutos.push(nombre);
    return foto ? recorte(foto, ancho, alto, tmp) : null;
  };
  for (const [proyectoId, fotos] of [[P_CARRUSEL, FOTOS_CARRUSEL], [P_REEL, FOTOS_REEL], [P_STORY, FOTOS_STORY]]) {
    for (const f of fotos) {
      const original = path.join(MUESTRAS, `${f.foto}.jpg`);
      mapa[`originales/${proyectoId}/${f.id}.jpg`] = original;
      mapa[`previas/${proyectoId}/${f.id}.jpg`] = original;
    }
  }
  for (let i = 0; i < FOTOS_CARRUSEL.length; i++) mapa[`resultados/${P_CARRUSEL}/${G_CARRUSEL}/${i}.jpg`] = await delMotor(`carrusel-${i}.jpg`, FOTOS_CARRUSEL[i].foto, 1080, 1350);
  mapa[`resultados/${P_REEL}/${G_REEL}/0-portada.jpg`] = await delMotor("reel-portada.jpg", "chuleton", 1080, 1920);
  const video = await delMotor("reel.mp4", null);
  if (video) mapa[`resultados/${P_REEL}/${G_REEL}/0.mp4`] = video;
  return { mapa, sustitutos };
}
