/**
 * Redes (23/11/2026): rrss, la herramienta de redes sociales, dentro del panel.
 *
 * El panel pide a su servidor (Edge Function `rrss-embed-pass`) un pase firmado de
 * un solo uso y 60 s de vida, y abre rrss en un iframe con el pase en el fragmento
 * (`#pass=…`, que no viaja al servidor ni queda en el Referer). rrss lo cambia por
 * una sesión limitada a la marca del restaurante: sin otra cuenta ni contraseña.
 * Qué puede hacer cada persona lo decide su nivel en «Redes» (Usuarios › Permisos).
 *
 * Sustituye a la sección antigua RRSS/Instagram (`pages/RRSS.tsx`, archivada en la
 * rama `archivo/instagram-estudio`). Diseño y amenazas: docs/redes-rrss.md.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw, Share2 } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { origenRrss, urlEmbebida } from "@/lib/redes";

const ALTURA_MINIMA = 420;
/** Reaperturas automáticas (sesión caducada en rrss) que se permiten por minuto: evita bucles. */
const REAPERTURAS_POR_MINUTO = 3;

type Estado = { tipo: "cargando" } | { tipo: "listo"; src: string } | { tipo: "error"; mensaje: string };

async function pedirPase(): Promise<string> {
  const { data, error } = await supabase.functions.invoke("rrss-embed-pass", { method: "POST", body: {} });
  if (error) {
    const contexto = (error as { context?: unknown }).context;
    const cuerpo =
      contexto instanceof Response ? ((await contexto.clone().json().catch(() => null)) as { error?: unknown } | null) : null;
    throw new Error(typeof cuerpo?.error === "string" ? cuerpo.error : "No se ha podido abrir Redes.");
  }
  const pase = (data as { pase?: unknown } | null)?.pase;
  if (typeof pase !== "string" || !pase) throw new Error("No se ha podido abrir Redes.");
  return pase;
}

export default function Redes() {
  const [estado, setEstado] = useState<Estado>({ tipo: "cargando" });
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA);
  const reaperturas = useRef<number[]>([]);
  const origen = origenRrss();

  const abrir = useCallback(async () => {
    if (!origen) {
      setEstado({ tipo: "error", mensaje: "Redes no está configurada en este entorno (falta VITE_RRSS_URL)." });
      return;
    }
    setEstado({ tipo: "cargando" });
    try {
      setEstado({ tipo: "listo", src: urlEmbebida(origen, await pedirPase()) });
    } catch (e) {
      setEstado({ tipo: "error", mensaje: e instanceof Error ? e.message : "No se ha podido abrir Redes." });
    }
  }, [origen]);

  useEffect(() => {
    void abrir();
  }, [abrir]);

  // rrss avisa si su sesión se ha perdido: se pide otro pase (con tope, por si algo falla en bucle).
  useEffect(() => {
    if (!origen) return;
    const alRecibir = (evento: MessageEvent) => {
      if (evento.origin !== origen) return;
      const tipo = (evento.data as { type?: unknown } | null)?.type;
      if (tipo !== "rrss:expired") return;
      const ahora = Date.now();
      reaperturas.current = reaperturas.current.filter((t) => ahora - t < 60_000);
      if (reaperturas.current.length >= REAPERTURAS_POR_MINUTO) {
        setEstado({ tipo: "error", mensaje: "La sesión de Redes se ha cerrado. Pulsa «Volver a abrir»." });
        return;
      }
      reaperturas.current.push(ahora);
      void abrir();
    };
    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, [origen, abrir]);

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
          <Button variant="outline" className="h-11 gap-2" onClick={() => void abrir()} disabled={estado.tipo === "cargando"}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Volver a abrir
          </Button>
        </div>

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border bg-background">
          {estado.tipo === "cargando" && (
            <div className="flex h-full items-center justify-center gap-2 text-muted-foreground" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Abriendo Redes…
            </div>
          )}
          {estado.tipo === "error" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center" role="alert">
              <p className="max-w-md text-sm">{estado.mensaje}</p>
              <Button className="h-11" onClick={() => void abrir()}>
                Volver a intentarlo
              </Button>
            </div>
          )}
          {estado.tipo === "listo" && (
            <iframe
              key={estado.src}
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
