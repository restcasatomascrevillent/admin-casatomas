/**
 * Originales de las fotos de la carta (tabla carta_fotos_originales, en
 * Google Drive): las fotos de platos y vinos con original salen con SUS
 * medidas reales (aptas para la foto a sangre) y `original: true`; las demás,
 * con las de la versión web y `original: false` («Solo web»). Ver
 * docs/instagram-fotos.md, «Originales de la carta en Drive».
 */
import { esAptaPara, type Foto } from "./fotos.js";

/** Lo que hace falta de una fila de carta_fotos_originales. */
export interface FilaOriginalCarta {
  plato_id: string | null;
  vino_id: string | null;
  ancho: number;
  alto: number;
}

export interface OriginalesCarta {
  platos: ReadonlyMap<string, { ancho: number; alto: number }>;
  vinos: ReadonlyMap<string, { ancho: number; alto: number }>;
}

const medidasValidas = (f: FilaOriginalCarta) => Number.isInteger(f.ancho) && Number.isInteger(f.alto) && f.ancho > 0 && f.alto > 0;

export function indexarOriginales(filas: readonly FilaOriginalCarta[] | null | undefined): OriginalesCarta {
  const platos = new Map<string, { ancho: number; alto: number }>();
  const vinos = new Map<string, { ancho: number; alto: number }>();
  for (const f of filas ?? []) {
    if (!f || !medidasValidas(f)) continue;
    if (f.plato_id) platos.set(f.plato_id, { ancho: f.ancho, alto: f.alto });
    else if (f.vino_id) vinos.set(f.vino_id, { ancho: f.ancho, alto: f.alto });
  }
  return { platos, vinos };
}

/**
 * Marca las fotos de la carta (platoId / vinoId) con su original: medidas y
 * aptitud del original si lo hay; si no, `original: false`. Las de Drive y
 * el catálogo no se tocan. No muta las fotos.
 */
export function aplicarOriginales(fotos: readonly Foto[], o: OriginalesCarta | null | undefined): Foto[] {
  return fotos.map((f) => {
    if (!f.platoId && !f.vinoId) return f;
    const m = f.platoId ? o?.platos.get(f.platoId) : o?.vinos.get(f.vinoId!);
    if (!m) return { ...f, original: false };
    return { ...f, ancho: m.ancho, alto: m.alto, aptaPost: esAptaPara(m, "post"), aptaStory: esAptaPara(m, "story"), original: true };
  });
}
