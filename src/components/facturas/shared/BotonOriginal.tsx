import { useState } from "react";
import { ExternalLink, Loader2, AlertTriangle, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { AlertaValidacion } from "@/hooks/useFacturas";

const BUCKET = "facturas-originales";
/** Vida de la URL firmada. Corta a proposito: el enlace no debe poder reenviarse. */
const SEGUNDOS_FIRMA = 120;

interface BotonOriginalProps {
  driveUrl: string | null;
  archivoPath: string | null;
  variant: "mobile" | "desktop";
  /** Texto del boton en movil ("Escaneo" en facturas, "Doc" en albaranes). */
  label?: string;
}

/**
 * Abre el documento original.
 *
 * Hay dos sitios posibles y el componente se encarga de elegir:
 *   - `drive_url`     -> enlace directo de Google Drive (cuando Drive esta configurado).
 *   - `archivo_path`  -> fichero en el bucket PRIVADO de Supabase Storage, que es
 *                        el fallback usado mientras no existan los secrets GOOGLE_*.
 *                        Al ser privado hace falta pedir una URL firmada al vuelo.
 *
 * Si no hay ninguno de los dos no se pinta nada: el original se perdio.
 */
export function BotonOriginal({ driveUrl, archivoPath, variant, label = "Escaneo" }: BotonOriginalProps) {
  const [cargando, setCargando] = useState(false);

  if (!driveUrl && !archivoPath) return null;

  const clases =
    variant === "mobile"
      ? "inline-flex h-8 w-full min-w-0 items-center justify-center gap-1 rounded-md bg-blue-50 px-2 text-[11px] font-medium text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-800 disabled:opacity-60"
      : "inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:bg-blue-50 p-1.5 rounded-md transition-colors disabled:opacity-60";

  const icono =
    cargando
      ? <Loader2 className={variant === "mobile" ? "h-3 w-3 animate-spin" : "h-4 w-4 animate-spin"} />
      : <ExternalLink className={variant === "mobile" ? "h-3 w-3" : "h-4 w-4"} />;

  // Drive: enlace normal, sin pasar por Supabase.
  if (driveUrl) {
    return (
      <a
        href={driveUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={clases}
        title="Ver documento original (Google Drive)"
      >
        {icono}
        {variant === "mobile" && label}
      </a>
    );
  }

  // Storage privado: hay que firmar la URL en el momento de abrirla.
  const abrirDesdeStorage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cargando || !archivoPath) return;
    setCargando(true);
    try {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(archivoPath, SEGUNDOS_FIRMA);
      if (error || !data?.signedUrl) throw new Error(error?.message || "URL no disponible");
      window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[facturas] No se pudo abrir el original:", err);
      toast.error("No se ha podido abrir el documento original");
    } finally {
      setCargando(false);
    }
  };

  return (
    <button
      type="button"
      onClick={abrirDesdeStorage}
      disabled={cargando}
      className={clases}
      title="Ver documento original (archivo guardado)"
    >
      {icono}
      {variant === "mobile" && label}
    </button>
  );
}

/**
 * Aviso de que el OCR leyo importes que no cuadran (descuadres, precios
 * desproporcionados). No bloquea nada: solo señala lo que hay que revisar.
 */
export function BadgeAlertas({ alertas }: { alertas: AlertaValidacion[] }) {
  if (!alertas || alertas.length === 0) return null;

  const graves = alertas.filter((a) => a.severidad === "alta").length;
  const color = graves > 0
    ? "bg-red-50 text-red-700 border-red-200"
    : "bg-amber-50 text-amber-700 border-amber-200";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            onClick={(e) => e.stopPropagation()}
            className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${color}`}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" />
            {alertas.length}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="mb-1 font-semibold">Importes que conviene revisar</p>
          <ul className="list-disc space-y-1 pl-4 text-xs">
            {alertas.slice(0, 4).map((a, i) => (
              <li key={i}>{a.mensaje}</li>
            ))}
          </ul>
          {alertas.length > 4 && (
            <p className="mt-1 text-xs opacity-70">y {alertas.length - 4} mas…</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/**
 * Indicador de que nadie ha marcado este documento como "verificado" desde
 * el dialogo de edicion (campo `facturas.verificada`).
 *
 * Es DISTINTO de `BadgeAlertas`: un documento puede no tener ninguna alerta
 * de cordura de importes (`alertas_validacion` vacio) y aun asi no estar
 * revisado por una persona. Antes de esto, `verificada` solo se veia dentro
 * de `EditarFacturaDialog`, asi que la unica forma de saber que quedaba
 * pendiente de revisar era abrir documento por documento.
 */
export function BadgeSinVerificar({ verificada }: { verificada: boolean }) {
  if (verificada) return null;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-600"
          >
            <EyeOff className="h-3 w-3 shrink-0" />
            Sin revisar
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p>Nadie ha marcado este documento como verificado todavia (interruptor "Marcar como verificada" en Editar).</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
