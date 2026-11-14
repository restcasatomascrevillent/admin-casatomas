import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import {
  cambiarEstadoPeticion,
  crearPeticion,
  leerMisPeticiones,
  leerTickets,
  marcarEnAnalisis,
  pedirAnalisis,
  type NuevaPeticion,
  type Peticion,
} from "@/lib/peticiones";
import type { EstadoPeticion } from "../../supabase/functions/_shared/peticiones";

export const CLAVE_PETICIONES = "peticiones";
const CLAVE_MIAS = [CLAVE_PETICIONES, "mias"] as const;
const CLAVE_TICKETS = [CLAVE_PETICIONES, "tickets"] as const;

/** Peticiones del usuario que ha iniciado sesión. */
export function useMisPeticiones() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...CLAVE_MIAS, user?.id ?? null],
    queryFn: () => leerMisPeticiones(user!.id),
    enabled: !!user?.id,
  });
}

/** Todas las peticiones (Super Admin › Tickets). Mientras alguna se analiza, se refresca cada 5 s. */
export function useTickets() {
  return useQuery({
    queryKey: CLAVE_TICKETS,
    queryFn: leerTickets,
    refetchInterval: (q) =>
      (q.state.data as Peticion[] | undefined)?.some((p) => p.analisis_estado === "analizando") ? 5000 : false,
  });
}

/** Guarda la petición y lanza el análisis de la IA en segundo plano (sin esperar). */
export function useCrearPeticion() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (d: NuevaPeticion) => {
      if (!user?.id) throw new Error("Tu sesión ha caducado: vuelve a entrar y envíala otra vez.");
      return crearPeticion(d, user.id);
    },
    onSuccess: (p) => {
      // Si falla o se corta, el super admin lo ve como pendiente y se lanza al abrir el ticket.
      void pedirAnalisis(p.id).catch((e) => console.warn("[peticiones] análisis no lanzado:", e));
      void qc.invalidateQueries({ queryKey: [CLAVE_PETICIONES] });
    },
  });
}

export function useCambiarEstadoPeticion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, estado, motivo }: { id: string; estado: EstadoPeticion; motivo?: string | null }) => cambiarEstadoPeticion(id, estado, motivo),
    onSettled: () => void qc.invalidateQueries({ queryKey: [CLAVE_PETICIONES] }),
  });
}

export function useMarcarEnAnalisis() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => marcarEnAnalisis(id),
    onSuccess: (cambio) => {
      if (cambio) void qc.invalidateQueries({ queryKey: [CLAVE_PETICIONES] });
    },
  });
}

/** Análisis de la IA: sin `forzar`, solo si está pendiente; con `forzar`, «Volver a analizar» (super admin). */
export function useAnalizarPeticion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, forzar }: { id: string; forzar?: boolean }) => pedirAnalisis(id, !!forzar),
    onMutate: ({ id }) => {
      // Se ve «Analizando…» al momento (y la lista empieza a refrescarse sola).
      qc.setQueryData<Peticion[]>(CLAVE_TICKETS, (prev) => prev?.map((p) => (p.id === id ? { ...p, analisis_estado: "analizando", analisis_error: null } : p)));
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: [CLAVE_PETICIONES] }),
  });
}
