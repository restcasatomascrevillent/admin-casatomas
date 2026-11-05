/**
 * Las 5 bases de reel: los REEL_CONFIG y OM_SCENES de los «Reel 0X *.dc.html»
 * de marca-base, pasados al esquema ReelPieza (son VALORES INICIALES: el
 * editor los copia y se cambian fotos, textos y duraciones).
 *
 * Equivalencias con REEL_CONFIG: cue → nombre, dur → duracion_s, desc → nota,
 * img → foto («muestra:<img>»), pos/o/z/px/py/pan → encuadre, tr → transicion,
 * text.style/eyebrow/title/sub/align/size → rotulo, closing.line/lineSize/cta/
 * info → cierre (info sale de DATOS_MARCA_REEL), tr/textOut → transicion_s /
 * salidaRotulo_s.
 *
 * El Reel 01 «Bienvenido» (que tenía su propio reel-bienvenido.jsx) queda
 * pasado al mismo kit: cada uno de sus rótulos a mano es ahora un estilo
 * (IntroText → intro, SalaText → mask, GaliciaText → box, VitrinaText →
 * letters, MesaText → pill, BarraText → number) con sus textos y tamaños.
 */
import { DATOS_MARCA_REEL, type MarcaReel } from "./marca.js";
import { idMuestra } from "./fotos.js";
import type { BaseReel, EscenaReel, ReelPieza } from "./esquema.js";

const m = idMuestra;

const BIENVENIDO: ReelPieza = {
  marca: "casa-tomas",
  base: "bienvenido",
  salidaRotulo_s: 0.5,
  escenas: [
    {
      id: "intro",
      nombre: "Intro",
      nota: "La lámpara dorada y el logo de Casa Tomás aparecen",
      duracion_s: 3,
      foto: m("lampara"),
      encuadre: { pos: "50% 35%", zoom: [1.2, 1.05] },
      rotulo: { estilo: "intro", antetitulo: "Crevillent · desde 1998" },
    },
    {
      id: "sala",
      nombre: "Sala",
      nota: "Sala principal con el titular de bienvenida",
      duracion_s: 4,
      foto: m("sala"),
      encuadre: { pos: "40% 60%", zoom: [1.02, 1.12] },
      transicion: "zoom",
      rotulo: { estilo: "mask", titulo: "Bienvenidos", sub: "a Casa Tomás" },
    },
    {
      id: "galicia",
      nombre: "Galicia",
      nota: "Platos gallegos en la pared azul",
      duracion_s: 3,
      foto: m("platos-pared"),
      encuadre: { pos: "50% 50%", zoom: [1.28, 1.12] },
      transicion: "wipe",
      rotulo: { estilo: "box", antetitulo: "Nuestras raíces", titulo: "Galicia", sub: "en cada rincón", tamano: 1.1 },
    },
    {
      id: "vitrina",
      nombre: "Vitrina",
      nota: "Paneo por la vitrina de figuras gallegas",
      duracion_s: 3,
      foto: m("vitrina-gallega"),
      encuadre: { pos: "35% 40%", zoom: [1.14, 1.2], desplazamientoX: [60, -60] },
      transicion: "push",
      rotulo: { estilo: "letters", titulo: "Recuerdos de nuestra tierra", tamano: 0.82 },
    },
    {
      id: "mesa",
      nombre: "Mesa",
      nota: "Mesa puesta: Tu mesa te espera",
      duracion_s: 3,
      foto: m("mesa-copas"),
      encuadre: { pos: "50% 60%", zoom: [1.14, 1.02] },
      transicion: "iris",
      rotulo: { estilo: "pill", antetitulo: "Cocina tradicional", titulo: "Tu mesa", sub: "te espera" },
    },
    {
      id: "barra",
      nombre: "Barra",
      nota: "La barra con el nudo y el año 1998 en grande",
      duracion_s: 3,
      foto: m("barra-logo"),
      encuadre: { pos: "62% 70%", zoom: [1.0, 1.1] },
      transicion: "flash",
      rotulo: { estilo: "number", antetitulo: "Desde", titulo: "1998", sub: "de padres a hijos" },
    },
  ],
  cierre: {
    duracion_s: 5,
    foto: m("postre-nudo"),
    encuadre: { pos: "50% 45%", origen: "50% 42%", zoom: [1.3, 1.4] },
    transicion: "blur",
    frase: "Nunca é longo o camiño que conduce á casa dun amigo.",
    cta: "Reservar mesa",
  },
};

