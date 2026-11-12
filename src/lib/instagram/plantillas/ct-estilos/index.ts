/**
 * Estilos de las stories que publica hoy Casa Tomás, copiados y mejorados
 * (12/11/2026, escaneo de las destacadas de @casatomascrevillent en
 * instagram-studio/propuesta/referencias-actuales/CATALOGO-ESTILOS.md).
 *
 *   rotulos.ts     ct-rotulo-hilo, ct-rotulo-recuadro, ct-rotulo-titular,
 *                  ct-rotulo-manuscrita (destacada «Platos», post y story)
 *   resena.ts      ct-resena, ct-resena-foto («Opináis», post y story)
 *   vosotros.ts    ct-vosotros-celebracion, ct-vosotros-gracias (story)
 *   anuncios.ts    ct-reserva-mesa, ct-touza-descubre, ct-tapas-poster (story)
 *   destacadas.ts  ct-icono-destacada (portadas de destacadas, story)
 *
 * Los ids van detrás de los de ct-editorial en orden alfabético dentro de su
 * papel y encaje, para que plantillaPara y plantillaEnmarcada sigan
 * devolviendo ct-portada, ct-plato, ct-cierre y sus «-marco».
 */
import type { EjemploPieza } from "../../ejemplos.js";
import type { Plantilla } from "../../tipos.js";
import { PLANTILLAS_ANUNCIOS, CARAS_POSTER, CARAS_RESERVA, CARAS_TOUZA } from "./anuncios.js";
import { numeroDeCaras, type Cara } from "./base.js";
import { CARAS_DESTACADA, PLANTILLAS_DESTACADAS } from "./destacadas.js";
import { CARAS_RESENA, PLANTILLAS_RESENA } from "./resena.js";
import { CARAS_ROTULOS, PLANTILLAS_ROTULOS } from "./rotulos.js";
import { CARAS_CELEBRACION, CARAS_GRACIAS, PLANTILLAS_VOSOTROS } from "./vosotros.js";

export { htmlRotuloHilo, yLlegada, LLEGADA_HILO, cuerpoTitularGrande } from "./rotulos.js";
export { cuerpoResena, TITULO_RESENA, MAX_RESENA } from "./resena.js";
export { AVISO_STICKER, HUECO_STICKER } from "./anuncios.js";
export { iconoPara, type IconoDestacada } from "./destacadas.js";
export { motivoResaltado, nombresResaltados } from "./vosotros.js";

export const PLANTILLAS_CT_ESTILOS: readonly Plantilla[] = [
  ...PLANTILLAS_ROTULOS,
  ...PLANTILLAS_RESENA,
  ...PLANTILLAS_VOSOTROS,
  ...PLANTILLAS_ANUNCIOS,
  ...PLANTILLAS_DESTACADAS,
];

export const IDS_CT_ESTILOS: readonly string[] = PLANTILLAS_CT_ESTILOS.map((p) => p.id);

const CARAS: Record<string, readonly Cara[]> = {
  ...CARAS_ROTULOS,
  "ct-resena": CARAS_RESENA,
  "ct-resena-foto": CARAS_RESENA,
  "ct-vosotros-celebracion": CARAS_CELEBRACION,
  "ct-vosotros-gracias": CARAS_GRACIAS,
  "ct-reserva-mesa": CARAS_RESERVA,
  "ct-touza-descubre": CARAS_TOUZA,
  "ct-tapas-poster": CARAS_POSTER,
  "ct-icono-destacada": CARAS_DESTACADA,
};

/** Caras @font-face que añade la plantilla además de las de su marca (0 si no es de estas). */
export function carasExtraEstilos(id: string): number {
  return numeroDeCaras(CARAS[id] ?? []);
}

const RESENA =
  "Todo lo que pedimos estaba muy bueno y el sitio es muy acogedor. El personal, de diez, y la atención también. Seguro que volveremos: nos quedamos con muchas cosas por probar.";

/**
 * Un ejemplo por plantilla y formato (las pruebas de render los piden), con
 * fotos del catálogo estático: a sangre, ct-champan; enmarcadas o de fondo,
 * ct-carne-plato (1920×1080).
 */
function ejemplos(): EjemploPieza[] {
  const filas: Array<[string, string, Record<string, string>]> = [
    ["ct-rotulo-hilo", "ct-champan", { titular: "Champán francés", cita: "También por copas" }],
    ["ct-rotulo-recuadro", "ct-champan", { titular: "Croquetas", cita: "Uno de nuestros mejores sabores, en Casa Tomás" }],
    ["ct-rotulo-titular", "ct-lampara", { titular: "Tataki de chuleta", cita: "con salsa de tuétano" }],
    ["ct-rotulo-manuscrita", "ct-champan", { titular: "Tarta de queso", cita: "Con helado" }],
    ["ct-resena", "", { antetitulo: "Ana G.", cita: RESENA }],
    ["ct-resena-foto", "ct-carne-plato", { antetitulo: "Ana G.", cita: RESENA }],
    ["ct-vosotros-celebracion", "ct-carne-plato", { titular: "Vicente y Ana", cita: "celebrando su 75 cumpleaños" }],
    ["ct-vosotros-gracias", "ct-carne-plato", { titular: "Gracias por visitarnos", pie: "@cliente.ejemplo" }],
    ["ct-reserva-mesa", "ct-champan", { titular: "Reserva mesa", cita: "en tu restaurante favorito" }],
    ["ct-touza-descubre", "ct-champan", { titular: "Descubre Touza", pie: "Cocktail bar · Crevillent" }],
    ["ct-tapas-poster", "ct-lampara", { antetitulo: "Jueves de", titular: "Tapas y cóctel", pie: "¡Te esperamos!" }],
    ["ct-icono-destacada", "", { titular: "Opináis" }],
  ];
  return filas.flatMap(([id, foto, textos]) => {
    const p = PLANTILLAS_CT_ESTILOS.find((x) => x.id === id)!;
    return p.formatos.map((formato) => ({
      id: `${id}-${formato}`,
      json: { marca: "casa-tomas" as const, plantilla: id, formato, ...(foto ? { foto } : {}), ...textos } as EjemploPieza["json"],
    }));
  });
}

export const EJEMPLOS_CT_ESTILOS: readonly EjemploPieza[] = ejemplos();
