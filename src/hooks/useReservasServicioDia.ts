import { useEffect, useId } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CLAVE_ASIGNACIONES_MESA } from "@/hooks/useAsignacionesMesa";
import type { ReservaMesaServicio } from "@/lib/reservas/servicioSala";
import { crearInvalidacionDiferida, REFRESCO_PERIODICO, vigilarCanal } from "@/lib/realtimeCanal";

// ============================================================================
// RESERVAS DE UN DÍA PARA EL MODO SERVICIO
// ----------------------------------------------------------------------------
// Trae justo los campos que `servicioSala.ts` necesita para calcular el
// estado de cada mesa — en particular `llegada_at` y `salida_at`, que
// `useAsignacionesMesa` / `useOcupacionSalasDia` NO piden porque no los
// necesitan. Ninguna de las dos columnas está garantizada todavía
// (20260923180000_reservas_llegada.sql y
// 20260926150000_modo_servicio_config_y_salida.sql, ambas sin aplicar a
// 2026-09-26): se piden con `as any` y, si el SELECT fallase por columna
// inexistente, aquí se prefiere no reintentar recortando el select (a
// diferencia de useAccionesServicioReserva con el UPDATE) — el modo servicio
// sin esas dos columnas no puede calcular nada útil, así que el error se deja
// subir y lo enseña React Query como error de carga.
//
// REALTIME: dos suscripciones, mismo patrón que `useOcupacionSalasDia`
// (nombre de canal único por instancia con `useId`, para que dos pantallas
// montadas a la vez no se pisen el canal y el desmontaje de una no cierre la
// de la otra):
//   · `reservas` filtradas por `fecha` — llegada, liberación, cambios de
//     estado o de sala en cualquier reserva del día.
//   · `asignaciones_mesa`, sin filtro de servidor (Realtime de Supabase no
//     deja filtrar por una columna de otra tabla): mover una reserva de mesa
//     desde este mismo componente ya invalida por la mutación, así que esta
//     suscripción cubre sobre todo cambios hechos por OTRA pestaña/persona.
// Cada canal invalida DIFERIDO (1 s tras el último evento, como mucho cada
// 5 s): una ráfaga no relee el modo servicio una vez por evento.
// OJO: el filtro `fecha=eq.X` no deja pasar un DELETE (solo trae el id) ni un
// UPDATE que saque la reserva de ese día; lo cubre el refresco periódico.
//
// RESPALDO SIN REALTIME: `REFRESCO_PERIODICO` (cada minuto con la pestaña a la
// vista): una tablet siempre encendida en el modo servicio nunca dispara el
// refresco por foco de la ventana.
// ============================================================================

export const CLAVE_RESERVAS_SERVICIO_DIA = "reservas-servicio-dia";

export function useReservasServicioDia(fecha: string | null | undefined, espacioId?: string | null) {
  const queryClient = useQueryClient();
  const idCanal = useId();

  const query = useQuery({
    ...REFRESCO_PERIODICO,
    queryKey: [CLAVE_RESERVAS_SERVICIO_DIA, fecha, espacioId ?? null],
    enabled: !!fecha,
    queryFn: async (): Promise<ReservaMesaServicio[]> => {
      let q = (supabase.from("reservas" as any) as any)
        .select(
          "id, nombre, hora, numero_comensales, estado, espacio_id, telefono, email, importante, llegada_at, salida_at, notas_cliente, menu_del_dia",
        )
        .eq("fecha", fecha);
      if (espacioId) q = q.eq("espacio_id", espacioId);

      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id as string,
        nombre: (r.nombre as string | null) ?? null,
        hora: String(r.hora),
        numero_comensales: Number(r.numero_comensales) || 0,
        estado: r.estado as string,
        espacio_id: (r.espacio_id as string | null) ?? null,
        telefono: (r.telefono as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        importante: (r.importante as boolean | null) ?? null,
        llegada_at: (r.llegada_at as string | null) ?? null,
        salida_at: (r.salida_at as string | null) ?? null,
        notas_cliente: (r.notas_cliente as string | null) ?? null,
        menu_del_dia: (r.menu_del_dia as boolean | null) ?? null,
      }));
    },
  });

  useEffect(() => {
    if (!fecha) return;
    // `vigilarCanal`: si un canal no recibe cambios lo dice una vez por consola.
    // Ni `reservas` ni `asignaciones_mesa` están en la publicación
    // `supabase_realtime` hasta la migración 20261001200000 (publica las dos):
    // hasta aplicarla, los dos canales avisarán.
    const diferida = crearInvalidacionDiferida(() => {
      queryClient.invalidateQueries({ queryKey: [CLAVE_RESERVAS_SERVICIO_DIA, fecha] });
    });
    const nombre = `servicio-sala-reservas-${fecha}-${idCanal}`;
    const vigilancia = vigilarCanal(nombre, { tabla: "reservas" });
    const canal = supabase
      .channel(nombre)
      .on("system", {}, vigilancia.alMensajeSistema)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "reservas", filter: `fecha=eq.${fecha}` },
        diferida.programar,
      )
      .subscribe(vigilancia.alCambiarEstado);
    const diferidaAsignaciones = crearInvalidacionDiferida(() => {
      queryClient.invalidateQueries({ queryKey: [CLAVE_ASIGNACIONES_MESA] });
    });
    const nombreAsignaciones = `servicio-sala-asignaciones-${fecha}-${idCanal}`;
    const vigilanciaAsignaciones = vigilarCanal(nombreAsignaciones, { tabla: "asignaciones_mesa" });
    const canalAsignaciones = supabase
      .channel(nombreAsignaciones)
      .on("system", {}, vigilanciaAsignaciones.alMensajeSistema)
      .on("postgres_changes", { event: "*", schema: "public", table: "asignaciones_mesa" }, diferidaAsignaciones.programar)
      .subscribe(vigilanciaAsignaciones.alCambiarEstado);
    return () => {
      diferida.cancelar();
      diferidaAsignaciones.cancelar();
      vigilancia.cerrar();
      vigilanciaAsignaciones.cerrar();
      supabase.removeChannel(canal);
      supabase.removeChannel(canalAsignaciones);
    };
  }, [fecha, idCanal, queryClient]);

  return query;
}
