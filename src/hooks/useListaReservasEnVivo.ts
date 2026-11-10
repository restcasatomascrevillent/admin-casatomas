import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { crearInvalidacionDiferida, nombreCanalUnico, vigilarCanal } from "@/lib/realtimeCanal";

// ============================================================================
// LISTA DE RESERVAS EN VIVO: la pestaña «Lista» se pone al día sola
// ----------------------------------------------------------------------------
// Hasta el 10/11/2026 la Lista (`ListaReservasAvanzada`, clave `reservas-lista`)
// no escuchaba nada: una reserva nueva de la web o del bot, o un cambio hecho en
// otro dispositivo, no aparecía hasta volver a la ventana o hacer algo en ella.
// Este hook escucha INSERT/UPDATE/DELETE de `reservas` en su propio canal y
// vuelve a pedir la Lista.
//
// SOLO `reservas`: la Lista lee `select("*")` de esa tabla y nada más (la mesa
// asignada no sale en la Lista), así que `asignaciones_mesa` no le cambia nada.
//
// Por qué no va en `useReservasEnVivo`: la Lista relee TODO el histórico por
// lotes (~1.241 reservas = 2 peticiones; ver `leerReservasLista`), mucho más que
// las consultas de un día de «Hoy». Por eso:
//   · INVALIDACIÓN DIFERIDA (`crearInvalidacionDiferida`, realtimeCanal.ts): 1 s
//     tras el último evento y como mucho 5 s tras el primero pendiente. Una ráfaga
//     = UNA relectura; la carga de la demo (861 altas en un minuto) = una cada 5 s.
//   · CON LA PESTAÑA DEL NAVEGADOR OCULTA (otra delante, tablet bloqueada) no se
//     relee: solo se marca la consulta como caducada (`refetchType: "none"`) y al
//     volver la relee el `refetchOnWindowFocus` de TanStack Query (App.tsx). Hace
//     falta marcarla: con el `staleTime` de 30 s de App.tsx, una lectura reciente
//     no se repetiría al volver.
//   · SIN SONDEO PERIÓDICO: releer el histórico cada minuto «por si acaso» cuesta
//     más que lo que arregla. Si el canal se cae y vuelve (red, tablet dormida),
//     se relee al recuperarse (SUBSCRIBED a partir del segundo): Realtime no
//     reenvía lo perdido. Si `reservas` dejara de estar publicada, el aviso
//     `[realtime]` de la consola lo dice y queda el refresco al volver a la ventana.
//
// Lo que cambia en la pantalla al releer: las filas. La página, las casillas
// marcadas, los filtros y la posición de la tabla se conservan (ver el efecto de
// paginación de `ListaReservasAvanzada`: solo un cambio de filtro vuelve arriba).
//
// Dónde se monta: `ListaReservasAvanzada`. «Hoy» y el Calendario usan
// `useReservasEnVivo`, que a propósito NO refresca la Lista (no se montan a la
// vez: Radix desmonta la pestaña que no se ve).
// ============================================================================

/** Clave de caché de la Lista (la de `useQuery` en `ListaReservasAvanzada`). */
export const CLAVE_LISTA_RESERVAS = "reservas-lista";

/** Prefijo del canal; el nombre lleva además un número propio de cada suscripción. */
export const PREFIJO_CANAL_LISTA_EN_VIVO = "reservas-lista-en-vivo";

/** ¿La pestaña del navegador está oculta? Sin `document` (fuera del navegador) cuenta como visible. */
function pestanaOculta(): boolean {
  return globalThis.document?.visibilityState === "hidden";
}

export function useListaReservasEnVivo(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    const diferida = crearInvalidacionDiferida(() => {
      void queryClient.invalidateQueries({
        queryKey: [CLAVE_LISTA_RESERVAS],
        refetchType: pestanaOculta() ? "none" : "active",
      });
    });

    const nombre = nombreCanalUnico(PREFIJO_CANAL_LISTA_EN_VIVO);
    const vigilancia = vigilarCanal(nombre, {
      tabla: "reservas",
      // La primera vez no: la Lista se acaba de pedir al montar.
      alSuscribirse: (vez) => {
        if (vez > 1) diferida.programar();
      },
    });
    const canal = supabase
      .channel(nombre)
      .on("system", {}, vigilancia.alMensajeSistema)
      .on("postgres_changes", { event: "*", schema: "public", table: "reservas" }, diferida.programar)
      .subscribe(vigilancia.alCambiarEstado);

    return () => {
      diferida.cancelar();
      vigilancia.cerrar(); // ANTES de removeChannel: su CLOSED es síncrono y no debe avisar
      supabase.removeChannel(canal);
    };
  }, [queryClient]);
}
