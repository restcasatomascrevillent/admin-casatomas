import { useCallback, useRef, useState } from "react";
import { buscarPuntuacionParker, ErrorBusquedaParker, hoyMadrid, type PeticionParker, type ResultadoParker } from "./parker";

/**
 * Búsqueda de la puntuación Parker en segundo plano (08/11/2026). Estados:
 *   inactiva  → no se ha buscado.
 *   buscando  → la función está buscando (el formulario sigue usable).
 *   hecha     → hay resultado (verificada, revisión o no localizada).
 *   fallida   → la búsqueda falló; se puede reintentar y guardar la ficha igual.
 * Una búsqueda que vuelve tarde (se cambió la añada o se cerró el formulario)
 * se ignora.
 */
export type FaseBusquedaParker = "inactiva" | "buscando" | "hecha" | "fallida";

export interface EstadoBusquedaParker {
  fase: FaseBusquedaParker;
  resultado: ResultadoParker | null;
  desdeCache: boolean;
  error: string | null;
  /** Lo que se buscó (para enseñar «Buscando … 2021»). */
  peticion: PeticionParker | null;
}

const INICIAL: EstadoBusquedaParker = { fase: "inactiva", resultado: null, desdeCache: false, error: null, peticion: null };

export function useBusquedaParker(buscar: typeof buscarPuntuacionParker = buscarPuntuacionParker) {
  const [estado, setEstado] = useState<EstadoBusquedaParker>(INICIAL);
  const turno = useRef(0);

  const lanzar = useCallback(
    async (peticion: PeticionParker) => {
      const mio = ++turno.current;
      setEstado({ fase: "buscando", resultado: null, desdeCache: false, error: null, peticion });
      try {
        const { resultado, desdeCache } = await buscar(peticion);
        if (mio !== turno.current) return;
        setEstado({ fase: "hecha", resultado, desdeCache, error: null, peticion });
      } catch (e) {
        if (mio !== turno.current) return;
        const mensaje = e instanceof Error && e.message ? e.message : "No se pudo buscar la puntuación";
        const resultado: ResultadoParker = (e instanceof ErrorBusquedaParker && e.resultado) || {
          estado: "fallida",
          motivo: "busqueda_fallida",
          anada: peticion.sin_anada ? null : peticion.anada,
          sin_anada: peticion.sin_anada,
          puntos_texto: null,
          puntos_min: null,
          puntos_max: null,
          provisional: false,
          vino_evaluado: null,
          entidad: "Robert Parker Wine Advocate",
          critico: null,
          fecha_valoracion: null,
          fuente_nombre: null,
          fuente_url: null,
          fuente_tipo: null,
          cita: null,
          fecha_consulta: hoyMadrid(),
          discrepancias: [],
          notas: mensaje,
        };
        setEstado({ fase: "fallida", resultado, desdeCache: false, error: mensaje, peticion });
      }
    },
    [buscar],
  );

  /** Olvida la búsqueda (y descarta la que esté en curso). */
  const limpiar = useCallback(() => {
    turno.current++;
    setEstado(INICIAL);
  }, []);

  return { ...estado, lanzar, limpiar };
}

export type BusquedaParker = ReturnType<typeof useBusquedaParker>;
