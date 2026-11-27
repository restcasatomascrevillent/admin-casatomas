/**
 * Redes (23/11/2026): rrss, la herramienta de redes sociales, dentro del panel.
 *
 * El panel abre rrss en un iframe (`/embed`, sin nada en la dirección). rrss genera
 * un secreto y manda su huella al panel (`rrss:hello`); el panel pide a su servidor
 * (Edge Function `rrss-embed-pass`) un pase firmado de un solo uso y 30 s ligado a
 * esa huella y se lo pasa al iframe (`rrss:pass`). rrss lo cambia por una sesión
 * limitada a la marca del restaurante: sin otra cuenta ni contraseña. Mientras la
 * sección está abierta, rrss pide un pase nuevo cada 10 minutos; si al usuario le
 * quitan «Redes», el panel deja de darlo y rrss corta el acceso en minutos.
 *
 * Solo se atienden mensajes del propio iframe y del origen de rrss.
 * Sustituye a la sección antigua RRSS/Instagram (`pages/RRSS.tsx`, archivada en la
 * rama `archivo/instagram-estudio`). Diseño y amenazas: docs/redes-rrss.md.
 */
import { useCallback, useRef, useState } from "react";
import { RefreshCw, Share2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { useEntregaPaseRedes } from "@/hooks/useEntregaPaseRedes";
import { origenRrss, urlEmbebida } from "@/lib/redes";

const ALTURA_MINIMA = 420;

type Estado = { tipo: "listo"; src: string } | { tipo: "error"; mensaje: string };

export default function Redes() {
  const origen = origenRrss();
  const [estado, setEstado] = useState<Estado>(() =>
    origen
      ? { tipo: "listo", src: urlEmbebida(origen) }
      : { tipo: "error", mensaje: "Redes no está configurada en este entorno (falta VITE_RRSS_URL)." },
  );
  const [version, setVersion] = useState(0);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const iframe = useRef<HTMLIFrameElement | null>(null);
  const reiniciar = useEntregaPaseRedes(iframe, origen, (mensaje) => setEstado({ tipo: "error", mensaje }));

  const abrir = useCallback(() => {
    if (!origen) return;
    reiniciar();
    setEstado({ tipo: "listo", src: urlEmbebida(origen) });
    setVersion((v) => v + 1);
  }, [origen, reiniciar]);

  return (
    <DashboardLayout>
      <div
        ref={setRaiz}
        className={`flex flex-col gap-2 ${alto ? "" : "h-[calc(100vh-6rem)] supports-[height:100dvh]:h-[calc(100dvh-6rem)]"}`}
        style={alto ? { height: alto } : undefined}
        data-testid="redes"
      >
        <div className="flex shrink-0 items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Share2 className="h-5 w-5" aria-hidden="true" />
            Redes
          </h1>
          <Button variant="outline" className="h-11 gap-2" onClick={abrir} disabled={!origen}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Volver a abrir
          </Button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
          {estado.tipo === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
              <p className="max-w-md text-sm">{estado.mensaje}</p>
              {origen && (
                <Button className="h-11" onClick={abrir}>
                  Volver a intentarlo
                </Button>
              )}
            </div>
          )}
          {estado.tipo === "listo" && (
            <iframe
              key={version}
              ref={iframe}
              src={estado.src}
              title="Redes (rrss)"
              className="h-full w-full border-0"
              // rrss no puede mover ni tocar el panel: sin `allow-top-navigation`. Es otro origen,
              // así que `allow-same-origin` solo le deja usar su propio almacenamiento.
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
              allow="clipboard-write; fullscreen"
              referrerPolicy="strict-origin"
              data-testid="redes-iframe"
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
