import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

// ============================================================================
// SUGERENCIAS DE BLACKLIST — bandeja de aprobación
// ============================================================================
// Un proceso diario (supabase/functions/emails-reserva/index.ts +
// ausencias.ts — NO tocados por este encargo, es de otro agente) detecta
// ausencias sin avisar y crea una fila en `sugerencias_blacklist` con un
// snapshot del historial del cliente (`historial`, ver
// `resumirHistorialCliente`/`ResumenHistorialCliente` en ausencias.ts — de
// ahí salen los nombres de campo de `HistorialClienteSugerencia` de abajo,
// no son un contrato inventado aquí). El sistema PROPONE; una persona
// decide con `fn_aprobar_sugerencia_blacklist` / `fn_rechazar_sugerencia_...`
// (migración 20260920010000_sistema_emails_reserva.sql, aún no aplicada —
// no la toca este encargo tampoco).
// ============================================================================

/**
 * Snapshot de historial que arma `resumirHistorialCliente` (ausencias.ts) en
 * el momento de crear la sugerencia. Todos los campos opcionales: si algún
 * día ese productor cambia de forma, la bandeja sigue renderizando lo que
 * reconoce y no se rompe por un campo nuevo o ausente.
 */
export interface HistorialClienteSugerencia {
  total_reservas_previas?: number;
  no_shows_previos?: number;
  completadas_previas?: number;
  canceladas_previas?: number;
  es_primera_falta?: boolean;
  [clave: string]: unknown;
}

export interface SugerenciaBlacklist {
  id: string;
  reserva_id: string;
  telefono: string | null;
  email: string | null;
  nombre_cliente: string | null;
  motivo: string;
  historial: HistorialClienteSugerencia | null;
  estado: "pendiente" | "aprobada" | "rechazada";
  blacklist_id: string | null;
  creada_at: string;
  revisada_por: string | null;
  revisada_at: string | null;
  nota_revision: string | null;
}

const TABLA = "sugerencias_blacklist";

export const MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE =
  "Las sugerencias automáticas de lista negra no están disponibles todavía: falta aplicar una migración pendiente en la base de datos.";

/**
 * ¿El error viene de que la migración 20260920010000 (tabla
 * `sugerencias_blacklist` + funciones de aprobar/rechazar) no está aplicada?
 * Cubre tabla ausente (42P01, PGRST205) y función ausente (42883, PGRST202)
 * — mismo patrón que `esErrorMigracionReservasFaltante`
 * (useVerificacionReservas.ts) / `esErrorColumnaEscaleraFaltante`
 * (useConfiguracionTurnos.ts).
 */
export function esErrorMigracionSugerenciasFaltante(error: unknown): boolean {
  const mensaje = String((error as { message?: string } | null)?.message ?? "");
  const codigo = String((error as { code?: string } | null)?.code ?? "");
  return (
    codigo === "42P01" ||
    codigo === "PGRST205" ||
    codigo === "42883" ||
    codigo === "PGRST202" ||
    /sugerencias_blacklist|fn_aprobar_sugerencia_blacklist|fn_rechazar_sugerencia_blacklist/.test(mensaje)
  );
}

function erroraLegible(error: unknown, prefijo: string): Error {
  if (esErrorMigracionSugerenciasFaltante(error)) return new Error(MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE);
  const mensaje = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error);
  return new Error(`${prefijo}: ${mensaje}`);
}

/**
 * Sugerencias pendientes de revisar, más antigua primero (cola FIFO: la
 * ausencia más vieja sin resolver se ve primero).
 *
 * Si la migración no está aplicada, la query LANZA (no devuelve `[]`
 * silenciosamente): una bandeja vacía por "no hay sugerencias" y una bandeja
 * vacía por "esto no existe todavía" son dos cosas distintas y el panel
 * tiene que poder contarlas aparte (mismo motivo que documenta
 * `EstadoErrorCarga.tsx`: un fallo pintado como dato vacío es peor que un
 * error visible).
 */
export function useSugerenciasBlacklistPendientes() {
  return useQuery({
    queryKey: ["sugerencias-blacklist", "pendiente"],
    queryFn: async (): Promise<SugerenciaBlacklist[]> => {
      const { data, error } = await supabase
        .from(TABLA as any)
        .select("*")
        .eq("estado", "pendiente")
        .order("creada_at", { ascending: true });

      if (error) throw erroraLegible(error, "No se pudieron cargar las sugerencias de lista negra");
      return (data ?? []) as unknown as SugerenciaBlacklist[];
    },
    retry: (failureCount, error) => {
      // Si es la migración pendiente, reintentar no lo va a arreglar.
      if (error instanceof Error && error.message === MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE) return false;
      return failureCount < 2;
    },
  });
}

interface AprobarPayload {
  id: string;
  /** "YYYY-MM-DD". Obligatorio: la función del backend rechaza `caduca_el` nulo o pasado. */
  caducaEl: string;
  motivo?: string;
}

/** Aprueba una sugerencia: dado de alta en `blacklist` + marca la sugerencia como 'aprobada'. Atómico en el backend. */
export function useAprobarSugerenciaBlacklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, caducaEl, motivo }: AprobarPayload) => {
      const { data, error } = await supabase.rpc("fn_aprobar_sugerencia_blacklist" as any, {
        p_sugerencia_id: id,
        p_caduca_el: caducaEl,
        p_motivo: motivo?.trim() || null,
      });
      if (error) throw erroraLegible(error, "No se pudo aprobar la sugerencia");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sugerencias-blacklist"] });
      // Misma queryKey que useBlacklist() (useBlacklist.ts): la tabla de
      // lista negra se refresca sola y ya enseña la entrada recién aprobada.
      queryClient.invalidateQueries({ queryKey: ["blacklist"] });
      toast.success("Sugerencia aprobada: añadido a la lista negra");
    },
    onError: (error: Error) => {
      toast.error(mensajeUsuario(error));
    },
  });
}

interface RechazarPayload {
  id: string;
  nota?: string;
}

/**
 * Rechaza una sugerencia sin tocar `blacklist`. No hace falta lógica extra
 * para "no volver a proponer lo mismo mañana": `sugerencias_blacklist` tiene
 * un índice único por `reserva_id` y el detector diario se salta (23505,
 * idempotente) cualquier reserva que ya tenga sugerencia, esté en el estado
 * que esté — rechazar ya la saca para siempre de la bandeja de pendientes.
 */
export function useRechazarSugerenciaBlacklist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, nota }: RechazarPayload) => {
      const { data, error } = await supabase.rpc("fn_rechazar_sugerencia_blacklist" as any, {
        p_sugerencia_id: id,
        p_nota: nota?.trim() || null,
      });
      if (error) throw erroraLegible(error, "No se pudo rechazar la sugerencia");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sugerencias-blacklist"] });
      toast.success("Sugerencia descartada");
    },
    onError: (error: Error) => {
      toast.error(mensajeUsuario(error));
    },
  });
}
