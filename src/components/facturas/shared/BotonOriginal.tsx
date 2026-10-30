import { useState } from "react";
import { ExternalLink, Loader2, Pencil, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { urlSegura } from "@/lib/url-segura";

const BUCKET = "facturas-originales";
/** Vida de la URL firmada. Corta a proposito: el enlace no debe poder reenviarse. */
const SEGUNDOS_FIRMA = 120;

interface BotonOriginalProps {
  driveUrl: string | null;
  archivoPath: string | null;
  variant: "mobile" | "desktop" | "ficha";
  /**
   * Texto del boton en movil ("Escaneo" en facturas, "Doc" en albaranes). En la
   * variante `ficha` es el nombre accesible ("Ver original") y el texto visible
   * es la palabra corta que queda tras quitar el "Ver ".
   */
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
 * Si no hay ninguno de los dos NO se devuelve `null`: se pinta el boton
 * deshabilitado con el porque en el `title`. Mismo criterio que
 * `ListaReservasAvanzada` — lo que no aplica a una fila sale apagado, nunca se
 * quita, porque si no los botones bailan de sitio al bajar por la lista.
 */
export function BotonOriginal({ driveUrl: driveUrlBruta, archivoPath, variant, label = "Escaneo" }: BotonOriginalProps) {
  // Solo http(s): un `javascript:`/`data:` de BD no se enlaza (CT-REM-FE-06).
  const driveUrl = urlSegura(driveUrlBruta);
  const [cargando, setCargando] = useState(false);
  // `ficha`: solo icono en estrecho, icono + palabra corta desde `sm`, con el nombre accesible siempre puesto.
  const corto = label.replace(/^Ver /i, "").replace(/^./, (c) => c.toUpperCase());
  const texto =
    variant === "mobile" ? label : variant === "ficha" ? <span className="hidden xl:inline">{corto}</span> : null;

  const clases =
    variant === "ficha"
      ? "inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 disabled:pointer-events-none disabled:opacity-40 dark:text-blue-400 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
      : variant === "mobile"
      ? "inline-flex h-11 w-full min-w-0 items-center justify-center gap-1.5 rounded-md bg-blue-50 px-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-100 hover:text-blue-800 disabled:pointer-events-none disabled:opacity-40"
      : "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-blue-600 transition-colors hover:bg-blue-50 hover:text-blue-800 disabled:pointer-events-none disabled:opacity-40";

  if (!driveUrl && !archivoPath) {
    return (
      <button
        type="button"
        disabled
        className={clases}
        title="No se guardó el documento original de este registro"
        aria-label="Ver original: no se guardó el documento original de este registro"
      >
        <ExternalLink className="h-4 w-4" />
        {texto}
      </button>
    );
  }

  const icono = cargando ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <ExternalLink className="h-4 w-4" />
  );

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
        aria-label={variant === "mobile" ? undefined : variant === "ficha" ? label : "Ver documento original (Google Drive)"}
      >
        {icono}
        {texto}
      </a>
    );
  }

  // Storage privado: hay que firmar la URL en el momento de abrirla.
  const abrirDesdeStorage = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cargando || !archivoPath) return;
    setCargando(true);
    try {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(archivoPath, SEGUNDOS_FIRMA);
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
      aria-label={variant === "mobile" ? undefined : variant === "ficha" ? label : "Ver documento original (archivo guardado)"}
    >
      {icono}
      {texto}
    </button>
  );
}

interface AccionesDocumentoProps {
  driveUrl: string | null;
  archivoPath: string | null;
  onEditar: () => void;
  onPreguntarIA?: () => void;
  tipo: "factura" | "albarán";
}

/**
 * Los textos van escritos, no compuestos con `${tipo}`: "factura" es femenino
 * y "albaran" masculino, y concatenando salia "Analizar este factura".
 */
const TEXTOS = {
  factura: {
    editar: "Editar esta factura (y marcarla como verificada)",
    ia: "Analizar esta factura con la IA",
  },
  "albarán": {
    editar: "Editar este albarán (y marcarlo como verificado)",
    ia: "Analizar este albarán con la IA",
  },
} as const;

/**
 * Las tres acciones de fila, SIEMPRE las mismas y SIEMPRE en la misma X:
 * ver el original · editar · preguntar a la IA.
 *
 * Antes "Escaneo" era una columna propia con su cabecera. Se une aqui por dos
 * motivos: gana una columna entera de ancho (cabecera + relleno + borde) en
 * una tabla que no cabia, y deja de poder apagarse desde el selector de
 * columnas, que era una forma tonta de perder el acceso al papel original.
 *
 * Los tres son solo icono hasta 1279 px; el de la IA gana la etiqueta "IA" en
 * `xl` y "Asistente IA" a partir de 1536 px. Ninguno desaparece nunca: el de
 * ver el original sale deshabilitado cuando no se guardo el escaneo, para que
 * los botones no bailen de sitio al bajar por la lista.
 */
export function AccionesDocumento({
  driveUrl,
  archivoPath,
  onEditar,
  onPreguntarIA,
  tipo,
}: AccionesDocumentoProps) {
  const textos = TEXTOS[tipo];
  return (
    <div className="flex items-center justify-end gap-1">
      <BotonOriginal driveUrl={driveUrl} archivoPath={archivoPath} variant="desktop" />
      <Button
        variant="ghost"
        size="sm"
        className="h-11 w-11 shrink-0 p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        onClick={(e) => {
          e.stopPropagation();
          onEditar();
        }}
        title={textos.editar}
        aria-label={textos.editar}
      >
        <Pencil className="h-4 w-4" />
      </Button>
      {onPreguntarIA && (
        <Button
          variant="ghost"
          size="sm"
          className="h-11 min-w-11 shrink-0 justify-center gap-1.5 whitespace-nowrap p-0 text-xs font-medium text-[hsl(38,59%,45%)] transition-colors hover:bg-[hsl(38,59%,45%)/0.1] hover:text-[hsl(38,59%,45%)] xl:px-2"
          onClick={(e) => {
            e.stopPropagation();
            onPreguntarIA();
          }}
          title={textos.ia}
          aria-label={textos.ia}
        >
          <Sparkles className="h-4 w-4 shrink-0" />
          {/* El texto entra por tramos. "Asistente IA" pide ~74 px y a 1280 px
              era justo lo que hacia desbordar la tabla (medido: 938 px de
              minimo contra 924 px utiles), asi que ahi se queda en "IA" —que
              se entiende, porque la pestaña de arriba se llama igual— y la
              etiqueta larga vuelve a 1536 px, donde sobra sitio. */}
          <span className="hidden xl:inline 2xl:hidden">IA</span>
          <span className="hidden 2xl:inline">Asistente IA</span>
        </Button>
      )}
    </div>
  );
}
