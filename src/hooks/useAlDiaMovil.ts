import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { estaEnLinea } from "@/hooks/useEnLinea";

// ============================================================================
// AL DÍA SOLO, EN EL MÓVIL DEL CAMARERO (09/10/2026)
// ----------------------------------------------------------------------------
// Durante el servicio cada camarero lleva su móvil; lo que hace uno tiene que
// verlo el otro sin tocar nada:
//   · `reservas` y `asignaciones_mesa` ya llegan en tiempo real
//     (`useReservasEnVivo`, montado en «Hoy»).
//   · `ajustes_mesa_servicio` y `salas_cerradas_servicio`: canal propio aquí
//     (llegan en cuanto se aplique la migración 20261009150000, que las mete en
//     la publicación; hasta entonces el canal no recibe nada).
//   · Respaldo: al volver a primer plano (bloquear/desbloquear el móvil, cambiar
//     de app) se refresca al momento, y cada 30 s SOLO mientras se ve la pantalla.
//
// CON POCA COBERTURA (07/11/2026): antes cada 15 s se INVALIDABAN las 4 claves,
// lo que cancela la petición en vuelo y la vuelve a lanzar: con red lenta no
// terminaba nunca ninguna y el móvil se pasaba el servicio pidiendo. Ahora:
//   · cada 30 s, y nada si el navegador sabe que no hay red;
//   · `refetchQueries` con `cancelRefetch: false`: si ya hay una petición de esa
//     clave en vuelo, se espera a esa en vez de empezar otra;
//   · el sondeo se salta lo que se acaba de leer (realtime, una acción, el
//     regreso a primer plano…) hace menos de `FRESCO_MS`. Las reservas de hoy,
//     en el móvil, ya no tienen además el sondeo de cada minuto (`VistaHoy`).
// ============================================================================

// Literales a propósito (= CLAVE_ASIGNACIONES_MESA y CLAVE_AJUSTES_MESA): importar las constantes
// rompía los tests que simulan esos módulos.
export const CLAVES_AL_DIA_MOVIL = ["reservas-hoy", "asignaciones_mesa", "ajustes_mesa_servicio", "salas_cerradas_servicio"];
export const SONDEO_MOVIL_MS = 30_000;
/** El sondeo no relee lo que llegó hace menos de esto. */
export const FRESCO_MS = 20_000;
const TABLAS = ["ajustes_mesa_servicio", "salas_cerradas_servicio"] as const;

/**
 * Relee las consultas activas de `CLAVES_AL_DIA_MOVIL` sin cancelar las que ya están en vuelo.
 * `soloViejas`: las leídas hace menos de `FRESCO_MS` se dejan (el sondeo). Sin red, nada.
 */
export function refrescarAlDiaMovil(qc: QueryClient, { soloViejas = false, ahora = Date.now() } = {}): void {
  if (!estaEnLinea()) return;
  for (const clave of CLAVES_AL_DIA_MOVIL) {
    void qc.refetchQueries(
      {
        queryKey: [clave],
        type: "active",
        predicate: soloViejas ? (q) => ahora - q.state.dataUpdatedAt >= FRESCO_MS : undefined,
      },
      { cancelRefetch: false },
    );
  }
}

export function useAlDiaMovil(activo = true): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!activo) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    // Un cambio de verdad (realtime): como siempre, se invalida (lo que estuviera en vuelo puede no traerlo).
    const alCambiar = () => {
      for (const clave of CLAVES_AL_DIA_MOVIL) void qc.invalidateQueries({ queryKey: [clave] });
    };
    // Volver a primer plano o recuperar la red: todo lo de la lista, sin pisar lo que ya está en vuelo.
    const alVolver = () => {
      if (visible()) refrescarAlDiaMovil(qc);
    };
    const sondeo = window.setInterval(() => {
      if (visible()) refrescarAlDiaMovil(qc, { soloViejas: true });
    }, SONDEO_MOVIL_MS);
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    // Al recuperar la red, ponerse al día enseguida (no esperar al siguiente sondeo).
    window.addEventListener("online", alVolver);
    const canales = TABLAS.map((tabla) =>
      supabase
        .channel(`hoy-movil-${tabla}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes" as never, { event: "*", schema: "public", table: tabla } as never, alCambiar)
        .subscribe(),
    );
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.removeEventListener("online", alVolver);
      window.clearInterval(sondeo);
      for (const c of canales) void supabase.removeChannel(c);
    };
  }, [qc, activo]);
}
