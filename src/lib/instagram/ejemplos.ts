/**
 * Ejemplos del prototipo instagram-studio (ejemplos/*.json, 04/11/2026) para
 * precargar en la UI. Las fotos van por id del catálogo FOTOS. Todos pasan
 * validarPieza y comprobarMaquetacion (lo comprueban los tests).
 */
import type { EntradaPieza } from "./esquema.js";

export interface EjemploPieza {
  /** Nombre del fichero del prototipo sin .json, p. ej. "ct-tipografica-lema". */
  id: string;
  /** JSON de la pieza tal como lo escribiría la UI (entrada de validarPieza). */
  json: EntradaPieza;
}

export const EJEMPLOS: readonly EjemploPieza[] = [
  {
    id: "ct-foto-titular-espacios",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-foto-titular",
      "formato": "post",
      "foto": "ct-salon-3",
      "antetitulo": "Nuestros espacios",
      "titular": "Un entorno para cada ocasión"
    },
  },
  {
    id: "ct-foto-titular-post",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-foto-titular",
      "formato": "post",
      "foto": "ct-salon-1",
      "antetitulo": "Cocina gallega · Marisco · Crevillente",
      "titular": "Mucho más que un restaurante",
      "cta": "Reservar mesa"
    },
  },
  {
    id: "ct-foto-titular-story",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-foto-titular",
      "formato": "story",
      "foto": "ct-lampara",
      "antetitulo": "Nuestros espacios",
      "titular": "Un entorno para cada ocasión",
      "cta": "Reservar mesa"
    },
  },
  {
    id: "ct-foto-titular-tapas",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-foto-titular",
      "formato": "post",
      "foto": "ct-comedor-3",
      "antetitulo": "Cada jueves por la noche",
      "titular": "Tapas de los jueves",
      "cta": "Ver carta"
    },
  },
  {
    id: "ct-tipografica-lema",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-tipografica",
      "formato": "post",
      "antetitulo": "Desde 1998",
      "cita": "Nunca é longo o camiño que conduce á casa dun amigo."
    },
  },
  {
    id: "ct-tipografica-post",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-tipografica",
      "formato": "post",
      "antetitulo": "Desde 1998",
      "titular": "De padres a hijos"
    },
  },
  {
    id: "ct-tipografica-restaurante",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-tipografica",
      "formato": "post",
      "antetitulo": "Cocina gallega · Marisco · Crevillente",
      "titular": "Mucho más que un restaurante"
    },
  },
  {
    id: "tz-foto-titular-post-claim",
    json: {
      "marca": "touza",
      "plantilla": "tz-foto-titular",
      "formato": "post",
      "foto": "touza-2",
      "antetitulo": "Cocktail bar · Crevillente",
      "titular": "Te esperamos en Touza",
      "cta": "Visítanos",
      "pie": "Donde la alquimia de los cócteles se encuentra con la excelencia."
    },
  },
  {
    id: "tz-foto-titular-post",
    json: {
      "marca": "touza",
      "plantilla": "tz-foto-titular",
      "formato": "post",
      "foto": "touza-7",
      "antetitulo": "Cocktail bar · Crevillente",
      "titular": "Cócteles de autor",
      "cta": "Nuestra Carta"
    },
  },
  {
    id: "tz-foto-titular-story",
    json: {
      "marca": "touza",
      "plantilla": "tz-foto-titular",
      "formato": "story",
      "foto": "touza-5",
      "antetitulo": "Ambiente nocturno",
      "titular": "Un sitio para quedarse",
      "cta": "Cómo llegar"
    },
  },
  {
    id: "tz-tipografica-post-cocteles",
    json: {
      "marca": "touza",
      "plantilla": "tz-tipografica",
      "formato": "post",
      "numeral": "02",
      "antetitulo": "De autor",
      "titular": "Cócteles de autor",
      "lista": [
        {
          "etiqueta": "Green Dream",
          "valor": "Ginebra"
        },
        {
          "etiqueta": "Furia Frutal",
          "valor": "Ron"
        },
        {
          "etiqueta": "Spicy Mango Margarita",
          "valor": "Tequila"
        }
      ]
    },
  },
  {
    id: "tz-tipografica-post",
    json: {
      "marca": "touza",
      "plantilla": "tz-tipografica",
      "formato": "post",
      "numeral": "01",
      "antetitulo": "Horario",
      "titular": "Te esperamos en Touza",
      "lista": [
        {
          "etiqueta": "Jueves – Sábado",
          "valor": "20:00 – 02:00"
        },
        {
          "etiqueta": "Domingo",
          "valor": "18:00 – 00:00"
        },
        {
          "etiqueta": "Reservas",
          "valor": "Sin reservas: ven directamente"
        }
      ]
    },
  },
  // Foto enmarcada (08/11/2026): fotos apaisadas como las de la carta (1200×900).
  {
    id: "ct-marco-post",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-marco",
      "formato": "post",
      "foto": "ct-carne-plato",
      "antetitulo": "De nuestra carta",
      "titular": "Brasa, sal y paciencia",
      "cita": "Chuleta de vaca madurada",
      "cta": "Reservar mesa"
    },
  },
  {
    id: "ct-marco-story",
    json: {
      "marca": "casa-tomas",
      "plantilla": "ct-marco",
      "formato": "story",
      "foto": "ct-carne-plato",
      "antetitulo": "De nuestra carta",
      "titular": "Brasa, sal y paciencia",
      "cita": "Chuleta de vaca madurada",
      "cta": "Reservar mesa"
    },
  },
  {
    id: "tz-marco-post",
    json: {
      "marca": "touza",
      "plantilla": "tz-marco",
      "formato": "post",
      "foto": "touza-2",
      "antetitulo": "Para empezar la noche",
      "titular": "Un rincón para quedarse",
      "cita": "Sofá, mármol y luz baja",
      "cta": "Ver carta"
    },
  },
  {
    id: "tz-marco-story",
    json: {
      "marca": "touza",
      "plantilla": "tz-marco",
      "formato": "story",
      "foto": "touza-2",
      "antetitulo": "Para empezar la noche",
      "titular": "Un rincón para quedarse",
      "cita": "Sofá, mármol y luz baja",
      "cta": "Ver carta"
    },
  },
];

