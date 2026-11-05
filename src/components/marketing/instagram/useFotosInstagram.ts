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
 *
 * Fotos de la carta (desde el 05/11/2026): los platos activos con foto de la
 * marca (tabla "Platos", restaurante/touza) salen también, con id
 * «carta:<id del plato>» y tipo «plato». Sus medidas reales se apuntan al
 * cargar la miniatura (naturalWidth/naturalHeight, anotarMedidasCarta) y se
 * preparan igual (instagram-drive → preparar con origen «carta»).
 */
import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fotoDesdeDrive, fotoPreparable, fotosDe, fotosDesdePlatos, type FilaPlatoFoto, type FormatoId, type Foto, type MarcaId } from "@/lib/instagram";
import { listarFotosDrive, prepararFotoCarta, prepararFotoDrive, type FotoPreparada } from "./api";

/** Prefijo de las claves de React Query de la biblioteca de Drive. */
export const CLAVE_FOTOS = ["instagram_drive_fotos"] as const;
export const claveFotosDrive = (marca: MarcaId) => [...CLAVE_FOTOS, marca] as const;
export const CLAVE_PREPARADA = ["instagram_drive_preparada"] as const;
/** Clave de la copia preparada: el id de la foto («drive:…» o «carta:…»). */
export const clavePreparada = (idFoto: string) => [...CLAVE_PREPARADA, idFoto] as const;
export const claveFotosCarta = (marca: MarcaId) => ["instagram_carta_fotos", marca] as const;
/** Medidas reales de las fotos de la carta ya vistas (por id de plato). */
export const CLAVE_MEDIDAS_CARTA = ["instagram_carta_medidas"] as const;
type MedidasCarta = Record<string, { ancho: number; alto: number }>;

/** Apunta las medidas reales de la foto de un plato (al cargar su miniatura). */
export function anotarMedidasCarta(qc: QueryClient, platoId: string, ancho: number, alto: number) {
  if (!Number.isInteger(ancho) || !Number.isInteger(alto) || ancho <= 0 || alto <= 0) return;
  const actual = qc.getQueryData<MedidasCarta>(CLAVE_MEDIDAS_CARTA) ?? {};
  const previa = actual[platoId];
  if (previa && previa.ancho === ancho && previa.alto === alto) return;
  qc.setQueryData<MedidasCarta>(CLAVE_MEDIDAS_CARTA, { ...actual, [platoId]: { ancho, alto } });
}

/** Platos activos con foto de la marca (como el usuario: decide la RLS de "Platos"). */
export function usePlatosConFoto(marca: MarcaId) {
  return useQuery({
    queryKey: claveFotosCarta(marca),
    queryFn: async (): Promise<FilaPlatoFoto[]> => {
      const { data, error } = await supabase
        .from("Platos")
        .select("id,nombre,categoria,imagen_url,activado,restaurante,touza")
        .eq("activado", true)
        .eq(marca === "touza" ? "touza" : "restaurante", true)
        .not("imagen_url", "is", null)
        .order("nombre", { ascending: true })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as FilaPlatoFoto[];
    },
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

function useMedidasCarta(): MedidasCarta {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CLAVE_MEDIDAS_CARTA,
    queryFn: () => qc.getQueryData<MedidasCarta>(CLAVE_MEDIDAS_CARTA) ?? {},
    initialData: {} as MedidasCarta,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return data;
}
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
  const platos = usePlatosConFoto(marca);
  const medidas = useMedidasCarta();
  const carta = useMemo(() => fotosDesdePlatos(platos.data ?? [], marca, medidas), [platos.data, marca, medidas]);
  const catalogo = useMemo(() => [...(consulta.data?.fotos ?? []), ...carta], [consulta.data, carta]);
  const fotos = useMemo(() => fotosDe(marca, formato, catalogo), [marca, formato, catalogo]);
  return {
    fotos,
    catalogo,
    alcance: consulta.data?.alcance ?? null,
    avisos: consulta.data?.avisos ?? [],
    cargando: consulta.isLoading,
    /** Error de Google Drive. */
    error: consulta.error as Error | null,
    cargandoCarta: platos.isLoading,
    errorCarta: platos.error as Error | null,
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
 * Prepara (copia al bucket) la foto de Drive o de la carta elegida. Devuelve
 * la foto lista para pintar, o el estado de la preparación. Para el resto de
 * fotos no hace nada.
 */
export function useFotoPreparada(marca: MarcaId, idFoto: string, catalogo: readonly Foto[]) {
  const origen = fotoPreparable(idFoto);
  const idPreparable = origen ? idFoto : null;
  const base = catalogo.find((f) => f.id === idFoto) ?? null;
  const consulta = useQuery({
    queryKey: clavePreparada(idPreparable ?? ""),
    queryFn: () => (origen?.origen === "carta" ? prepararFotoCarta(marca, origen.id) : prepararFotoDrive(marca, origen!.id)),
    enabled: !!origen && !!base && !base.problema,
    staleTime: VIDA_PREPARADA_MS,
    gcTime: VIDA_PREPARADA_MS,
    retry: 1,
  });
  const lista = useMemo<FotoLista | null>(() => {
    if (!idPreparable || !base || !consulta.data?.ruta) return null;
    const ancho = base.ancho || consulta.data.ancho || 0;
    const alto = base.alto || consulta.data.alto || 0;
    const foto: Foto = { ...base, ruta: consulta.data.ruta, ancho, alto };
    return { foto, ruta: consulta.data.ruta, preparada: { id: base.id, url: consulta.data.url, ancho, alto, tipo: base.tipo, marca: base.marca } };
  }, [idPreparable, base, consulta.data]);
  return { esDrive: origen?.origen === "drive", esCarta: origen?.origen === "carta", lista, preparando: !!idPreparable && consulta.isLoading, error: consulta.error as Error | null };
}
