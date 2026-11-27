/**
 * Redes (rrss embebido): entrega del pase al iframe de rrss. Lo usan la página Redes y el
 * iframe oculto que prepara en rrss la historia de tapas después de guardarlas
 * (`components/redes/PreparadorRedes.tsx`).
 *
 * El iframe (`rrss/embed`) manda la huella de su secreto (`rrss:hello`); el panel pide a su
 * servidor (`rrss-embed-pass`) un pase de un solo uso ligado a esa huella y se lo da SOLO a
 * ese iframe y SOLO al origen de rrss (`rrss:pass`). Como mucho 6 pases por minuto a cada
 * iframe, para que un fallo no haga un bucle. Diseño: docs/redes-rrss.md.
 */
import { useCallback, useEffect, useRef, type RefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { esHuella } from "@/lib/redes";

export const PASES_POR_MINUTO = 6;

export async function pedirPaseRedes(cnf: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("rrss-embed-pass", { method: "POST", body: { cnf } });
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

/**
 * Atiende el saludo del iframe y le entrega el pase. `alFallar` recibe el motivo (sin pase,
 * demasiados reinicios). Devuelve `reiniciar` para poner a cero el tope al volver a abrir.
 */
export function useEntregaPaseRedes(
  iframe: RefObject<HTMLIFrameElement | null>,
  origen: string | null,
  alFallar: (mensaje: string) => void,
): () => void {
  const pases = useRef<number[]>([]);
  const fallar = useRef(alFallar);
  fallar.current = alFallar;

  useEffect(() => {
    if (!origen) return;
    const alRecibir = (evento: MessageEvent) => {
      const ventana = iframe.current?.contentWindow;
      if (!ventana || evento.source !== ventana || evento.origin !== origen) return;
      const datos = evento.data as { type?: unknown; cnf?: unknown } | null;
      if (datos?.type !== "rrss:hello" || !esHuella(datos.cnf)) return;
      const cnf = datos.cnf;
      const ahora = Date.now();
      pases.current = pases.current.filter((t) => ahora - t < 60_000);
      if (pases.current.length >= PASES_POR_MINUTO) {
        fallar.current("Redes se ha reiniciado demasiadas veces. Pulsa «Volver a abrir».");
        return;
      }
      pases.current.push(ahora);
      void pedirPaseRedes(cnf)
        .then((pase) => ventana.postMessage({ type: "rrss:pass", pass: pase, cnf }, origen))
        .catch((e: unknown) => fallar.current(e instanceof Error ? e.message : "No se ha podido abrir Redes."));
    };
    window.addEventListener("message", alRecibir);
    return () => window.removeEventListener("message", alRecibir);
  }, [iframe, origen]);

  return useCallback(() => {
    pases.current = [];
  }, []);
}
