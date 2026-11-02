import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { CLAVE_CONSULTA_TABLA, EVENTO_FOTO_RECORTADA, type TablaFoto } from "./recorteMovil";

/**
 * Recortes de fotos fuera de los formularios (móvil, tras guardar):
 *   - al abrir el panel, detecta un recorte que se quedó a medias porque la
 *     pestaña murió (marca en localStorage sin latido): marca el dispositivo
 *     como «no recorta en el navegador» y avisa de que la foto se quedó normal;
 *   - cuando una ficha cambia de foto por un recorte en segundo plano,
 *     refresca la lista de la carta.
 * No pinta nada. El módulo del recorte se carga bajo demanda (no engorda el arranque).
 */
export function GestorRecortes() {
  const { user } = useAuth();
  const { canAccess } = useCanAccessSection("gestor_carta");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!user || !canAccess) return;
    let cancelar: (() => void) | undefined;
    let vivo = true;
    void import("./recorteEnSegundoPlano").then((m) => {
      if (vivo) cancelar = m.recuperarRecorteInterrumpido();
    });
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [user, canAccess]);

  useEffect(() => {
    const alRecortar = (ev: Event) => {
      const tabla = (ev as CustomEvent<{ tabla?: TablaFoto }>).detail?.tabla;
      const clave = tabla ? CLAVE_CONSULTA_TABLA[tabla] : undefined;
      if (clave) void queryClient.invalidateQueries({ queryKey: [clave] });
    };
    window.addEventListener(EVENTO_FOTO_RECORTADA, alRecortar);
    return () => window.removeEventListener(EVENTO_FOTO_RECORTADA, alRecortar);
  }, [queryClient]);

  return null;
}