const DEL_MAR: ReelPieza = {
  marca: "casa-tomas",
  base: "del-mar",
  escenas: [
    {
      id: "gancho",
      nombre: "Gancho",
      nota: "Gambas en tabla y la pregunta ¿Cuál te pides?",
      duracion_s: 3,
      foto: m("gambas"),
      encuadre: { pos: "45% 45%", origen: "50% 44%", zoom: [1.7, 1.55] },
      rotulo: { estilo: "hook", antetitulo: "Del mar a la mesa", titulo: "¿Cuál te pides?" },
    },
    {
      id: "ostras",
      nombre: "Ostras",
      nota: "Ostras sobre hielo con rótulo inferior",
      duracion_s: 3,
      foto: m("ostras"),
      encuadre: { pos: "50% 55%", origen: "50% 52%", zoom: [1.6, 1.45] },
      transicion: "zoom",
      rotulo: { estilo: "label", antetitulo: "Recién abiertas", titulo: "Ostras", sub: "Sobre hielo, con limón" },
    },
    {
      id: "bogavante",
      nombre: "Bogavante",
      nota: "Caldoso de bogavante con titular grande",
      duracion_s: 3.5,
      foto: m("bogavante"),
      encuadre: { pos: "50% 50%", origen: "50% 52%", zoom: [1.55, 1.7] },
      transicion: "wipe",
      rotulo: { estilo: "mask", titulo: "Bogavante", sub: "en caldoso" },
    },
    {
      id: "atun",
      nombre: "Atún",
      nota: "Tartar de atún rojo en plato de cristal",
      duracion_s: 3,
      foto: m("tartar-atun"),
      encuadre: { pos: "50% 55%", origen: "50% 48%", zoom: [1.75, 1.6], desplazamientoX: [30, -30] },
      transicion: "iris",
      rotulo: { estilo: "pill", antetitulo: "Atún rojo", titulo: "Tartar", sub: "de la casa", alinear: "izquierda" },
    },
    {
      id: "salazones",
      nombre: "Salazones",
      nota: "Plato de salazones, texto letra a letra",
      duracion_s: 3,
      foto: m("salazones"),
      encuadre: { pos: "50% 55%", origen: "50% 52%", zoom: [1.35, 1.45] },
      transicion: "push",
      rotulo: { estilo: "letters", antetitulo: "Salazones", titulo: "Sabor a puerto" },
    },
  ],
  cierre: {
    duracion_s: 5,
    foto: m("arroz"),
    encuadre: { pos: "50% 55%", origen: "50% 52%", zoom: [1.6, 1.72] },
    transicion: "blur",
    frase: "El mar llega cada día a Casa Tomás.",
    cta: "Reservar mesa",
  },
};

const BODEGA: ReelPieza = {
  marca: "casa-tomas",
  base: "bodega",
  escenas: [
    {
      id: "vinoteca",
      nombre: "Vinoteca",
      nota: "Vinoteca iluminada: Elige tu Ribera",
      duracion_s: 3.5,
      foto: m("vinoteca-mesa"),
      encuadre: { pos: "35% 40%", zoom: [1.2, 1.05] },
      rotulo: { estilo: "box", antetitulo: "Nuestra bodega", titulo: "Elige", sub: "tu Ribera" },
    },
    {
      id: "aalto",
      nombre: "Aalto",
      nota: "Botella Aalto 2021 con ficha",
      duracion_s: 3,
      foto: m("vino-aalto"),
      encuadre: { pos: "50% 45%", zoom: [1.1, 1.22] },
      transicion: "glass",
      rotulo: { estilo: "label", antetitulo: "Ribera del Duero", titulo: "Aalto", sub: "Cosecha 2021" },
    },
    {
      id: "pidio",
      nombre: "Pidio",
      nota: "Dominio del Pidio 2021",
      duracion_s: 3,
      foto: m("vino-pidio"),
      encuadre: { pos: "50% 45%", zoom: [1.22, 1.1] },
      transicion: "rise",
      rotulo: { estilo: "label", antetitulo: "Ribera del Duero", titulo: "Dominio del Pidio", sub: "Cosecha 2021", tamano: 0.8 },
    },
    {
      id: "ritus",
      nombre: "Ritus",
      nota: "Ritus 940, viñedo en altitud",
      duracion_s: 3,
      foto: m("vino-ritus"),
      encuadre: { pos: "50% 50%", zoom: [1.1, 1.22] },
      transicion: "dissolve",
      rotulo: { estilo: "number", antetitulo: "Ritus · viñedo en altitud", titulo: "940", sub: "metros de altura" },
    },
    {
      id: "calogia",
      nombre: "Calogía",
      nota: "Dominio de Calogía 2020",
      duracion_s: 3,
      foto: m("vino-calogia"),
      encuadre: { pos: "50% 50%", zoom: [1.2, 1.08] },
      transicion: "flash",
      rotulo: { estilo: "label", antetitulo: "Ribera del Duero", titulo: "Dominio de Calogía", sub: "Cosecha 2020", tamano: 0.8 },
    },
  ],
  cierre: {
    duracion_s: 5,
    foto: m("mesa-copas"),
    encuadre: { pos: "50% 60%", zoom: [1.08, 1.18] },
    transicion: "blur",
    frase: "Pregúntanos por la carta de vinos.",
    cta: "Reservar mesa",
  },
};

