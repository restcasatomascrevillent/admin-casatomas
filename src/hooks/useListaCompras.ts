// ============================================================================
//  Facturas › Compras — datos de la lista, la ficha y la búsqueda (05/11/2026)
// ----------------------------------------------------------------------------
//  · useListaCompras(): TODAS las cabeceras en una petición (`documentos_lista()`,
//    ≈ 0,5 MB, < 0,1 s en la base). Se pinta al instante con la copia guardada
//    en el dispositivo (copiaListaCompras.ts) y se refresca por detrás.
//  · useDocumentoCompras(id): la ficha con sus líneas (`documento_compras(id)`),
//    al abrirla; `usePrecargarDocumento()` la pide al pasar o pulsar la fila.
//  · useBusquedaLineas(texto): ids de documentos cuyas LÍNEAS (o cabecera)
//    casan con el texto (`buscar_documentos_compras`), con espera de 250 ms.
//  Sin la migración 20261105190000 todo cae a la carga de antes (documentos
//  completos), con los mismos datos y criterios.
//
//  Claves bajo ['facturas', …]: las mutaciones que invalidan ['facturas']
//  refrescan la lista, las fichas y las búsquedas de una vez.
// ============================================================================
import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { aFacturaDetalle, leerDocumentosCompletos, type Factura } from "@/hooks/useFacturas";
import { useUsuarioIdOpcional } from "@/hooks/useAuth";
import {
  decodificarLista,
  decodificarMesesIncompletos,
  faltaFuncionCompras,
  listaDesdeCompletos,
  reintentarConsulta,
  type CabeceraDocumento,
} from "@/lib/facturas/listaCompras";
import { guardarCopiaLista, leerCopiaLista } from "@/lib/facturas/copiaListaCompras";
import { normalizarBusqueda } from "@/lib/facturas/productos";

export const CLAVE_LISTA_COMPRAS = ["facturas", "lista"] as const;
export const claveDocumentoCompras = (id: number) => ["facturas", "documento", id] as const;
const claveBusqueda = (texto: string) => ["facturas", "busqueda", texto] as const;

/** 2 minutos: no se vuelve a pedir al cambiar de pestaña. */
const FRESCO = 2 * 60_000;
/** La lista sigue en memoria media hora sin nadie mirándola (reabrir = instantáneo). */
const EN_MEMORIA = 30 * 60_000;
/** Espera tras la última tecla antes de buscar en las líneas. */
export const ESPERA_BUSQUEDA_MS = 250;

