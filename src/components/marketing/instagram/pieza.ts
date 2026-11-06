/**
 * Estado del formulario (borrador) ⇄ JSON de la pieza que entiende el motor
 * (`validarPieza`, `construirDocumento`) y la función `instagram-render`.
 *
 * El borrador guarda TODOS los campos aunque la plantilla no los use (así no se
 * pierde lo escrito al cambiar de plantilla), pero la pieza solo lleva los que la
 * plantilla admite y no están vacíos: el motor rechaza los campos que sobran.
 */
import { obtenerPlantilla, type CampoPieza, type DatosPieza, type ElementoLista, type FormatoId, type MarcaId, type Plantilla } from "@/lib/instagram";

export interface Borrador {
  marca: MarcaId;
  plantilla: string;
  formato: FormatoId;
  foto: string;
  antetitulo: string;
  titular: string;
  cita: string;
  cta: string;
  lista: ElementoLista[];
  pie: string;
  numeral: string;
}

export const NOMBRE_CAMPO: Record<CampoPieza, string> = {
  foto: "Foto",
  antetitulo: "Antetítulo",
  titular: "Titular",
  cita: "Cita",
  cta: "Botón",
  lista: "Lista",
  pie: "Pie",
  numeral: "Numeral",
};

export const AYUDA_CAMPO: Partial<Record<CampoPieza, string>> = {
  antetitulo: "Texto pequeño encima del titular (p. ej. «Esta semana»).",
  titular: "Lo que se lee primero. Máximo 6 palabras.",
  cita: "Frase o lema, sin límite de palabras.",
  cta: "Texto del botón (p. ej. «Reserva tu mesa»).",
  pie: "Línea final pequeña. Si la dejas vacía, sale la de la plantilla.",
  numeral: "Número grande de la pieza (p. ej. «01»).",
  lista: "Filas de nombre y valor (p. ej. un cóctel y su precio).",
};

export function borradorVacio(marca: MarcaId, plantilla: string, formato: FormatoId): Borrador {
  return { marca, plantilla, formato, foto: "", antetitulo: "", titular: "", cita: "", cta: "", lista: [], pie: "", numeral: "" };
}

/** JSON de la pieza con solo los campos admitidos y con algo escrito. */
export function piezaDesdeBorrador(b: Borrador, plantilla: Plantilla | undefined): Record<string, unknown> {
  const pieza: Record<string, unknown> = { marca: b.marca, plantilla: b.plantilla, formato: b.formato };
  const admitidos = new Set<CampoPieza>(plantilla?.admitidos ?? []);
  for (const campo of admitidos) {
    if (campo === "lista") {
      const filas = b.lista
        .map((f) => ({ etiqueta: f.etiqueta.trim(), valor: (f.valor ?? "").trim() }))
        .filter((f) => f.etiqueta || f.valor)
        .map((f) => (f.valor ? f : { etiqueta: f.etiqueta }));
      if (filas.length) pieza.lista = filas;
      continue;
    }
    const valor = (b[campo] ?? "").trim();
    if (valor) pieza[campo] = valor;
  }
  // Un campo vacío NO viaja (el esquema rechaza ""): si falta el titular, la validación ya lo dice.
  return pieza;
}

/** Borrador a partir de los datos guardados de una pieza (historial, ejemplos). */
export function borradorDesdeDatos(d: Partial<DatosPieza> & Record<string, unknown>, base: Borrador): Borrador {
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    marca: (d.marca as MarcaId) ?? base.marca,
    plantilla: texto(d.plantilla) || base.plantilla,
    formato: (d.formato as FormatoId) ?? base.formato,
    foto: texto(d.foto),
    antetitulo: texto(d.antetitulo),
    titular: texto(d.titular),
    cita: texto(d.cita),
    cta: texto(d.cta),
    lista: Array.isArray(d.lista) ? d.lista.map((f) => ({ etiqueta: texto(f?.etiqueta), valor: texto(f?.valor) })) : [],
    pie: texto(d.pie),
    numeral: texto(d.numeral),
  };
}

/**
 * Cómo nombra cada campo el motor en sus mensajes: «titular», «lista[0].etiqueta»…
 * Ojo con los id de plantilla («ct-foto-titular»): por eso se busca el nombre
 * ENTRE comillas angulares, o frases concretas («El titular…», «La foto «…»»).
 */
const PISTAS: Array<[CampoPieza, RegExp]> = [
  ["antetitulo", /«antetitulo»|\bantet[ií]tulo\b/i],
  ["titular", /«titular»|\bel titular\b/i],
  ["cita", /«cita»|\bla cita\b/i],
  ["cta", /«cta»|\bel bot[oó]n\b/i],
  ["lista", /«lista[[»]|\bla lista\b/i],
  ["pie", /«pie»|\bel pie\b/i],
  ["numeral", /«numeral»|\bel numeral\b/i],
  ["foto", /«foto»|\bla foto\b/i],
];

/** Campos que nombran los problemas (para marcarlos en rojo en el formulario). */
export function camposConProblemas(problemas: readonly string[]): Set<CampoPieza> {
  const campos = new Set<CampoPieza>();
  for (const p of problemas) for (const [campo, re] of PISTAS) if (re.test(p)) campos.add(campo);
  return campos;
}

/** Cambia los nombres internos por los del formulario: «cta» → «Botón», «ct-foto-titular» → «Foto con titular». */
export function humanizarProblema(problema: string): string {
  return problema
    .replace(/«([a-z]{2}-[a-z0-9-]+)»/g, (todo, id: string) => {
      const p = obtenerPlantilla(id);
      return p ? `«${p.nombre}»` : todo;
    })
    .replace(/«(antetitulo|titular|cita|cta|lista|pie|numeral|foto)(\[(\d+)\]\.(etiqueta|valor))?»/g, (_, campo: CampoPieza, __, i, parte) =>
      i !== undefined ? `«${NOMBRE_CAMPO[campo]}, fila ${Number(i) + 1} (${parte === "valor" ? "valor" : "nombre"})»` : `«${NOMBRE_CAMPO[campo]}»`,
    );
}
