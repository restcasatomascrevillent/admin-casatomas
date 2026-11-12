import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { REFRESCO_PERIODICO } from "@/lib/realtimeCanal";
import { claveDia } from "@/lib/reservas/libroReservas";

// ============================================================================
// BUSCAR EN TODO EL HISTÓRICO Y «PENDIENTES» DE LA LISTA (11/11/2026, petición
// del dueño: «que haya un buscador que busque en todo el histórico, no solo en
// el día que hay cargado… quita el botón Por atender y pon Pendientes»).
// ----------------------------------------------------------------------------
// - `useBuscarReservas(texto)`: nombre, teléfono o email en CUALQUIER fecha, lo
//   más reciente primero (100 como mucho). Desde 2 letras y con una pausa al
//   escribir, para no lanzar una consulta por tecla.
// - `useReservasPorEstado(estado)`: las de un estado de hoy en adelante (lo que
//   pinta «Pendientes» y los enlaces de los avisos, p. ej. «canceladas»).
// Las dos claves empiezan por "reservas-lista": las acciones y el editor ya la
// invalidan al guardar (`CLAVES_LISTAS_RESERVAS`), así lo cambiado se ve al momento.
// ============================================================================

export const MIN_LETRAS_BUSQUEDA = 2;
const LIMITE_RESULTADOS = 100;
const COLUMNAS = "id, fecha, hora, nombre, telefono, email, numero_comensales, estado, espacio_id, notas_cliente, created_at, canal";

export interface ReservaEncontrada {
  id: string;
  fecha: string;
  hora: string;
  nombre: string | null;
  telefono: string | null;
  email: string | null;
  numero_comensales: number;
  estado: string;
  espacio_id: string | null;
  notas_cliente: string | null;
  /** Cuándo se hizo (12/11/2026: se enseña en la fila). */
  created_at?: string | null;
  canal?: string | null;
}

/**
 * El texto listo para el filtro `or` de PostgREST: sin los caracteres que lo rompen (coma, paréntesis,
 * comillas, dos puntos) ni comodines; si es un teléfono («612 34 56»), sin espacios. `null` si no llega a 2.
 */
export function textoParaBuscar(texto: string): string | null {
  let t = texto.replace(/[,()*%_:"'\\]/g, " ").replace(/\s+/g, " ").trim();
  if (/^[+\d\s]+$/.test(t)) t = t.replace(/\s/g, "");
  return t.length >= MIN_LETRAS_BUSQUEDA ? t : null;
}

function aReserva(r: Record<string, unknown>): ReservaEncontrada {
  return {
    id: String(r.id),
    fecha: String(r.fecha).slice(0, 10),
    hora: String(r.hora ?? ""),
    nombre: (r.nombre as string | null) ?? null,
    telefono: (r.telefono as string | null) ?? null,
    email: (r.email as string | null) ?? null,
    numero_comensales: Number(r.numero_comensales) || 0,
    estado: String(r.estado ?? ""),
    espacio_id: (r.espacio_id as string | null) ?? null,
    notas_cliente: (r.notas_cliente as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    canal: (r.canal as string | null) ?? null,
  };
}

/** El valor, pero solo cuando lleva `ms` sin cambiar (mientras se escribe, el anterior). */
function useConPausa<T>(valor: T, ms: number): T {
  const [quieto, setQuieto] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setQuieto(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return quieto;
}

export function useBuscarReservas(texto: string) {
  const termino = textoParaBuscar(useConPausa(texto, 300));
  const query = useQuery({
    queryKey: ["reservas-lista", "buscar", termino],
    enabled: !!termino,
    staleTime: 30_000,
    queryFn: async (): Promise<ReservaEncontrada[]> => {
      const patron = `%${termino}%`;
      const { data, error } = await supabase
        .from("reservas")
        .select(COLUMNAS)
        .or(`nombre.ilike.${patron},telefono.ilike.${patron},email.ilike.${patron}`)
        .order("fecha", { ascending: false })
        .order("hora", { ascending: false })
        .limit(LIMITE_RESULTADOS);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(aReserva);
    },
  });
  return { ...query, termino, escribiendo: textoParaBuscar(texto) !== termino, limite: LIMITE_RESULTADOS };
}

export function useReservasPorEstado(estado: string | null) {
  return useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: ["reservas-lista", "estado", estado],
    enabled: !!estado,
    queryFn: async (): Promise<ReservaEncontrada[]> => {
      const { data, error } = await supabase
        .from("reservas")
        .select(COLUMNAS)
        .eq("estado", estado as string)
        .gte("fecha", claveDia(new Date()))
        .order("fecha", { ascending: true })
        .order("hora", { ascending: true })
        .limit(200);
      if (error) throw error;
      return ((data ?? []) as Record<string, unknown>[]).map(aReserva);
    },
  });
}

/** Agrupa por día manteniendo el orden en que llegan. */
export function agruparPorDia(reservas: readonly ReservaEncontrada[]): { fecha: string; reservas: ReservaEncontrada[] }[] {
  const grupos: { fecha: string; reservas: ReservaEncontrada[] }[] = [];
  for (const r of reservas) {
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.fecha === r.fecha) ultimo.reservas.push(r);
    else grupos.push({ fecha: r.fecha, reservas: [r] });
  }
  return grupos;
}
