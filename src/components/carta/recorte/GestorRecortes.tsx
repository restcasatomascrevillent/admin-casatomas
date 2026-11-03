import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { CLAVE_CONSULTA_TABLA, EVENTO_FOTO_RECORTADA, type TablaFoto } from "./recorteMovil";
import { AvisoTrabajosRecorte } from "../potente/AvisoTrabajosRecorte";

/**
 * Recortes de fotos fuera de los formularios (móvil, tras guardar):
 *   - las fotos que un móvil no puede recortar pasan a un TRABAJO para un
 *     ordenador con el panel abierto (recorteEnOrdenador.ts; sin la migración
 *     20261102160000, solo se avisa: «Quitar fondo» desde un ordenador);
 *   - al abrir el panel, detecta un recorte que se quedó a medias porque la
 *     pestaña murió (marca en localStorage sin latido): marca el dispositivo
 *     como «no recorta en el navegador» y esa foto sigue el mismo camino;
 *   - en un ordenador, ofrece recortar aquí esas fotos (AvisoTrabajosRecorte);
 *   - cuando una ficha cambia de foto por un recorte en segundo plano,
 *     refresca la lista de la carta.
 * Los módulos del recorte se cargan bajo demanda (no engordan el arranque).
 */
export function GestorRecortes() {
  const { user } = useAuth();
  const { canAccess } = useCanAccessSection("gestor_carta");
  const queryClient = useQueryClient();
  const [ordenador, setOrdenador] = useState(false);

  useEffect(() => {
    if (!user || !canAccess) return;
    let cancelar: (() => void) | undefined;
    let vivo = true;
    void Promise.all([import("./recorteEnSegundoPlano"), import("./recorteEnOrdenador"), import("./quitarFondoNavegador")]).then(
      ([m, o, q]) => {
        if (!vivo) return;
        m.configurarAlNoRecortar(o.mandarRecorteAOrdenador);
        cancelar = m.recuperarRecorteInterrumpido();
        setOrdenador(q.recorteNavegadorSeguro());
      },
    );
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

  return user && canAccess && ordenador ? <AvisoTrabajosRecorte /> : null;
}
