import { useCallback, useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { mensajeUsuario } from "@/lib/mensaje-usuario";
import {
  aplicarFilasToggles,
  estadoToggles,
  leerTogglesCompartidos,
  suscribirToggles,
  type FilaToggle,
} from "@/lib/precargaToggles";
import { MODULOS_PANEL, valorInterruptor } from "@/lib/modulosPanel";

export type AdminFeatureToggle = FilaToggle;

/**
 * Interruptores de Control del Panel (`admin_feature_toggles`). La lectura es compartida
 * (`lib/precargaToggles.ts`): menú, rutas y Control del Panel ven lo mismo.
 */
export function useAdminFeatureToggles() {
  const { toggles, loading } = useSyncExternalStore(suscribirToggles, estadoToggles, estadoToggles);

  useEffect(() => {
    void leerTogglesCompartidos();
  }, []);

  // Sin fila: el valor del módulo del que hereda (RRSS ← Newsletter, Subir albaranes ← Facturas) o activado.
  const isEnabled = useCallback((sectionKey: string) => valorInterruptor(sectionKey, toggles), [toggles]);

  const setEnabled = async (sectionKey: string, label: string, enabled: boolean) => {
    const { data: userData } = await supabase.auth.getUser();
    const updatedAt = new Date().toISOString();
    const updatedBy = userData.user?.id;

    // RRSS y Subir albaranes iban con el interruptor de Newsletter y Facturas hasta el 14/11/2026. Mientras
    // no tengan fila propia valen lo mismo que ellos: antes de cambiar Newsletter o Facturas se les guarda
    // su valor de ahora, para que no cambien con él.
    const herederos = MODULOS_PANEL.filter(
      (m) => m.heredaDe === sectionKey && !toggles.some((t) => t.section_key === m.clave),
    ).map((m) => ({
      section_key: m.clave,
      label: m.nombre,
      enabled: valorInterruptor(m.clave, toggles),
      updated_at: null,
      updated_by: updatedBy,
    }));

    const { error } = await supabase.from("admin_feature_toggles").upsert(
      [{ section_key: sectionKey, label, enabled, updated_at: updatedAt, updated_by: updatedBy }, ...herederos],
      { onConflict: "section_key" },
    );

    if (error) {
      toast.error("Error al actualizar el módulo: " + mensajeUsuario(error, "inténtalo de nuevo"));
      return false;
    }

    aplicarFilasToggles([
      { section_key: sectionKey, label, enabled, updated_at: updatedAt },
      ...herederos.map(({ section_key, label: etiqueta, enabled: valor }) => ({
        section_key,
        label: etiqueta,
        enabled: valor,
        updated_at: null,
      })),
    ]);

    toast.success(enabled ? `«${label}» activado para el equipo` : `«${label}» desactivado para el equipo`);
    return true;
  };

  const refetch = useCallback(() => leerTogglesCompartidos(true), []);

  return { toggles, loading, isEnabled, setEnabled, refetch };
}
