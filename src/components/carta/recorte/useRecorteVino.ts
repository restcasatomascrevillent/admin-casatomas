import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { avisoSinFondoCarta, quitarFondo, type ProgresoRecorte, type ResultadoFotoCarta } from "../fotoCartaVino";
import { componerFotoCarta, FONDO_ACTIVO, type NombreTema, type TipoFotoCarta } from "../composicionCarta";
import { extensionFoto } from "../composicionVino";
import { redimensionarFoto } from "../redimensionarFoto";

export type { TipoFotoCarta } from "../composicionCarta";

/** Sticker ya recortado (sin componer: el fondo lo elige el usuario). */
export interface StickerFoto {
  sticker: Blob;
  metodo: ResultadoFotoCarta["metodo"];
}

export type EstadoRecorte =
  | { fase: "nada" }
  | { fase: "trabajando"; progreso: ProgresoRecorte | null }
  | { fase: "listo"; r: StickerFoto }
  | { fase: "fallo"; aviso: string };

export type VistaRecorte = "sticker" | "fondo";
export type EleccionFoto = "carta" | "original";

/** Lado a partir del cual se reduce la foto antes de recortar (las del lote ya vienen a 1200). */
const LADO_RECORTE = 1600;

async function fotoParaRecorte(f: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(f);
    const grande = Math.max(bmp.width, bmp.height) > LADO_RECORTE;
    bmp.close();
    if (!grande) return f;
  } catch {
    /* que lo intente redimensionarFoto */
  }
  return (await redimensionarFoto(f)).blob;
}

/** Tiempo que se enseña el sticker antes de pasar solo a «Con fondo». */
export const MS_VER_STICKER = 1800;

/**
 * Estado de la foto de producto en un formulario de la carta: al elegir la
 * foto se recorta SOLA (navegador gratis → Replicate), se enseña el sticker y
 * se compone con el fondo elegido (`tema`, por defecto FONDO_ACTIVO) según el
 * `tipo` (vino/bebida = botella 3:4; plato = 4:3 centrado). Cambiar de fondo
 * solo recompone (no vuelve a recortar). «Usar foto original» guarda la foto
 * tal cual.
 */