export interface ListaCompras {
  cabeceras: CabeceraDocumento[];
  /** Solo sin la migración: los documentos completos de la carga de antes (las fichas salen de aquí). */
  completos: Map<number, Factura> | null;
  /** «AAAA-MM» de los meses con muchos menos documentos de lo normal (20261106310000); vacío sin la migración. */
  mesesIncompletos?: ReadonlySet<string>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

async function leerLista(usuario: string | null): Promise<ListaCompras> {
  const { data, error } = await rpc("documentos_lista");
  if (!error) {
    const cabeceras = decodificarLista(data);
    guardarCopiaLista(usuario, data);
    return { cabeceras, completos: null, mesesIncompletos: decodificarMesesIncompletos(data) };
  }
  if (!faltaFuncionCompras(error)) throw error;
  // Sin la migración 20261105190000: la carga de antes, facturas y albaranes a la vez.
  const [facturas, albaranes] = await Promise.all([leerDocumentosCompletos("factura"), leerDocumentosCompletos("albaran")]);
  return listaDesdeCompletos(facturas, albaranes);
}

/** La copia guardada de este usuario, decodificada (o undefined). */
function copiaInicial(usuario: string | null): { datos: ListaCompras; guardado: number } | undefined {
  const c = leerCopiaLista(usuario);
  if (!c) return undefined;
  try {
    return {
      datos: { cabeceras: decodificarLista(c.crudo), completos: null, mesesIncompletos: decodificarMesesIncompletos(c.crudo) },
      guardado: c.guardado,
    };
  } catch {
    return undefined;
  }
}

/**
 * `retry` de las consultas de Compras: sin reintentar errores definitivos
 * (sin permiso, 4xx; `reintentarConsulta`). Si el cliente tiene los reintentos
 * apagados (pruebas), se respeta.
 */
export function opcionReintento(qc: QueryClient): false | ((fallos: number, error: unknown) => boolean) {
  return qc.getDefaultOptions().queries?.retry === false ? false : reintentarConsulta;
}

/** Todas las cabeceras de documentos (facturas y albaranes), la más reciente primero. */
export function useListaCompras() {
  const qc = useQueryClient();
  const usuario = useUsuarioIdOpcional();
  // Se lee una vez por montaje (el JSON.parse de ~0,5 MB no se repite en cada render).
  const [copia] = useState(() => copiaInicial(usuario));
  return useQuery({
    queryKey: CLAVE_LISTA_COMPRAS,
    queryFn: () => leerLista(usuario),
    initialData: copia?.datos,
    // La copia cuenta como «vieja»: se pinta y se refresca enseguida por detrás.
    initialDataUpdatedAt: copia?.guardado,
    staleTime: FRESCO,
    gcTime: EN_MEMORIA,
    // Sin reintentar errores definitivos (sin permiso, 4xx): se avisa enseguida.
    retry: opcionReintento(qc),
  });
}

async function leerDocumento(qc: QueryClient, id: number): Promise<Factura | null> {
  const lista = qc.getQueryData<ListaCompras>(CLAVE_LISTA_COMPRAS);
  if (lista?.completos) return lista.completos.get(id) ?? null;
  const { data, error } = await rpc("documento_compras", { p_id: id });
  if (error) {
    if (!faltaFuncionCompras(error)) throw error;
    // Sin la migración: de la carga de antes (se pide si aún no estaba).
    const completa = await qc.fetchQuery({ queryKey: CLAVE_LISTA_COMPRAS, queryFn: () => leerLista(null), staleTime: FRESCO });
    return completa.completos?.get(id) ?? null;
  }
  return data && typeof data === "object" ? aFacturaDetalle(data as Record<string, unknown>) : null;
}

const opcionesDocumento = (qc: QueryClient, id: number) => ({
  queryKey: claveDocumentoCompras(id),
  queryFn: () => leerDocumento(qc, id),
  staleTime: FRESCO,
  gcTime: EN_MEMORIA,
  retry: opcionReintento(qc),
});

/** La ficha de un documento con sus líneas (null = no existe o no se puede ver). */
export function useDocumentoCompras(id: number | null) {
  const qc = useQueryClient();
  return useQuery({ ...opcionesDocumento(qc, id ?? 0), enabled: id !== null });
}

/** Pide la ficha antes de abrirla (al pasar el ratón o al pulsar la fila); si ya está fresca, nada. */
export function usePrecargarDocumento(): (id: number) => void {
  const qc = useQueryClient();
  return (id: number) => void qc.prefetchQuery(opcionesDocumento(qc, id));
}

/** El texto deja de cambiar durante `ms`: entonces vale. */
function useValorAsentado<T>(valor: T, ms: number): T {
  const [asentado, setAsentado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAsentado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return asentado;
}

/**
 * Documentos cuyas líneas (o cabecera) contienen TODAS las palabras del texto,
 * según el servidor. `ids` solo se da cuando corresponde al texto ACTUAL (si no,
 * podría traer documentos de una búsqueda anterior); `buscando` mientras tanto.
 * `activa` = false: no se pide nada (sin texto o con la carga de antes, que ya
 * busca en las líneas que tiene).
 */
export function useBusquedaLineas(
  texto: string,
  activa: boolean,
): { ids: ReadonlySet<number> | null; buscando: boolean; error: unknown; reintentar: () => void } {
  const normal = normalizarBusqueda(texto);
  const asentado = useValorAsentado(normal, ESPERA_BUSQUEDA_MS);
  const q = useQuery({
    queryKey: claveBusqueda(asentado),
    queryFn: async (): Promise<ReadonlySet<number>> => {
      const { data, error } = await rpc("buscar_documentos_compras", { p_texto: asentado });
      if (error) throw error;
      return new Set(((data ?? []) as unknown[]).map(Number));
    },
    enabled: activa && asentado !== "",
    staleTime: FRESCO,
    retry: false,
  });
  const reintentar = () => void q.refetch();
  if (!activa || normal === "") return { ids: null, buscando: false, error: null, reintentar };
  const vigente = asentado === normal && q.data !== undefined;
  const error = asentado === normal ? q.error : null;
  return { ids: vigente ? q.data : null, buscando: !vigente && !error, error, reintentar };
}
