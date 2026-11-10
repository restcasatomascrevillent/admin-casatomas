import { useState } from "react";
import { CalendarHeart, FilePlus2, Gift, Leaf, Megaphone, PartyPopper, Sparkles, Trash2, UtensilsCrossed, Bookmark } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PLANTILLAS_BASE, type PlantillaGuardada, type TipoNewsletter } from "@/lib/newsletter/diseno";

/** Nombre corto en el botón; el completo y la descripción van en el nombre accesible y el tooltip. */
const PRESENTACION: Record<TipoNewsletter, { icono: React.ReactNode; corto: string }> = {
  anuncio: { icono: <Megaphone />, corto: "Anuncio" },
  nuevo_menu: { icono: <UtensilsCrossed />, corto: "Nuevo menú" },
  oferta: { icono: <PartyPopper />, corto: "Oferta" },
  menu_temporada: { icono: <Leaf />, corto: "Menú de temporada" },
  evento: { icono: <CalendarHeart />, corto: "Evento" },
  novedades_carta: { icono: <Sparkles />, corto: "Novedades" },
  cheques_regalo: { icono: <Gift />, corto: "Cheques regalo" },
  personalizada: { icono: <FilePlus2 />, corto: "En blanco" },
};

/** Lo elegido: una plantilla de partida (por tipo) o una guardada (por id). */
export type SeleccionPlantilla = { base: TipoNewsletter } | { guardada: string } | null;

interface Props {
  seleccion: SeleccionPlantilla;
  guardadas: PlantillaGuardada[];
  onBase: (tipo: TipoNewsletter) => void;
  onGuardada: (p: PlantillaGuardada) => void;
  onBorrar?: (p: PlantillaGuardada) => void;
}

const BOTON =
  "flex min-h-11 min-w-0 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function SelectorPlantillaNewsletter({ seleccion, guardadas, onBase, onGuardada, onBorrar }: Props) {
  const [aBorrar, setABorrar] = useState<PlantillaGuardada | null>(null);
  return (
    <div className="space-y-3">
      {/* Grupo de opciones: Tab para moverse, Intro o Espacio para elegir. */}
      <div role="radiogroup" aria-label="Plantilla" className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 2xl:grid-cols-4">
        {PLANTILLAS_BASE.map((p) => {
          const activo = !!seleccion && "base" in seleccion && seleccion.base === p.tipo;
          const pres = PRESENTACION[p.tipo];
          return (
            <button
              key={p.tipo}
              type="button"
              role="radio"
              aria-checked={activo}
              aria-label={`${pres.corto}: ${p.descripcion}`}
              title={p.descripcion}
              onClick={() => onBase(p.tipo)}
              className={cn(BOTON, activo ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted/60")}
            >
              <span className={cn("shrink-0 [&>svg]:h-4 [&>svg]:w-4", activo ? "" : "text-accent")} aria-hidden="true">{pres.icono}</span>
              <span className="min-w-0 break-words leading-tight">{pres.corto}</span>
            </button>
          );
        })}
      </div>

      {guardadas.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Tus plantillas</p>
          <ul className="flex flex-wrap gap-2" aria-label="Plantillas guardadas">
            {guardadas.map((p) => {
              const activo = !!seleccion && "guardada" in seleccion && seleccion.guardada === p.id;
              return (
                <li key={p.id} className="flex min-w-0 max-w-full">
                  <button
                    type="button"
                    aria-pressed={activo}
                    onClick={() => onGuardada(p)}
                    className={cn(
                      BOTON,
                      "max-w-full",
                      onBorrar ? "rounded-r-none border-r-0" : "",
                      activo ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted/60",
                    )}
                  >
                    <Bookmark className={cn("h-4 w-4 shrink-0", activo ? "" : "text-accent")} aria-hidden="true" />
                    <span className="truncate">{p.nombre}</span>
                    {p.origen === "ia" && <Badge variant="secondary" className="shrink-0 px-1.5 py-0 text-[10px]">IA</Badge>}
                  </button>
                  {onBorrar && (
                    <button
                      type="button"
                      onClick={() => setABorrar(p)}
                      aria-label={`Borrar la plantilla «${p.nombre}»`}
                      title="Borrar plantilla"
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-r-md border border-input bg-background text-muted-foreground hover:bg-muted/60 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <AlertDialog open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Borrar la plantilla «{aBorrar?.nombre}»?</AlertDialogTitle>
            <AlertDialogDescription>Deja de aparecer en la lista. Los correos ya enviados no cambian.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="h-11"
              onClick={() => {
                if (aBorrar && onBorrar) onBorrar(aBorrar);
                setABorrar(null);
              }}
            >
              Borrar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
