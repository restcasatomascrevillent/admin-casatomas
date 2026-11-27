/**
 * Iframe OCULTO de Redes (26/11/2026): después de mandar las tapas a rrss (`lib/redesTapas.ts`),
 * abre rrss un momento para que monte la historia con su plantilla, la exporte y la deje en
 * el calendario (rrss dibuja en el navegador). Mismo pase que la página Redes (de un solo uso,
 * por postMessage, solo a este iframe); solo para quien tiene «Redes» con «Puede editar».
 * rrss avisa al terminar (`rrss:menus-done`) y el iframe se cierra; si en 3 minutos no ha
 * terminado, se cierra igual: lo que quede lo prepara rrss la próxima vez que se abra Redes.
 * Está por encima de las rutas: cambiar de sección no lo corta.
 */
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEntregaPaseRedes } from "@/hooks/useEntregaPaseRedes";
import { origenRrss, urlEmbebida } from "@/lib/redes";
import { EVENTO_PREPARAR_REDES } from "@/lib/redesTapas";

export const ESPERA_MAXIMA_MS = 3 * 60_000;

export function PreparadorRedes() {
  const origen = origenRrss();
  const { canAccess: editaRedes } = useCanAccessSection("redes", "edit");
  const [abierto, setAbierto] = useState(0);
  const iframe = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!origen || !editaRedes) return;
    const abrir = () => setAbierto((n) => n + 1);
    window.addEventListener(EVENTO_PREPARAR_REDES, abrir);
    return () => window.removeEventListener(EVENTO_PREPARAR_REDES, abrir);
  }, [origen, editaRedes]);

  useEntregaPaseRedes(iframe, abierto ? origen : null, () => setAbierto(0));

  useEffect(() => {
    if (!abierto || !origen) return;
    const alRecibir = (evento: MessageEvent) => {
      if (evento.source !== iframe.current?.contentWindow || evento.origin !== origen) return;
      const datos = evento.data as { type?: unknown; failed?: unknown } | null;
      if (datos?.type !== "rrss:menus-done") return;
      if (typeof datos.failed === "number" && datos.failed > 0) {
        toast.error("Redes no ha podido preparar la historia de tapas. Ábrela en Redes para ver qué pasa.");
      }
      setAbierto(0);
    };
    window.addEventListener("message", alRecibir);
    const tope = window.setTimeout(() => setAbierto(0), ESPERA_MAXIMA_MS);
    return () => {
      window.removeEventListener("message", alRecibir);
      window.clearTimeout(tope);
    };
  }, [abierto, origen]);

  if (!abierto || !origen || !editaRedes) return null;
  return (
    <iframe
      key={abierto}
      ref={iframe}
      src={urlEmbebida(origen)}
      title="Redes (preparando la historia de tapas)"
      aria-hidden="true"
      tabIndex={-1}
      // Fuera de la pantalla, pero con tamaño de historia: rrss dibuja la pieza ahí dentro.
      style={{ position: "fixed", left: -10_000, top: 0, width: 1080, height: 1920, border: 0, opacity: 0, pointerEvents: "none" }}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="strict-origin"
      data-testid="redes-preparador"
    />
  );
}
