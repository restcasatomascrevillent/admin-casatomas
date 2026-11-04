/**
 * Biblioteca de fotos de Instagram = la carpeta de Google Drive de cada marca
 * (marketing/instagram/fotos/<marca>), vía la Edge Function instagram-drive.
 * Sus metadatos (tipo, descripción) salen de instagram_fotos; las fotos sin
 * fila llegan con tipo null y su aptitud se deduce de las medidas.
 *
 * El catálogo estático de src/lib/instagram/fotos.ts ya no se enseña: sus
 * rutas del bucket no existen en la demo (salían fotos rotas).
 *
 * Para la vista previa y el render, la foto elegida se «prepara»: se copia al
 * bucket (tmp/<uuid>.jpg) y su ruta pasa a la Foto del catálogo. La copia se
 * guarda en caché unas horas (la función borra las de más de 24 h).
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { driveIdDeFoto, fotoDesdeDrive, fotosDe, type FormatoId, type Foto, type MarcaId } from "@/lib/instagram";
import { listarFotosDrive, prepararFotoDrive, type FotoPreparada } from "./api";

/** Prefijo de las claves de React Query de la biblioteca de Drive. */
export const CLAVE_FOTOS = ["instagram_drive_fotos"] as const;
export const claveFotosDrive = (marca: MarcaId) => [...CLAVE_FOTOS, marca] as const;
export const CLAVE_PREPARADA = ["instagram_drive_preparada"] as const;
export const clavePreparada = (driveId: string) => [...CLAVE_PREPARADA, driveId] as const;
/** Una copia tmp/ se reutiliza 12 h (la función borra las de más de 24 h). */
export const VIDA_PREPARADA_MS = 12 * 60 * 60 * 1000;

export interface BibliotecaDrive {
  fotos: Foto[];
  alcance: string | null;
  avisos: string[];
}

/** Fotos de Drive de una marca (con la forma del catálogo). */
export function useFotosDrive(marca: MarcaId) {
  return useQuery({
    queryKey: claveFotosDrive(marca),
    queryFn: async (): Promise<BibliotecaDrive> => {
      const r = await listarFotosDrive(marca);
      return { fotos: r.fotos.map((f) => fotoDesdeDrive(f, marca)).filter((f): f is Foto => f !== null), alcance: r.alcance, avisos: r.avisos };
    },
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Fotos de una marca (y, si se pide, solo las aptas para un formato) y el
 * catálogo con el que se valida y se construye la pieza.
 */
export function useFotosInstagram(marca: MarcaId, formato?: FormatoId) {
  const consulta = useFotosDrive(marca);
  const catalogo = useMemo(() => consulta.data?.fotos ?? [], [consulta.data]);
  const fotos = useMemo(() => fotosDe(marca, formato, catalogo), [marca, formato, catalogo]);
  return {
    fotos,
    catalogo,
    alcance: consulta.data?.alcance ?? null,
    avisos: consulta.data?.avisos ?? [],
    cargando: consulta.isLoading,
    error: consulta.error as Error | null,
  };
}

export interface FotoLista {
  /** Foto del catálogo con la ruta de su copia en el bucket. */
  foto: Foto;
  /** Lo que necesita el render. */
  preparada: FotoPreparada;
  /** Ruta tmp/… (para borrarla al publicar). */
  ruta: string;
}

/**
 * Prepara (copia al bucket) la foto de Drive elegida. Devuelve la foto lista
 * para pintar, o el estado de la preparación. Para fotos que no son de Drive
 * no hace nada.
 */
export function useFotoPreparada(marca: MarcaId, idFoto: string, catalogo: readonly Foto[]) {
  const driveId = driveIdDeFoto(idFoto);
  const base = catalogo.find((f) => f.id === idFoto) ?? null;
  const consulta = useQuery({
    queryKey: clavePreparada(driveId ?? ""),
    queryFn: () => prepararFotoDrive(marca, driveId as string),
    enabled: !!driveId && !!base && !base.problema,
    staleTime: VIDA_PREPARADA_MS,
    gcTime: VIDA_PREPARADA_MS,
    retry: 1,
  });
  const lista = useMemo<FotoLista | null>(() => {
    if (!driveId || !base || !consulta.data?.ruta) return null;
    const ancho = base.ancho || consulta.data.ancho || 0;
    const alto = base.alto || consulta.data.alto || 0;
    const foto: Foto = { ...base, ruta: consulta.data.ruta, ancho, alto };
    return { foto, ruta: consulta.data.ruta, preparada: { id: base.id, url: consulta.data.url, ancho, alto, tipo: base.tipo, marca: base.marca } };
  }, [driveId, base, consulta.data]);
  return { esDrive: !!driveId, lista, preparando: !!driveId && consulta.isLoading, error: consulta.error as Error | null };
}
