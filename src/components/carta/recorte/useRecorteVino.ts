import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { avisoSinFondoCarta, quitarFondo, type ProgresoRecorte, type ResultadoFotoCarta } from "../fotoCartaVino";
import { componerFotoCarta, FONDO_ACTIVO, type NombreTema, type TipoFotoCarta } from "../composicionCarta";
import { extensionFoto } from "../composicionVino";
import { redimensionarFoto } from "../redimensionarFoto";
import { recorteNavegadorSeguro } from "./quitarFondoNavegador";
import type { ProgresoMovil } from "./quitarFondoMovil";
import { reducirFotoRecorte } from "./reducirFotoRecorte";
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
  /**
   * No se pudo quitar el fondo. Desde el 13/11/2026 NO se pasa sola a la foto
   * original: para guardar hay que pulsar «Reintentar» o «Usar foto original».
   */
  | { fase: "fallo"; aviso: string }


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

/**
 * Móvil y tableta: lado de la foto reducida UNA sola vez al elegirla. La vista
 * previa, la lectura de la etiqueta y el recorte salen de ella; la foto de la
 * cámara (12-48 MP) no se vuelve a decodificar entera (13/11/2026: tres
 * decodificaciones a la vez, más el modelo, dejaban al iPhone sin memoria).
 */
export const LADO_FOTO_MOVIL = 1400;

async function reducirFotoMovil(f: File): Promise<File> {
  const r = await reducirFotoRecorte(f, LADO_FOTO_MOVIL);
  if (r === f) return f;
  const base = f.name.replace(/\.[^.]+$/, "") || "foto";
  return new File([r], `${base}.jpg`, { type: r.type || "image/jpeg" });
}

export interface OpcionesIniciar {
  /**
   * Algo que hacer con la foto antes de quitar el fondo (leer la etiqueta del
   * vino). En el móvil va primero y el recorte espera a que acabe (uno detrás
   * de otro, por memoria), con la foto ya reducida; en el ordenador, a la vez.
   */
  antes?: (foto: File) => Promise<unknown>;
}

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
 * foto se le quita el fondo SOLA (ordenador: en su navegador; móvil y tableta:
 * en el servidor), se enseña el sticker y se compone con el fondo elegido
 * (`tema`, por defecto FONDO_ACTIVO) según el `tipo` (vino/bebida = botella
 * 3:4; plato = 4:3 centrado). Cambiar de fondo solo recompone (no vuelve a
 * recortar). «Usar foto original» guarda la foto tal cual, solo si se pulsa:
 * mientras falte el fondo (`faltaFondo`), el formulario no deja guardar.
 */
