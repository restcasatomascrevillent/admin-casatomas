/**
 * Copia al bucket (tmp/) de VARIAS fotos a la vez: la de Drive o la de la
 * carta, como useFotoPreparada pero para las 1–10 de un carrusel. Comparte
 * clave de caché con useFotoPreparada (12 h). La necesitan la vista previa
 * (construirDocumento), «Montar con IA» (URL pública) y el render.
 */
import { useCallback, useMemo } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { fotoPreparable, type Foto, type MarcaId } from "@/lib/instagram";
import { prepararFotoCarta, prepararFotoDrive } from "@/components/marketing/instagram/api";
import { VIDA_PREPARADA_MS, clavePreparada, type FotoLista } from "@/components/marketing/instagram/useFotosInstagram";

type Copia = { ruta: string; url: string; ancho: number | null; alto: number | null };

function opciones(marca: MarcaId, id: string) {
  const origen = fotoPreparable(id);
  return {
    queryKey: clavePreparada(id),
    queryFn: (): Promise<Copia> => {
      if (!origen) return Promise.reject(new Error("Esta foto no se puede preparar."));
      return origen.origen === "carta" ? prepararFotoCarta(marca, origen.id) : prepararFotoDrive(marca, origen.id);
    },
    staleTime: VIDA_PREPARADA_MS,
    gcTime: VIDA_PREPARADA_MS,
    retry: 1,
  };
}

/** Foto del catálogo + su copia → lo que piden la vista previa y el render. */
export function fotoListaDe(base: Foto, copia: Copia): FotoLista {
  // Valen las medidas del fichero preparado (el original de Drive si lo hay).
  const ancho = copia.ancho || base.ancho || 0;
  const alto = copia.alto || base.alto || 0;
  return {
    foto: { ...base, ruta: copia.ruta, ancho, alto },
    ruta: copia.ruta,
    preparada: { id: base.id, url: copia.url, ancho, alto, tipo: base.tipo, marca: base.marca },
  };
}

export interface Preparadas {
  /** Por id de foto: la lista, si ya está. */
  listas: Record<string, FotoLista>;
  /** Por id de foto: el error al copiarla. */
  errores: Record<string, Error>;
  preparando: boolean;
  /** Espera a que estén todas (o lanza con la primera que falle). */
  prepararTodas: () => Promise<Record<string, FotoLista>>;
}

export function usePreparadas(marca: MarcaId, ids: readonly string[], catalogo: readonly Foto[]): Preparadas {
  const qc = useQueryClient();
  const porId = useMemo(() => new Map(catalogo.map((f) => [f.id, f])), [catalogo]);
  const consultas = useQueries({
    queries: ids.map((id) => {
      const base = porId.get(id);
      return { ...opciones(marca, id), enabled: !!fotoPreparable(id) && !!base && !base.problema };
    }),
  });

  // Firma de lo que hay: así `listas` y `errores` solo cambian de identidad cuando cambia algo.
  const firma = ids
    .map((id, i) => `${id}=${consultas[i]?.data?.ruta ?? ""}:${consultas[i]?.error ? "E" : ""}:${consultas[i]?.isLoading ? "C" : ""}:${porId.get(id)?.ancho ?? "-"}x${porId.get(id)?.alto ?? "-"}`)
    .join("|");
  const { listas, errores, preparando } = useMemo(() => {
    const listas: Record<string, FotoLista> = {};
    const errores: Record<string, Error> = {};
    let preparando = false;
    ids.forEach((id, i) => {
      const c = consultas[i];
      const base = porId.get(id);
      if (c?.data?.ruta && base) listas[id] = fotoListaDe(base, c.data);
      else if (c?.error) errores[id] = c.error as Error;
      else if (c?.isLoading || (!base && fotoPreparable(id))) preparando = true;
    });
    return { listas, errores, preparando };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `firma` resume ids, consultas y catálogo.
  }, [firma]);

  const prepararTodas = useCallback(async () => {
    const salida: Record<string, FotoLista> = {};
    await Promise.all(
      ids.map(async (id) => {
        const base = porId.get(id);
        if (!base) throw new Error("Una de las fotos ya no está en la biblioteca: quítala y elige otra.");
        if (base.problema) throw new Error(base.problema);
        const copia = await qc.fetchQuery(opciones(marca, id));
        salida[id] = fotoListaDe(base, copia);
      }),
    );
    return salida;
  }, [ids, porId, qc, marca]);

  return { listas, errores, preparando, prepararTodas };
}