export function useFotoCarta(tipo: TipoFotoCarta) {
  const [original, setOriginal] = useState<File | null>(null);
  const [estado, setEstado] = useState<EstadoRecorte>({ fase: "nada" });
  const [eleccion, setEleccion] = useState<EleccionFoto>("carta");
  const [vista, setVistaInterna] = useState<VistaRecorte>("sticker");
  const [tema, setTemaInterno] = useState<NombreTema>(FONDO_ACTIVO);
  const [compuesta, setCompuesta] = useState<File | null>(null);
  const [componiendo, setComponiendo] = useState(false);
  const tocado = useRef(false);
  const turno = useRef(0);

  const ejecutar = useCallback((foto: File, previo?: Promise<ResultadoFotoCarta>) => {
    const yo = ++turno.current;
    tocado.current = false;
    setEstado({ fase: "trabajando", progreso: null });
    setEleccion("carta");
    setVistaInterna("sticker");
    setCompuesta(null);
    const onProgreso = (p: ProgresoRecorte) => {
      if (turno.current === yo) setEstado({ fase: "trabajando", progreso: p });
    };
    const promesa: Promise<StickerFoto> = previo ?? fotoParaRecorte(foto).then((b) => quitarFondo(b, onProgreso));
    promesa.then(
      (r) => {
        if (turno.current === yo) setEstado({ fase: "listo", r: { sticker: r.sticker, metodo: r.metodo } });
      },
      (e) => {
        console.warn("[recorte] se usa la foto sin fondo de carta", e);
        if (turno.current !== yo) return;
        setEstado({ fase: "fallo", aviso: avisoSinFondoCarta(e) });
        setEleccion("original");
      },
    );
  }, []);

  /** Foto nueva (y, si ya se lanzó en el lote, su promesa de recorte). */
  const iniciar = useCallback(
    (foto: File, previo?: Promise<ResultadoFotoCarta>) => {
      setOriginal(foto);
      ejecutar(foto, previo);
    },
    [ejecutar],
  );

  const repetir = useCallback(() => {
    if (original) ejecutar(original);
  }, [original, ejecutar]);

  const limpiar = useCallback(() => {
    turno.current++;
    setOriginal(null);
    setEstado({ fase: "nada" });
    setEleccion("carta");
    setCompuesta(null);
    setTemaInterno(FONDO_ACTIVO);
  }, []);

  const setVista = useCallback((v: VistaRecorte) => {
    tocado.current = true;
    setVistaInterna(v);
  }, []);

  /** Elegir fondo: se ve al momento con fondo (y se usa la foto de carta). */
  const setTema = useCallback((t: NombreTema) => {
    tocado.current = true;
    setTemaInterno(t);
    setVistaInterna("fondo");
    setEleccion("carta");
  }, []);

  // Tras ver el sticker, pasar solo a «Con fondo» (si no se ha tocado nada).
  useEffect(() => {
    if (estado.fase !== "listo") return;
    const t = setTimeout(() => {
      if (!tocado.current) setVistaInterna("fondo");
    }, MS_VER_STICKER);
    return () => clearTimeout(t);
  }, [estado]);

  // Componer sticker + fondo cada vez que cambia el sticker o el fondo.
  const resultado = estado.fase === "listo" ? estado.r : null;
  useEffect(() => {
    if (!resultado) return;
    let vivo = true;
    setComponiendo(true);
    componerFotoCarta(resultado.sticker, { tipo, tema })
      .then((blob) => {
        if (!vivo) return;
        setCompuesta(new File([blob], `foto-carta.${extensionFoto(blob)}`, { type: blob.type }));
      })
      .catch((e) => {
        console.warn("[recorte] no se pudo componer", e);
        if (vivo) setEstado({ fase: "fallo", aviso: avisoSinFondoCarta(e) });
        if (vivo) setEleccion("original");
      })
      .finally(() => {
        if (vivo) setComponiendo(false);
      });
    return () => {
      vivo = false;
    };
  }, [resultado, tipo, tema]);

  // Object URLs de las tres imágenes (se liberan al cambiar).
  const [urlOriginal, setUrlOriginal] = useState<string>();
  const [urlSticker, setUrlSticker] = useState<string>();
  const [urlCarta, setUrlCarta] = useState<string>();
  useEffect(() => {
    const u = original ? URL.createObjectURL(original) : undefined;
    setUrlOriginal(u);
    return () => u && URL.revokeObjectURL(u);
  }, [original]);
  useEffect(() => {
    const u = resultado ? URL.createObjectURL(resultado.sticker) : undefined;
    setUrlSticker(u);
    return () => u && URL.revokeObjectURL(u);
  }, [resultado]);
  useEffect(() => {
    const u = compuesta ? URL.createObjectURL(compuesta) : undefined;
    setUrlCarta(u);
    return () => u && URL.revokeObjectURL(u);
  }, [compuesta]);

  const listoCarta = !!(resultado && compuesta);
  /** Lo que se sube como foto principal: foto de carta (por defecto) u original. */
  const archivoFinal: File | null = eleccion === "carta" && listoCarta ? compuesta : original;

  return {
    tipo,
    original,
    estado,
    eleccion,
    setEleccion,
    vista,
    setVista,
    tema,
    setTema,
    urls: { original: urlOriginal, sticker: urlSticker, carta: urlCarta },
    /** Foto de carta compuesta (null mientras no esté). */
    compuesta,
    archivoFinal,
    /** true si al guardar se sube la foto de carta (y el original aparte). */
    usaCarta: eleccion === "carta" && listoCarta,
    trabajando: estado.fase === "trabajando" || componiendo,
    iniciar,
    repetir,
    limpiar,
  };
}

export type FotoCarta = ReturnType<typeof useFotoCarta>;

/** Compatibilidad: el formulario de vinos. */
export const useRecorteVino = () => useFotoCarta("vino");
export type RecorteVino = FotoCarta;

/** Texto del progreso: «Descargando modelo (1ª vez)… 42 %», «Recortando…». */
export function textoProgreso(p: ProgresoRecorte | null): string {
  if (p?.fase === "descargando") return `Descargando modelo (1ª vez)… ${p.pct} %`;
  if (p?.fase === "recortando") return "Recortando…";
  return "Preparando recorte…";
}

/** Damero de «transparente» detrás del sticker. */
export const ESTILO_DAMERO: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage: "repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "16px 16px",
};
