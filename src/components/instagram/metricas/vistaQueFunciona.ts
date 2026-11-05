/**
 * «Qué funciona» en el panel: etiquetas y frases en castellano llano a partir
 * de la RPC instagram_que_funciona (migración 20261110000000), que llega en
 * la respuesta de «leer» (`queFunciona`). La agregación y la muestra mínima
 * las hace la base de datos; aquí solo se ponen nombres (plantillas y tipos
 * de foto con su nombre del panel) y se elige qué barras enseñar. Funciones
 * puras, probadas en __tests__/vistaQueFunciona.test.ts.
 */
import { formatearPorcentaje, nombrePlantilla, nombreTipoFoto } from "./agregacion";
import type { ConclusionQueFunciona, EjeQueFunciona, GrupoQueFunciona, QueFunciona } from "./tipos";

export const EJES: ReadonlyArray<{ eje: EjeQueFunciona; titulo: string }> = [
  { eje: "formato", titulo: "Por formato" },
  { eje: "plantilla", titulo: "Por plantilla" },
  { eje: "tipo_foto", titulo: "Por tipo de foto" },
  { eje: "dia", titulo: "Por día" },
  { eje: "franja", titulo: "Por hora" },
  { eje: "hashtag", titulo: "Por hashtag" },
];

/** Barras que se enseñan por eje como mucho. */
export const MAX_BARRAS = 4;

const FORMATO: Record<string, { uno: string; varios: string }> = {
  post: { uno: "Publicación", varios: "Las publicaciones del feed" },
  reel: { uno: "Reel", varios: "Los reels" },
  story: { uno: "Historia", varios: "Las historias" },
};

const DIA_PLURAL: Record<string, string> = { sábado: "sábados", domingo: "domingos" };

const mayuscula = (t: string) => (t ? t[0].toLocaleUpperCase("es") + t.slice(1) : t);

/** «12-14» → [12, 14]. */
function horas(clave: string): [number, number] | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(clave);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Nombre corto de un grupo para la barra. */
export function etiquetaGrupo(eje: EjeQueFunciona, clave: string): string {
  switch (eje) {
    case "formato":
      return FORMATO[clave]?.uno ?? clave;
    case "plantilla":
      return nombrePlantilla(clave);
    case "tipo_foto":
      return nombreTipoFoto(clave);
    case "dia":
      return mayuscula(clave);
    case "franja": {
      const h = horas(clave);
      return h ? `${h[0]}–${h[1]} h` : clave;
    }
    default:
      return clave;
  }
}

/** Sujeto de la frase: «Los martes funcionan», «La plantilla «Foto y titular» funciona»… */
function sujeto(eje: EjeQueFunciona, clave: string): string {
  switch (eje) {
    case "formato":
      return `${FORMATO[clave]?.varios ?? `Las publicaciones de tipo «${clave}»`} funcionan mejor`;
    case "plantilla":
      return `La plantilla «${nombrePlantilla(clave)}» funciona mejor`;
    case "tipo_foto":
      return `Las fotos de tipo «${nombreTipoFoto(clave)}» funcionan mejor`;
    case "dia":
      return `Los ${DIA_PLURAL[clave] ?? clave} funcionan mejor`;
    case "franja": {
      const h = horas(clave);
      return h ? `Publicar entre las ${h[0]} y las ${h[1]} h funciona mejor` : `Publicar a las ${clave} funciona mejor`;
    }
    default:
      return `Las publicaciones con ${clave} funcionan mejor`;
  }
}

/**
 * La frase de un eje. Con «mejor», con los nombres del panel y las cifras de
 * la base de datos; si no, la de la base de datos («no hay diferencias
 * claras» o «faltan datos»).
 */
export function fraseConclusion(c: ConclusionQueFunciona): string {
  if (c.estado !== "mejor" || !c.clave || typeof c.tasa !== "number") return c.texto;
  const media = typeof c.tasa_media === "number" ? `, frente al ${formatearPorcentaje(c.tasa_media)} de media` : "";
  const n = c.publicaciones ?? 0;
  return `${sujeto(c.eje, c.clave)}: ${formatearPorcentaje(c.tasa)} de interacción en ${n} ${n === 1 ? "publicación" : "publicaciones"}${media}.`;
}

export interface EjeVista {
  eje: EjeQueFunciona;
  titulo: string;
  grupos: Array<GrupoQueFunciona & { etiqueta: string; mejor: boolean; ancho: number }>;
  conclusion: ConclusionQueFunciona | null;
  frase: string | null;
}

/**
 * Lo que pinta el bloque: cada eje con sus barras (la mejor marcada) y su
 * frase. Si un eje tiene grupos con muestra, solo salen esos (un grupo de 1
 * publicación con una tasa alta no debe parecer el mejor); si no, salen todos
 * como «pocos datos». Con pocos datos en total no hay frase por eje: ya lo
 * dice el aviso general.
 */
export function vistaQueFunciona(qf: QueFunciona): EjeVista[] {
  return EJES.map(({ eje, titulo }) => {
    const conclusion = qf.conclusiones.find((c) => c.eje === eje) ?? null;
    const todos = qf.por?.[eje] ?? [];
    const conMuestra = todos.filter((g) => g.suficiente);
    const lista = (conMuestra.length ? conMuestra : todos).slice(0, MAX_BARRAS);
    const max = Math.max(0, ...lista.map((g) => g.tasa ?? 0));
    return {
      eje,
      titulo,
      conclusion,
      frase: conclusion && qf.suficiente ? fraseConclusion(conclusion) : null,
      grupos: lista.map((g) => ({
        ...g,
        etiqueta: etiquetaGrupo(eje, g.clave),
        mejor: conclusion?.estado === "mejor" && conclusion.clave === g.clave,
        ancho: max > 0 && typeof g.tasa === "number" ? Math.max(2, Math.round((g.tasa / max) * 100)) : 0,
      })),
    };
  });
}

/** Conclusiones «mejor», para el resumen de una línea de arriba. */
export function conclusionesClaras(qf: QueFunciona | null | undefined): string[] {
  if (!qf?.suficiente) return [];
  return qf.conclusiones.filter((c) => c.estado === "mejor").map(fraseConclusion);
}
