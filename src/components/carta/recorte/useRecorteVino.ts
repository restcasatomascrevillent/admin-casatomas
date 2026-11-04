import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { avisoSinFondoCarta, quitarFondo, type ProgresoRecorte, type ResultadoFotoCarta } from "../fotoCartaVino";
import { componerFotoCarta, FONDO_ACTIVO, type NombreTema, type TipoFotoCarta } from "../composicionCarta";
import { extensionFoto } from "../composicionVino";
import { redimensionarFoto } from "../redimensionarFoto";
import { recorteNavegadorSeguro } from "./quitarFondoNavegador";
import type { ProgresoMovil } from "./quitarFondoMovil";
import { motivoFallo, vaAOrdenador } from "./recorteMovil";
import { candidataRecortada, detectarFotoRecortada, esStickerRecortado } from "./fotoYaRecortada";
import { medidasFoto } from "../medidasFoto";

export type { TipoFotoCarta } from "../composicionCarta";

/** Sticker ya recortado (sin componer: el fondo lo elige el usuario). */
export interface StickerFoto {
  sticker: Blob;
  /** "recortada": la foto ya venía sin fondo (recorte del iPhone); no se pasó el modelo. */
  metodo: ResultadoFotoCarta["metodo"] | "recortada";
}

export type EstadoRecorte =
  | { fase: "nada" }
  | { fase: "trabajando"; progreso: ProgresoMovil | null }
  | { fase: "listo"; r: StickerFoto }
  /** `aOrdenador`: móvil cuyo recorte falló también en el servidor: al guardar, la foto normal va a un ordenador. */
  | { fase: "fallo"; aviso: string; aOrdenador?: boolean }


export type VistaRecorte = "sticker" | "fondo";
export type EleccionFoto = "carta" | "original";

/** Lado a partir del cual se reduce la foto antes de recortar (las del lote ya vienen a 1200). */
const LADO_RECORTE = 1600;
/**
 * Por encima de este peso se reduce sin mirar las medidas: una foto de cámara
 * de 12-50 MP ocupa 50-200 MB descomprimida, y decodificarla una vez solo para
 * medirla (y otra para reducirla) es memoria que el móvil no tiene.
 */
const BYTES_REDUCIR_SIEMPRE = 1_500_000;

async function fotoParaRecorte(f: File): Promise<Blob> {
  if (f.size > BYTES_REDUCIR_SIEMPRE) return (await redimensionarFoto(f)).blob;
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
 * foto se recorta SOLA en el navegador (ordenador y móvil), se enseña el sticker y
 * se compone con el fondo elegido (`tema`, por defecto FONDO_ACTIVO) según el
 * `tipo` (vino/bebida = botella 3:4; plato = 4:3 centrado). Cambiar de fondo
 * solo recompone (no vuelve a recortar). «Usar foto original» guarda la foto
 * tal cual. En el móvil igual (si el modelo no puede, lo hace el servidor).
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

  /**
   * El modelo, en el propio formulario, en cualquier dispositivo (decisión del
   * dueño, 03-11-2026). En el móvil, si falla, el servidor (quitarFondoMovil);
   * la foto se reduce allí a 1200 px leyendo la cabecera, sin decodificarla entera.
   */
  const seguirConModelo = useCallback((foto: File, yo: number, previo?: Promise<ResultadoFotoCarta>) => {
    const ordenador = recorteNavegadorSeguro();
    setEstado({ fase: "trabajando", progreso: null });
    const onProgreso = (p: ProgresoMovil) => {
      if (turno.current === yo) setEstado({ fase: "trabajando", progreso: p });
    };
    const promesa: Promise<StickerFoto> =
      previo ?? (ordenador ? fotoParaRecorte(foto).then((b) => quitarFondo(b, onProgreso)) : quitarFondo(foto, onProgreso));
    promesa.then(
      (r) => {
        if (turno.current === yo) setEstado({ fase: "listo", r: { sticker: r.sticker, metodo: r.metodo } });
      },
      (e) => {
        console.warn("[recorte] se usa la foto sin fondo de carta", e);
        if (turno.current !== yo) return;
        // Móvil: ya se probó en el servidor. Al guardar, la foto normal va a un ordenador.
        const aOrdenador = !ordenador && vaAOrdenador(e);
        setEstado(
          aOrdenador
            ? { fase: "fallo", aviso: `${motivoFallo(e)} Al guardar se guarda la foto normal y se recortará en un ordenador.`, aOrdenador }
            : { fase: "fallo", aviso: avisoSinFondoCarta(e) },
        );
        setEleccion("original");
      },
    );
  }, []);

  const ejecutar = useCallback((foto: File, previo?: Promise<ResultadoFotoCarta>) => {
    const yo = ++turno.current;
    tocado.current = false;
    setEleccion("carta");
    setVistaInterna("sticker");
    setCompuesta(null);
    // Foto que ya viene sin fondo (recorte del iPhone, PNG con alfa): su
    // transparencia es la máscara, sin modelo, en cualquier dispositivo.
    if (!previo && esStickerRecortado(foto)) {
      setEstado({ fase: "listo", r: { sticker: foto, metodo: "recortada" } });
      return;
    }
    if (!previo && candidataRecortada(foto) && typeof createImageBitmap === "function") {
      setEstado({ fase: "trabajando", progreso: null });
      void detectarFotoRecortada(foto)
        .catch((e) => {
          // No debería lanzar; si lo hace, que la foto siga su camino (antes se quedaba en «trabajando»).
          console.warn("[recorte] no se pudo mirar la transparencia", e);
          return null;
        })
        .then((sticker) => {
          if (turno.current !== yo) return;
          if (sticker) {
            setOriginal(sticker);
            setEstado({ fase: "listo", r: { sticker, metodo: "recortada" } });
          } else seguirConModelo(foto, yo);
        });
      return;
    }
    seguirConModelo(foto, yo, previo);
  }, [seguirConModelo]);

  /** Foto nueva (y, si ya se lanzó en el lote, su promesa de recorte). */
  const iniciar = useCallback(
    (foto: File, previo?: Promise<ResultadoFotoCarta>) => {
      setOriginal(foto);
      ejecutar(foto, previo);
    },
    [ejecutar],
  );

  const repetir = useCallback(() => {
    if (!original) return;
    ejecutar(original);
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

/** Texto del progreso: «Descargando modelo (1ª vez)… 42 %», «Recortando…», «Quitando el fondo en el servidor…». */
export function textoProgreso(p: ProgresoMovil | null): string {
  switch (p?.fase) {
    case "descargando":
      return p.recibidos !== undefined && p.total
        ? `Descargando el recortador (1ª vez)… ${Math.round(p.recibidos / 1048576)}/${Math.max(1, Math.round(p.total / 1048576))} MB`
        : `Descargando modelo (1ª vez)… ${p.pct} %`;
    case "recortando":
      return "Recortando…";
    case "subiendo":
      return "Subiendo la foto al servidor…";
    case "servidor":
      return "Quitando el fondo en el servidor…";
    case "componiendo":
      return "Componiendo…";
    default:
      return "Preparando recorte…";
  }
}

/** Damero de «transparente» detrás del sticker. */
export const ESTILO_DAMERO: CSSProperties = {
  backgroundColor: "#ffffff",
  backgroundImage: "repeating-conic-gradient(#d4d4d4 0% 25%, #ffffff 0% 50%)",
  backgroundSize: "16px 16px",
};
