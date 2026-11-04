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
];

/** Ejemplos de una plantilla (y, si se pide, de un formato). */
export function ejemplosDe(plantilla: string, formato?: EntradaPieza["formato"]): EjemploPieza[] {
  return EJEMPLOS.filter((e) => e.json.plantilla === plantilla && (!formato || e.json.formato === formato));
}
