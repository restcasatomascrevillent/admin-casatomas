/**
 * Piezas comunes de la pantalla de un informe: cabecera (título, descripción,
 * selector de periodo y botones de descarga) y zona de vista previa con fondo
 * gris donde van las diapositivas. Es el diseño del diálogo «Generar informe»
 * de Tráfico web, que ahora comparten ese diálogo, el de RRSS y la página
 * Super Admin › Informes.
 */
import type { ReactNode } from "react";
import { Download, FileBarChart2, Loader2 } from "lucide-react";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { cn } from "@/lib/utils";

interface MarcoInformeProps {
  titulo: ReactNode;
  descripcion: ReactNode;
  /** Selector de periodo y botones, a la derecha del título (debajo en el móvil). */
  controles: ReactNode;
  children: ReactNode;
  /** Dentro de un <Dialog>: título y descripción accesibles del diálogo y hueco para la ✕. */
  enDialogo?: boolean;
  fuenteLista?: boolean;
  testId?: string;
  className?: string;
}

export function MarcoInforme({ titulo, descripcion, controles, children, enDialogo = false, fuenteLista, testId, className }: MarcoInformeProps) {
  const Titulo = enDialogo ? DialogTitle : "h2";
  const Descripcion = enDialogo ? DialogDescription : "p";
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b py-3 pl-4 sm:pl-5",
          enDialogo ? "pr-14 pointer-coarse:pr-16" : "pr-4 sm:pr-5",
        )}
      >
        <div className="mr-auto min-w-0">
          <Titulo className={cn("flex items-center gap-2 text-base", !enDialogo && "font-semibold leading-none tracking-tight")}>
            <FileBarChart2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            {titulo}
          </Titulo>
          <Descripcion className={cn("text-xs", !enDialogo && "mt-1.5 text-muted-foreground")}>{descripcion}</Descripcion>
        </div>
        {controles}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-muted/60 px-3 py-4 sm:px-6 sm:py-6">
        <div className="mx-auto flex max-w-[1100px] flex-col gap-4 sm:gap-6" data-fuente-lista={fuenteLista || undefined} data-testid={testId}>
          {children}
        </div>
      </div>
    </div>
  );
}

/** Lo que se ve en la vista previa: error con «Reintentar», esqueletos mientras carga, «No hay datos» o el informe. */
export function EstadoVistaPrevia({
  error,
  onReintentar,
  cargando,
  motivoVacio,
  pista = "Prueba con otro mes.",
  children,
}: {
  error: unknown;
  onReintentar: () => void;
  cargando: boolean;
  /** Con texto: no hay datos (y por qué). */
  motivoVacio: string | null;
  pista?: string;
  children: ReactNode;
}) {
  if (error) return <EstadoErrorCarga titulo="los datos del informe" error={error} onReintentar={onReintentar} />;
  if (cargando) return <>{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="aspect-video w-full rounded-md" />)}</>;
  if (motivoVacio !== null) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border bg-background px-6 py-14 text-center">
        <FileBarChart2 className="h-8 w-8 text-muted-foreground" aria-hidden />
        <p className="font-medium">No hay datos para este informe</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {motivoVacio}
          {pista ? ` ${pista}` : ""}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Selector del mes del informe. */
export function SelectorMes({
  valor,
  onCambio,
  meses,
  disabled,
}: {
  valor: string;
  onCambio: (mes: string) => void;
  meses: { clave: string; etiqueta: string }[];
  disabled?: boolean;
}) {
  return (
    <Select value={valor} onValueChange={onCambio} disabled={disabled}>
      <SelectTrigger aria-label="Mes del informe" className="h-11 w-full sm:w-[220px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {meses.map((m) => (
          <SelectItem key={m.clave} value={m.clave}>
            {m.etiqueta}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** «Descargar PDF» (con «Creando PDF… 3/9» mientras se genera). */
export function BotonDescargarPdf({ disabled, exportando, texto, onClick }: { disabled: boolean; exportando: boolean; texto: string; onClick: () => void }) {
  return (
    <Button className="h-11 w-full gap-2 sm:w-auto" disabled={disabled || exportando} onClick={onClick}>
      {exportando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />}
      {texto}
    </Button>
  );
}
