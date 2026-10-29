import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { avisoSinFondoCarta, hacerFotoCarta, type ProgresoRecorte, type ResultadoFotoCarta } from "../fotoCartaVino";
import { redimensionarFoto } from "../redimensionarFoto";

export type EstadoRecorte =
  | { fase: "nada" }
  | { fase: "trabajando"; progreso: ProgresoRecorte | null }
  | { fase: "listo"; r: ResultadoFotoCarta }
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

/** Tiempo que se enseña el sticker antes de pasar solo a «Con fondo de carta». */
export const MS_VER_STICKER = 1800;

/**
 * Estado del recorte de una foto en un formulario: lanza el recorte (navegador
 * gratis → Replicate), guarda sticker y foto de carta, y qué se va a guardar.
 * Por defecto se guarda la foto con fondo de carta; «Usar foto original»
 * guarda la foto tal cual.
 */
export function useRecorteVino() {
  const [original, setOriginal] = useState<File | null>(null);
  const [estado, setEstado] = useState<EstadoRecorte>({ fase: "nada" });
  const [eleccion, setEleccion] = useState<EleccionFoto>("carta");
  const [vista, setVistaInterna] = useState<VistaRecorte>("sticker");
  const tocado = useRef(false);
  const turno = useRef(0);

  const ejecutar = useCallback((foto: File, previo?: Promise<ResultadoFotoCarta>) => {
    const yo = ++turno.current;
    tocado.current = false;
    setEstado({ fase: "trabajando", progreso: null });
    setEleccion("carta");
    setVistaInterna("sticker");
    const onProgreso = (p: ProgresoRecorte) => {
      if (turno.current === yo) setEstado({ fase: "trabajando", progreso: p });
    };
    const promesa = previo ?? fotoParaRecorte(foto).then((b) => hacerFotoCarta(b, onProgreso));
    promesa.then(
      (r) => {
        if (turno.current === yo) setEstado({ fase: "listo", r });
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
  }, []);

  const setVista = useCallback((v: VistaRecorte) => {
    tocado.current = true;
    setVistaInterna(v);
  }, []);

  // Tras ver el sticker, pasar solo a «Con fondo» (si no se ha tocado el selector).
  useEffect(() => {
    if (estado.fase !== "listo") return;
    const t = setTimeout(() => {
      if (!tocado.current) setVistaInterna("fondo");
    }, MS_VER_STICKER);
    return () => clearTimeout(t);
  }, [estado]);

  // Object URLs de las tres imágenes (se liberan al cambiar).
  const resultado = estado.fase === "listo" ? estado.r : null;
  const [urls, setUrls] = useState<{ original?: string; sticker?: string; carta?: string }>({});
  useEffect(() => {
    const u = {
      original: original ? URL.createObjectURL(original) : undefined,
      sticker: resultado ? URL.createObjectURL(resultado.sticker) : undefined,
      carta: resultado ? URL.createObjectURL(resultado.foto) : undefined,
    };
    setUrls(u);
    return () => Object.values(u).forEach((x) => x && URL.revokeObjectURL(x));
  }, [original, resultado]);

  /** Lo que se sube al guardar: foto de carta (por defecto) u original. */
  const archivoFinal: File | null = eleccion === "carta" && resultado ? resultado.foto : original;

  return {
    original,
    estado,
    eleccion,
    setEleccion,
    vista,
    setVista,
    urls,
    archivoFinal,
    trabajando: estado.fase === "trabajando",
    iniciar,
    repetir,
    limpiar,
  };
}

export type RecorteVino = ReturnType<typeof useRecorteVino>;

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
