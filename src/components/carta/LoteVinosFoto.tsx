import { useRef } from "react";
import { AlertCircle, Camera, Check, ChevronRight, Images, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatoEuros, precioSugerido } from "./leerVinoFoto";
import type { FilaLote, LoteVinos } from "./useLoteVinos";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lote: LoteVinos;
  onAbrirFila: (fila: FilaLote) => void;
}

function TextoEstado({ fila }: { fila: FilaLote }) {
  switch (fila.estado) {
    case "cola":
      return <span className="text-muted-foreground">En cola…</span>;
    case "leyendo":
      return (
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo…
        </span>
      );
    case "error":
      return (
        <span className="inline-flex items-center gap-1 text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> No se pudo leer
        </span>
      );
    case "guardado":
      return (
        <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-500">
          <Check className="h-3.5 w-3.5" /> Guardado
        </span>
      );
    default:
      return <span className="font-medium text-primary">Listo · toca para revisar</span>;
  }
}

/** Diálogo de «Varias botellas»: lista con scroll interno (móvil vertical), sin guardar nada por su cuenta. */
export function LoteVinosDialog({ open, onOpenChange, lote, onAbrirFila }: Props) {
  const camaraRef = useRef<HTMLInputElement>(null);
  const galeriaRef = useRef<HTMLInputElement>(null);
  const { filas } = lote;
  const pendientes = filas.filter((f) => f.estado === "listo").length;
  const guardados = filas.filter((f) => f.estado === "guardado").length;

  const alElegir = (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivos = Array.from(e.target.files ?? []);
    if (archivos.length) lote.añadir(archivos);
    e.target.value = "";
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-lg flex-col gap-3 overflow-hidden p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>Varias botellas</DialogTitle>
          <DialogDescription>
            Haz una foto por botella. Se leen solas; toca cada una para revisarla y guardarla.
          </DialogDescription>
        </DialogHeader>

        <input ref={camaraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={alElegir} />
        <input ref={galeriaRef} type="file" accept="image/*" multiple className="hidden" onChange={alElegir} />

        <div className="grid grid-cols-2 gap-2">
          <Button className="h-11" onClick={() => camaraRef.current?.click()}>
            <Camera className="mr-2 h-4 w-4" />
            {filas.length ? "Otra foto" : "Hacer foto"}
          </Button>
          <Button variant="outline" className="h-11" onClick={() => galeriaRef.current?.click()}>
            <Images className="mr-2 h-4 w-4" />
            De la galería
          </Button>
        </div>

        <ul className="-mx-1 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1" aria-label="Botellas">
          {filas.length === 0 && (
            <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Aún no hay fotos.
            </li>
          )}
          {filas.map((fila) => {
            const d = fila.resultado?.datos;
            const precio = precioSugerido(d);
            const abrible = fila.estado === "listo";
            return (
              <li key={fila.id} className="flex items-center gap-2 rounded-lg border bg-card p-2">
                <button
                  type="button"
                  disabled={!abrible}
                  onClick={() => abrible && onAbrirFila(fila)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:cursor-default"
                  aria-label={abrible ? `Revisar ${d?.nombre || "botella"}` : undefined}
                >
                  <img
                    src={fila.miniatura}
                    alt=""
                    className="h-16 w-12 shrink-0 rounded-md border bg-muted object-cover"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium">
                      {d?.nombre || (fila.estado === "listo" || fila.estado === "guardado" ? "Sin nombre leído" : "Botella")}
                    </span>
                    {(d?.categoria || precio !== null) && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {[d?.categoria, precio !== null ? `sugerido ${formatoEuros(precio)}` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                    <span className="block text-xs">
                      <TextoEstado fila={fila} />
                    </span>
                  </span>
                  {abrible && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </button>
                {fila.estado === "error" && (
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-11 w-11 shrink-0"
                    aria-label="Reintentar"
                    onClick={() => lote.reintentar(fila.id)}
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 shrink-0"
                  aria-label="Quitar de la lista"
                  disabled={fila.estado === "leyendo"}
                  onClick={() => lote.quitar(fila.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {filas.length > 0 && `${guardados}/${filas.length} guardadas${pendientes ? ` · ${pendientes} por revisar` : ""}`}
          </span>
          <div className="flex gap-2">
            {filas.length > 0 && (
              <Button variant="ghost" className="h-11" onClick={lote.vaciar}>
                Vaciar
              </Button>
            )}
            <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>
              Cerrar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
