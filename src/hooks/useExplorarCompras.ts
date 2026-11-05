// Datos del explorador de Facturas › Análisis (RPC `explorar_compras`) y de
// «Ver documentos» (RPC `documentos_de_cifra`), migración 20261105170000.
//
// El explorador cambia AL INSTANTE: los parámetros se retrasan 250 ms (tocar
// tres controles seguidos hace una sola llamada) y mientras llega la respuesta
// se queda la gráfica anterior (placeholderData), sin parpadeo.
import { useCallback, useEffect, useState } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { esErrorRpcInexistente } from "@/lib/facturas/preguntasRapidas";
import {
  CLAVE_EXPLORACIONES_FIJADAS,
  fijarExploracion,
  normalizarExploracion,
  normalizarExploracionesFijadas,
  type ConfigExplorador,
  type Exploracion,
  type ExploracionFijada,
  type ParametrosExplorar,
} from "@/lib/facturas/explorador";
import { argumentosRpc, normalizarPaginaDocumentos, type PaginaDocumentos, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";

export const TEXTO_EXPLORADOR_SIN_MIGRACION =
  "El explorador aún no está activado en esta base de datos: falta aplicar la migración 20261105170000_explorar_compras.";

/** supabase.rpc sin los tipos generados (estas RPC no están en types.ts, que se mantiene a mano). */
async function rpc(funcion: string, args: Record<string, unknown>) {
  const llamar = supabase.rpc as unknown as (
    this: typeof supabase,
    fn: string,
    a?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  return llamar.call(supabase, funcion, args);
}

/** El valor, pero con `ms` de retraso desde el último cambio. */
export function useValorRetrasado<T>(valor: T, ms = 250): T {
  const [retrasado, setRetrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setRetrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return retrasado;
}

/**
 * La gráfica del explorador. Además de lo de react-query, `alDia`: los datos
 * son de los parámetros de AHORA (ni están en los 250 ms de espera ni son los
 * anteriores que se enseñan mientras llegan los nuevos). Si no lo están, sus
 * cifras no se pueden tocar: sus documentos serían de otra consulta.
 */
export function useExplorarCompras(params: ParametrosExplorar, opciones: { retraso?: number; activo?: boolean } = {}) {
  const clave = JSON.stringify(params);
  const claveRetrasada = useValorRetrasado(clave, opciones.retraso ?? 250);
  const q = useQueryExplorar(claveRetrasada, opciones.activo ?? true);
  return Object.assign(q, { alDia: clave === claveRetrasada && !q.isPlaceholderData });
}

function useQueryExplorar(claveRetrasada: string, activo: boolean) {
  return useQuery({
    queryKey: ["explorar-compras", claveRetrasada],
    enabled: activo,
    staleTime: 5 * 60_000,
    placeholderData: keepPreviousData,
    retry: (n, e) => !(e instanceof Error && e.message === TEXTO_EXPLORADOR_SIN_MIGRACION) && n < 1,
    queryFn: async (): Promise<Exploracion> => {
      const { data, error } = await rpc("explorar_compras", JSON.parse(claveRetrasada) as Record<string, unknown>);
      if (esErrorRpcInexistente(error)) throw new Error(TEXTO_EXPLORADOR_SIN_MIGRACION);
      if (error) throw new Error(error.message || "No se ha podido calcular la gráfica");
      return normalizarExploracion(data);
    },
  });
}

export const DOCUMENTOS_POR_PAGINA = 50;

export function useDocumentosDeCifra(peticion: PeticionDocumentos | null) {
  return useInfiniteQuery({
    queryKey: ["documentos-de-cifra", peticion ? JSON.stringify(argumentosRpc(peticion, DOCUMENTOS_POR_PAGINA, 0)) : null],
    enabled: !!peticion,
    staleTime: 5 * 60_000,
    retry: false,
    initialPageParam: 0,
    getNextPageParam: (ultima: PaginaDocumentos) => {
      const siguiente = ultima.desplazamiento + ultima.filas.length;
      return ultima.filas.length > 0 && siguiente < ultima.documentos ? siguiente : undefined;
    },
    queryFn: async ({ pageParam }): Promise<PaginaDocumentos> => {
      const { data, error } = await rpc("documentos_de_cifra", argumentosRpc(peticion as PeticionDocumentos, DOCUMENTOS_POR_PAGINA, pageParam));
      if (esErrorRpcInexistente(error)) throw new Error(TEXTO_EXPLORADOR_SIN_MIGRACION);
      if (error) throw new Error(error.message || "No se han podido leer los documentos");
      return normalizarPaginaDocumentos(data);
    },
  });
}

/** Proveedores para el filtro (id y nombre), los 245 de una vez: la lista se filtra en el navegador. */
export function useProveedoresFiltro(activo: boolean) {
  return useQuery({
    queryKey: ["explorar-compras", "proveedores"],
    enabled: activo,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<{ id: number; nombre: string }[]> => {
      const { data, error } = await supabase.from("proveedores").select("id, nombre").order("nombre");
      if (error) throw new Error(error.message);
      return (data ?? []).map((p) => ({ id: Number(p.id), nombre: String(p.nombre ?? "") })).filter((p) => p.nombre);
    },
  });
}

/** Familias (las categorías raíz del catálogo), en su orden. */
export function useFamiliasFiltro(activo: boolean) {
  return useQuery({
    queryKey: ["explorar-compras", "familias"],
    enabled: activo,
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<{ id: number; nombre: string }[]> => {
      const { data, error } = await supabase.from("categorias_producto").select("id, nombre").is("padre_id", null).order("orden");
      if (error) throw new Error(error.message);
      return (Array.isArray(data) ? data : [])
        .map((f) => ({ id: Number((f as { id: unknown }).id), nombre: String((f as { nombre: unknown }).nombre ?? "") }))
        .filter((f) => Number.isInteger(f.id) && f.nombre);
    },
  });
}

// ─── Gráficas del explorador fijadas en el tablero (este navegador) ─────────

function leer(): ExploracionFijada[] {
  try {
    const crudo = window.localStorage.getItem(CLAVE_EXPLORACIONES_FIJADAS);
    return normalizarExploracionesFijadas(crudo ? JSON.parse(crudo) : []);
  } catch {
    return [];
  }
}

function guardar(lista: ExploracionFijada[]) {
  try {
    window.localStorage.setItem(CLAVE_EXPLORACIONES_FIJADAS, JSON.stringify(lista));
  } catch {
    // Modo privado o cuota llena: se fija igual, solo que no sobrevive a recargar.
  }
}

export function useExploracionesFijadas() {
  const [fijadas, setFijadas] = useState<ExploracionFijada[]>(leer);
  const fijar = useCallback((c: ConfigExplorador) => {
    setFijadas((prev) => {
      const sig = fijarExploracion(prev, c);
      if (sig !== prev) guardar(sig);
      return sig;
    });
  }, []);
  const quitar = useCallback((id: string) => {
    setFijadas((prev) => {
      const sig = prev.filter((g) => g.id !== id);
      guardar(sig);
      return sig;
    });
  }, []);
  return { fijadas, fijar, quitar };
}