export function useFotoCarta(tipo: TipoFotoCarta) {
  const [original, setOriginal] = useState<File | null>(null);
  /** Móvil: la foto reducida una vez (vista previa y recorte). */
  const [previa, setPreviaInterna] = useState<File | null>(null);
  const previaRef = useRef<File | null>(null);
  const setPrevia = useCallback((f: File | null) => {
    previaRef.current = f;
    setPreviaInterna(f);
  }, []);
  const [estado, setEstado] = useState<EstadoRecorte>({ fase: "nada" });
  const [eleccion, setEleccion] = useState<EleccionFoto>("carta");
  const [vista, setVistaInterna] = useState<VistaRecorte>("sticker");
  const [tema, setTemaInterno] = useState<NombreTema>(FONDO_ACTIVO);
  const [compuesta, setCompuesta] = useState<File | null>(null);
  const [componiendo, setComponiendo] = useState(false);
  const tocado = useRef(false);
  const turno = useRef(0);

  /**
   * Quitar el fondo en el propio formulario, antes de guardar (decisión del
   * dueño, 03-11-2026). Ordenador: en su navegador (y, si no puede, el
   * servidor); móvil: en el servidor (quitarFondo → quitarFondoMovil).
   */
  const seguirConModelo = useCallback((foto: File, yo: number, previo?: Promise<ResultadoFotoCarta>) => {
    const ordenador = recorteNavegadorSeguro();
    setEstado({ fase: "trabajando", progreso: null });
    const onProgreso = (p: ProgresoMovil) => {
      if (turno.current === yo) setEstado({ fase: "trabajando", progreso: p });
    };
    const quitar = async (): Promise<StickerFoto> => {
      const base: Blob = ordenador ? await fotoParaRecorte(foto) : foto;
      const r = await quitarFondo(base, onProgreso);
      // Platos: el modelo a veces deja solo la comida (o medio plato); se busca
      // el plato entero alrededor (14/11/2026, «el recortador de platos no funciona»).
      if (tipo !== "plato") return r;
      try {
        const { completarPlato } = await import("./completarPlato");
        return { ...r, sticker: await completarPlato(base, r.sticker) };
      } catch (e) {
        console.warn("[recorte] no se pudo completar el plato; se deja el recorte del modelo", e);
        return r;
      }
    };
    const promesa: Promise<StickerFoto> = previo ?? quitar();
    promesa.then(
      (r) => {
        if (turno.current === yo) setEstado({ fase: "listo", r: { sticker: r.sticker, metodo: r.metodo } });
      },
      (e) => {
        console.warn("[recorte] no se ha podido quitar el fondo", e);
        if (turno.current !== yo) return;
        // Sin pasar sola a «Usar foto original» (13/11/2026, «antes de subir
        // una foto a la carta tiene que salir con el fondo recortado»).
        setEstado({ fase: "fallo", aviso: avisoSinFondoCarta(e) });
      },
    );
  }, [tipo]);

  /**
   * Con el modelo. Móvil: reduce la foto una vez (vista previa y recorte salen
   * de ahí), hace primero `antes` (leer la etiqueta) y después quita el fondo.
   * Ordenador (o lote, que ya trae su recorte): todo a la vez, como siempre.
   */
  const conModelo = useCallback(
    (foto: File, yo: number, previo?: Promise<ResultadoFotoCarta>, antes?: OpcionesIniciar["antes"]) => {
      if (previo || recorteNavegadorSeguro()) {
        if (antes) void antes(foto).catch((e) => console.warn("[recorte] antes de recortar", e));
        seguirConModelo(foto, yo, previo);
        return;
      }
      setEstado({ fase: "trabajando", progreso: antes ? { fase: "etiqueta" } : null });
      void (async () => {
        let base = foto;
        try {
          base = await reducirFotoMovil(foto);
        } catch (e) {
          console.warn("[recorte] no se pudo reducir la foto; se sigue con la original", e);
        }
        if (turno.current !== yo) return;
        if (base !== foto) setPrevia(base);
        if (antes) {
          try {
            await antes(base);
          } catch (e) {
            console.warn("[recorte] antes de recortar", e);
          }
          if (turno.current !== yo) return;
        }
        seguirConModelo(base, yo);
      })();
    },
    [seguirConModelo, setPrevia],
  );

  const ejecutar = useCallback((foto: File, previo?: Promise<ResultadoFotoCarta>, opciones: OpcionesIniciar = {}) => {
    const yo = ++turno.current;
    tocado.current = false;
    setEleccion("carta");
    setVistaInterna("sticker");
    setCompuesta(null);
    setPrevia(null);
    const { antes } = opciones;
    // Foto que ya viene sin fondo (recorte del iPhone, PNG con alfa): su
    // transparencia es la máscara, sin modelo, en cualquier dispositivo.
    if (!previo && esStickerRecortado(foto)) {
      setEstado({ fase: "listo", r: { sticker: foto, metodo: "recortada" } });
      if (antes) void antes(foto).catch((e) => console.warn("[recorte] antes de recortar", e));
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
            if (antes) void antes(sticker).catch((e) => console.warn("[recorte] antes de recortar", e));
          } else conModelo(foto, yo, undefined, antes);
        });
      return;
    }
    conModelo(foto, yo, previo, antes);
  }, [conModelo, setPrevia]);

  /**
   * Foto nueva (y, si ya se lanzó en el lote, su promesa de recorte).
   * `opciones.antes`: p. ej. leer la etiqueta (ver OpcionesIniciar).
   */
  const iniciar = useCallback(
    (foto: File, previo?: Promise<ResultadoFotoCarta>, opciones?: OpcionesIniciar) => {
      setOriginal(foto);
      ejecutar(foto, previo, opciones);
    },
    [ejecutar],
  );

  /** «Reintentar» / «Repetir recorte». En el móvil, con la foto ya reducida (sin decodificar otra vez la de la cámara). */
  const repetir = useCallback(() => {
    if (!original) return;
    const reducida = previaRef.current;
    if (reducida && !recorteNavegadorSeguro()) {
      const yo = ++turno.current;
      tocado.current = false;
      setEleccion("carta");
      setVistaInterna("sticker");
      setCompuesta(null);
      seguirConModelo(reducida, yo);
      return;
    }
    ejecutar(original);
  }, [original, ejecutar, seguirConModelo]);

  const limpiar = useCallback(() => {
    turno.current++;
    setOriginal(null);
    setPrevia(null);
    setEstado({ fase: "nada" });
    setEleccion("carta");
    setCompuesta(null);
    setTemaInterno(FONDO_ACTIVO);
  }, [setPrevia]);

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
        // Tampoco aquí se pasa sola a la foto original (13/11/2026).
        if (vivo) setEstado({ fase: "fallo", aviso: avisoSinFondoCarta(e) });
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
  // En el móvil se enseña la foto reducida: la de la cámara entera no se decodifica para la vista previa.
  const fotoVista = previa ?? original;
  useEffect(() => {
    const u = fotoVista ? URL.createObjectURL(fotoVista) : undefined;
    setUrlOriginal(u);
    return () => u && URL.revokeObjectURL(u);
  }, [fotoVista]);
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
  /**
   * Hay foto nueva y aún no tiene el fondo de carta (quitándolo, componiendo
   * o falló) sin haber elegido «Usar foto original»: el formulario no deja
   * guardar (13/11/2026: antes se subía sola la foto sin recortar).
   */
  const faltaFondo = !!original && eleccion === "carta" && !listoCarta;

  return {
    tipo,
    original,
    /** La foto más ligera que hay: en el móvil, la reducida una vez; si no, la original. Para leer la etiqueta. */
    fotoLigera: previa ?? original,
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
    faltaFondo,
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
    case "etiqueta":
      return "Leyendo la etiqueta; después se quita el fondo…";
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