const BRASA: ReelPieza = {
  marca: "casa-tomas",
  base: "brasa",
  escenas: [
    {
      id: "chuleton",
      nombre: "Chuletón",
      nota: "Chuletón cortado: Brasa",
      duracion_s: 3.5,
      foto: m("chuleton"),
      encuadre: { pos: "50% 55%", origen: "50% 50%", zoom: [1.9, 1.7] },
      rotulo: { estilo: "hook", antetitulo: "Brasa y tierra", titulo: "Fuego lento", sub: "producto sin atajos", tamano: 0.9 },
    },
    {
      id: "cecina",
      nombre: "Cecina",
      nota: "Cecina en flor con rótulo",
      duracion_s: 3,
      foto: m("cecina"),
      encuadre: { pos: "50% 55%", origen: "50% 56%", zoom: [1.45, 1.58] },
      transicion: "iris",
      rotulo: { estilo: "label", antetitulo: "Curada", titulo: "Cecina", sub: "Corte fino, a mano" },
    },
    {
      id: "tartar",
      nombre: "Tartar",
      nota: "Steak tartar con tostas",
      duracion_s: 3,
      foto: m("steak-tartar"),
      encuadre: { pos: "45% 55%", origen: "45% 56%", zoom: [1.75, 1.6], desplazamientoX: [-30, 30] },
      transicion: "push",
      rotulo: { estilo: "pill", antetitulo: "Al momento", titulo: "Steak", sub: "tartar" },
    },
    {
      id: "guiso",
      nombre: "Guiso",
      nota: "Carne con patatas y pimientos",
      duracion_s: 3,
      foto: m("carne-guiso"),
      encuadre: { pos: "50% 55%", origen: "50% 55%", zoom: [1.4, 1.52] },
      transicion: "zoom",
      rotulo: { estilo: "letters", titulo: "Como en casa" },
    },
    {
      id: "alcachofas",
      nombre: "Alcachofas",
      nota: "Alcachofas fritas sobre fondo oro",
      duracion_s: 3,
      foto: m("alcachofas"),
      encuadre: { pos: "50% 50%", origen: "50% 50%", zoom: [1.3, 1.42] },
      transicion: "wipe",
      rotulo: { estilo: "mask", titulo: "Alcachofas", sub: "fritas, con sal en escamas", tamano: 0.85 },
    },
  ],
  cierre: {
    duracion_s: 5,
    foto: m("postre-nudo"),
    encuadre: { pos: "50% 45%", origen: "50% 42%", zoom: [1.3, 1.4] },
    transicion: "blur",
    frase: "Y de postre, el nudo de la casa.",
    cta: "Reservar mesa",
  },
};

const TOUZA: ReelPieza = {
  marca: "touza",
  base: "touza",
  transicion_s: { entrada: 1.3, salida: 1.5 },
  salidaRotulo_s: 1.0,
  escenas: [
    {
      id: "noche",
      nombre: "Noche",
      nota: "Barra en penumbra, marco dorado que se dibuja y TOUZA aparece",
      duracion_s: 4.5,
      foto: m("touza-barra"),
      encuadre: { pos: "50% 40%", zoom: [1.25, 1.08] },
      rotulo: { estilo: "intro", antetitulo: "Cocktail bar" },
    },
    {
      id: "alquimia",
      nombre: "Alquimia",
      nota: "El bartender cuela el cóctel: Alquimia",
      duracion_s: 4.5,
      foto: m("web-touza-5"),
      encuadre: { pos: "50% 50%", origen: "45% 45%", zoom: [1.12, 1.0] },
      transicion: "dissolve",
      rotulo: { estilo: "mask", titulo: "Alquimia", sub: "en cada copa" },
    },
    {
      id: "copa",
      nombre: "Copa",
      nota: "Primer plano del highball con hielo, frase letra a letra",
      duracion_s: 4,
      foto: m("web-touza-7"),
      encuadre: { pos: "55% 50%", zoom: [1.0, 1.12] },
      transicion: "dissolve",
      rotulo: { estilo: "letters", titulo: "Cada cóctel cuenta una historia", tamano: 1 },
    },
    {
      id: "champagne",
      nombre: "Champagne",
      nota: "Tres botellas y una copa: champagne para brindar",
      duracion_s: 4.5,
      foto: m("web-touza-8-1"),
      encuadre: { pos: "50% 60%", zoom: [1.08, 1.0], desplazamientoY: [40, -40] },
      transicion: "rise",
      rotulo: { estilo: "label", antetitulo: "Champagne", titulo: "Brindar", sub: "sin mirar el reloj" },
    },
    {
      id: "botellas",
      nombre: "Botellas",
      nota: "Aperitivos y licores en la barra",
      duracion_s: 4,
      foto: m("web-touza-10"),
      encuadre: { pos: "50% 50%", zoom: [1.0, 1.1], desplazamientoX: [-30, 30] },
      transicion: "dissolve",
      rotulo: { estilo: "letters", titulo: "Raíces gallegas, alma mediterránea", tamano: 0.9 },
    },
    {
      id: "sala",
      nombre: "Sala",
      nota: "Paneo lento por la sala de sillones amarillos",
      duracion_s: 5,
      foto: m("web-touza-2"),
      encuadre: { pos: "50% 50%", zoom: [1.05, 1.05], paneo: [15, 70] },
      transicion: "dissolve",
      rotulo: { estilo: "box", antetitulo: "Nuestro espacio", titulo: "Quédate", sub: "un rato más", tamano: 0.95 },
    },
  ],
  cierre: {
    duracion_s: 5.5,
    foto: m("touza-barra"),
    encuadre: { pos: "50% 30%", zoom: [1.3, 1.42] },
    transicion: "blur",
    frase: "Jueves a sábado · 20:00 – 02:00",
    tamanoFrase: 48,
    cta: "Reservar",
  },
};