/**
 * Ejemplos de las plantillas v2 (08/11/2026): uno por plantilla, en post y en
 * story. Aparte de EJEMPLOS a propósito: la UI no los ofrece para cargar, así
 * que sus rótulos («Nuevo», «Cocktail bar»…) no cuentan como «rótulos de
 * ejemplo olvidados» en instagram-ia (ejemplos.ts). Los usan las pruebas de render.
 */
export const EJEMPLOS_V2: readonly EjemploPieza[] = ejemplosV2();

/**
 * Ejemplos de las plantillas v2: [plantilla, foto, textos], cada uno en post
 * y en story. Textos cortos y reales (la marca habla poco y concreto).
 */
function ejemplosV2(): EjemploPieza[] {
  const lema = "Nunca é longo o camiño que conduce á casa dun amigo.";
  const filas: Array<[string, "casa-tomas" | "touza", string | null, Record<string, string>]> = [
    ["ct-portada", "casa-tomas", "ct-champan", { antetitulo: "Nuevo", titular: "Para brindar en casa", cita: "Champán francés, también por copas." }],
    ["ct-portada-marco", "casa-tomas", "ct-carne-plato", { antetitulo: "De nuestra carta", titular: "Brasa, sal y paciencia", cita: "Chuleta de vaca madurada" }],
    ["ct-plato", "casa-tomas", "ct-lampara", { antetitulo: "Nuestro comedor", titular: "Luz de sobremesa" }],
    ["ct-plato-marco", "casa-tomas", "ct-carne-plato", { antetitulo: "Para compartir", titular: "Chuleta de vaca", cita: "Con patatas y romero" }],
    ["ct-cierre", "casa-tomas", "ct-lampara", { cita: lema, cta: "Reservar mesa" }],
    ["ct-cierre-marco", "casa-tomas", "ct-carne-plato", { cita: lema, cta: "Reservar mesa" }],
    ["ct-cierre-marca", "casa-tomas", null, { cita: lema, cta: "Reservar mesa" }],
    ["ct-frase", "casa-tomas", null, { antetitulo: "Lo que decimos en casa", cita: "Que cada visita se sienta como volver a casa." }],
    ["tz-portada", "touza", "touza-7", { antetitulo: "Cocktail bar", titular: "Alquimia en cada copa" }],
    ["tz-portada-marco", "touza", "touza-2", { antetitulo: "Nuestro espacio", titular: "Quédate un rato más" }],
    ["tz-plato", "touza", "touza-5", { antetitulo: "Cóctel de autor", titular: "Clover Club", cita: "Gin, frambuesa, vermut seco, limón y clara" }],
    ["tz-plato-marco", "touza", "touza-2", { antetitulo: "Nuestro espacio", titular: "Sofá y luz baja" }],
    ["tz-cierre", "touza", "touza-8-1", { antetitulo: "Cócteles de autor", cita: "Raíces gallegas, alma mediterránea.", cta: "Ver carta" }],
    ["tz-cierre-marco", "touza", "touza-2", { cita: "Raíces gallegas, alma mediterránea.", cta: "Ver carta" }],
    ["tz-cierre-marca", "touza", null, { antetitulo: "Cocktail bar", cita: "Touza no es solo un bar; es una declaración de intenciones." }],
    ["tz-frase", "touza", null, { antetitulo: "Jueves a sábado", cita: "Cada cóctel cuenta una historia." }],
  ];
  return filas.flatMap(([plantilla, marca, foto, textos]) =>
    (["post", "story"] as const).map((formato) => ({
      id: `${plantilla}-${formato}`,
      json: { marca, plantilla, formato, ...(foto ? { foto } : {}), ...textos } as EntradaPieza,
    })),
  );
}

/** Ejemplos de una plantilla (y, si se pide, de un formato). */
export function ejemplosDe(plantilla: string, formato?: EntradaPieza["formato"]): EjemploPieza[] {
  return EJEMPLOS.filter((e) => e.json.plantilla === plantilla && (!formato || e.json.formato === formato));
}
