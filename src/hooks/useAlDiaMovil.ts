import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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
//     de app) se refresca al momento, y cada 15 s SOLO mientras se ve la pantalla.
// ============================================================================

// Literales a propósito (= CLAVE_ASIGNACIONES_MESA y CLAVE_AJUSTES_MESA): importar las constantes
// rompía los tests que simulan esos módulos.
export const CLAVES_AL_DIA_MOVIL = ["reservas-hoy", "asignaciones_mesa", "ajustes_mesa_servicio", "salas_cerradas_servicio"];
export const SONDEO_MOVIL_MS = 15_000;
const TABLAS = ["ajustes_mesa_servicio", "salas_cerradas_servicio"] as const;

export function useAlDiaMovil(activo = true): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!activo) return;
    const visible = () => typeof document === "undefined" || document.visibilityState === "visible";
    const refrescar = () => {
      for (const clave of CLAVES_AL_DIA_MOVIL) void qc.invalidateQueries({ queryKey: [clave] });
    };
    const alVolver = () => {
      if (visible()) refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    const sondeo = window.setInterval(alVolver, SONDEO_MOVIL_MS);
    const canales = TABLAS.map((tabla) =>
      supabase
        .channel(`hoy-movil-${tabla}-${Math.random().toString(36).slice(2)}`)
        .on("postgres_changes" as never, { event: "*", schema: "public", table: tabla } as never, refrescar)
        .subscribe(),
    );
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.clearInterval(sondeo);
      for (const c of canales) void supabase.removeChannel(c);
    };
  }, [qc, activo]);
}
