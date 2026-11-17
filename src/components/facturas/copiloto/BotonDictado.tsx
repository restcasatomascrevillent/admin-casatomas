// Micrófono de la caja de preguntas del copiloto (y de cualquier caja de texto
// que lo quiera): dicta a continuación de lo escrito, sin enviar. Ver useDictado.
import { useEffect, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDictado } from "@/hooks/useDictado";

interface Props {
  valor: string;
  onCambio: (texto: string) => void;
  disabled?: boolean;
  className?: string;
}

export function BotonDictado({ valor, onCambio, disabled, className }: Props) {
  const d = useDictado({ valor, onCambio });
  const [sinSoporte, setSinSoporte] = useState(false);
  const { estado, parar } = d;
  // Si se envía la pregunta (o se bloquea la caja) mientras se dicta, se corta el micrófono.
  useEffect(() => {
    if (disabled && estado === "escuchando") parar();
  }, [disabled, estado, parar]);
  const escuchando = d.estado === "escuchando";
  const transcribiendo = d.estado === "transcribiendo";
  const aviso = d.error ?? (sinSoporte && !d.soportado ? "Tu navegador no permite dictar. Usa Chrome, Safari o Edge actualizados, o escribe la pregunta." : null);

  const pulsar = () => {
    if (!d.soportado) { setSinSoporte(true); return; }
    setSinSoporte(false);
    d.alternar();
  };

  return (
    <>
      <button
        type="button"
        onClick={pulsar}
        disabled={disabled || transcribiendo}
        aria-pressed={escuchando}
        aria-label={escuchando ? "Parar el dictado" : "Dictar con la voz"}
        title={escuchando ? "Parar el dictado" : "Dictar con la voz"}
        className={cn(
          "flex h-11 w-11 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          escuchando ? "bg-destructive text-destructive-foreground animate-pulse" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
          className,
        )}
      >
        {transcribiendo ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : escuchando ? <Square className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
      </button>
      <div role="status" aria-live="polite" className="sr-only">
        {escuchando ? "Escuchando" : transcribiendo ? "Transcribiendo" : ""}
      </div>
      {(escuchando || transcribiendo || aviso) && (
        <p
          data-testid="estado-dictado"
          className={cn("absolute -top-6 left-3 right-3 truncate text-xs", aviso ? "text-destructive" : "text-muted-foreground")}
          role={aviso ? "alert" : undefined}
        >
          {aviso ?? (transcribiendo ? "Transcribiendo…" : d.provisional ? `Escuchando… ${d.provisional}` : "Escuchando… habla ahora")}
        </p>
      )}
    </>
  );
}
