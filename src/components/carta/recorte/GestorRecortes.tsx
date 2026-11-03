import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { AvisoTrabajosRecorte } from "../potente/AvisoTrabajosRecorte";
import { diag, diagActivo, memoriaDiag, navegadorDiag } from "./diagnostico";

/**
 * Recortes de fotos fuera de los formularios:
 *   - las fotos que se guardaron sin fondo porque el móvil y el servidor
 *     fallaron pasan a un TRABAJO para un ordenador con el panel abierto
 *     (recorteEnOrdenador.ts; sin la migración 20261102160000, solo se avisa:
 *     «Quitar fondo» desde un ordenador);
 *   - al abrir el panel, detecta un recorte del móvil que se quedó a medias
 *     porque el sistema cerró la pestaña (marca sin latido): el móvil queda
 *     marcado y las siguientes fotos van directas al servidor;
 *   - en un ordenador, ofrece recortar aquí esas fotos (AvisoTrabajosRecorte).
 * Los módulos del recorte se cargan bajo demanda (no engordan el arranque).
 */
export function GestorRecortes() {
  const { user } = useAuth();
  const { canAccess } = useCanAccessSection("gestor_carta");
  const [ordenador, setOrdenador] = useState(false);

  // ?diag=recorte: se activa (y se recuerda en la pestaña) al abrir el panel.
  useEffect(() => {
    if (diagActivo()) diag("panel abierto", { navegador: navegadorDiag(), ua: navigator.userAgent, ...memoriaDiag() });
  }, []);

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
      // Sin estos módulos las fotos sin fondo solo se avisan (sin trabajo para un ordenador).
      (e) => console.warn("[recorte] no se pudo preparar el gestor de recortes", e),
    );
    return () => {
      vivo = false;
      cancelar?.();
    };
  }, [user, canAccess]);


  return user && canAccess && ordenador ? <AvisoTrabajosRecorte /> : null;
}