/** Reel en blanco para empezar de cero (base «libre»). */
function libre(marca: MarcaReel): ReelPieza {
  return {
    marca,
    base: "libre",
    ...(marca === "touza" ? { transicion_s: { entrada: 1.3, salida: 1.5 }, salidaRotulo_s: 1.0 } : {}),
    escenas: [
      {
        id: "e1",
        nombre: "Intro",
        duracion_s: 3,
        encuadre: { pos: "50% 50%", zoom: [1.15, 1.05] },
        rotulo: { estilo: "intro", antetitulo: marca === "touza" ? "Cocktail bar" : "Crevillent · desde 1998" },
      },
      {
        id: "e2",
        nombre: "Plano 1",
        duracion_s: 3.5,
        encuadre: { pos: "50% 50%", zoom: [1.05, 1.15] },
        transicion: "dissolve",
        rotulo: { estilo: "label", antetitulo: "Antetítulo", titulo: "Título", sub: "Detalle" },
      },
    ],
    cierre: {
      duracion_s: 5,
      encuadre: { pos: "50% 50%", zoom: [1.1, 1.2] },
      transicion: "blur",
      frase: DATOS_MARCA_REEL[marca].lema ?? "Te esperamos.",
      cta: marca === "touza" ? "Reservar" : "Reservar mesa",
    },
  };
}

export const BASES: Readonly<Record<Exclude<BaseReel, "libre">, ReelPieza>> = {
  bienvenido: BIENVENIDO,
  "del-mar": DEL_MAR,
  bodega: BODEGA,
  brasa: BRASA,
  touza: TOUZA,
};

/** Nombre y marca de cada base (para el selector). */
export const INFO_BASES: ReadonlyArray<{ id: BaseReel; nombre: string; marca: MarcaReel | null; descripcion: string }> = [
  { id: "bienvenido", nombre: "01 · Bienvenido", marca: "casa-tomas", descripcion: "Presentación de la casa: sala, raíces gallegas, mesa y 1998" },
  { id: "del-mar", nombre: "02 · Del mar", marca: "casa-tomas", descripcion: "Marisco y pescado: gambas, ostras, bogavante, atún y salazones" },
  { id: "bodega", nombre: "03 · Bodega", marca: "casa-tomas", descripcion: "Vinos de Ribera con ficha de cada botella" },
  { id: "brasa", nombre: "04 · Brasa", marca: "casa-tomas", descripcion: "Carnes, brasa y cuchara" },
  { id: "touza", nombre: "05 · Touza", marca: "touza", descripcion: "Coctelería: barra, alquimia, champagne y sala" },
  { id: "libre", nombre: "En blanco", marca: null, descripcion: "Dos escenas y el cierre, para montar desde cero" },
];

/** Copia profunda (las bases son valores iniciales: nunca se editan en sitio). */
function copia<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Reel nuevo a partir de una base. «libre» usa la marca indicada (por defecto, Casa Tomás). */
export function crearReelDesdeBase(base: BaseReel, marca: MarcaReel = "casa-tomas"): ReelPieza {
  return base === "libre" ? libre(marca) : copia(BASES[base]);
}

/** Escena nueva con valores por defecto sensatos (para «Añadir escena»). */
export function escenaNueva(id: string, numero: number): EscenaReel {
  return {
    id,
    nombre: `Plano ${numero}`,
    duracion_s: 3,
    encuadre: { pos: "50% 50%", zoom: [1.05, 1.15] },
    transicion: "dissolve",
    rotulo: { estilo: "label", titulo: "Título" },
  };
}
