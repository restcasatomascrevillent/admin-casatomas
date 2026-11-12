import { useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CLASE_CONTADOR, formatoContador } from "@/components/panel/PestanasPagina";
import { cn } from "@/lib/utils";

export interface SeccionMovil {
  valor: string;
  etiqueta: string;
  icono: ReactNode;
  contador?: number;
  etiquetaContador?: string;
}

interface Props {
  secciones: SeccionMovil[];
  valor: string;
  onCambio: (valor: string) => void;
  /** Lo que va a la derecha del selector (el filtro de marca). */
  derecha?: ReactNode;
  /** Pie de la hoja (la cuenta conectada): lo secundario, plegado. */
  pie?: ReactNode;
}

/**
 * Las secciones de Instagram en el móvil (12/11/2026): en vez de una fila de seis pestañas cortada, UN botón de 48 px
 * con la sección actual («Estudio ▾») y, a su derecha, el filtro de marca. Al pulsarlo sube una hoja desde abajo (al
 * alcance del pulgar) con las seis secciones en filas de 56 px, con su contador y la actual marcada. Lo de menos uso
 * (la cuenta conectada) va en el pie de esa hoja. La sección sigue siendo estado del `<Tabs>` de la página: esto solo
 * cambia el valor.
 */
export function SeccionesMovil({ secciones, valor, onCambio, derecha, pie }: Props) {
  const [abierta, setAbierta] = useState(false);
  const actual = secciones.find((s) => s.valor === valor) ?? secciones[0];
  const otrosPendientes = secciones.filter((s) => s.valor !== actual?.valor).reduce((n, s) => n + (s.contador ?? 0), 0);
  return (
    <div className="mb-2 flex shrink-0 items-center gap-2" data-testid="secciones-movil">
      <button
        type="button"
        onClick={() => setAbierta(true)}
        aria-haspopup="dialog"
        aria-expanded={abierta}
        aria-label={`Sección: ${actual?.etiqueta}. Cambiar de sección`}
        className="relative flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 text-left shadow-sm transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        data-testid="selector-seccion"
      >
        <span aria-hidden="true" className="inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5">
          {actual?.icono}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{actual?.etiqueta}</span>
        {actual?.contador ? (
          <span aria-label={actual.etiquetaContador} className={cn(CLASE_CONTADOR, "bg-gold/10 text-gold-strong")}>
            {formatoContador(actual.contador)}
          </span>
        ) : null}
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        {/* Aviso de que hay algo pendiente en otra sección (p. ej. propuestas de campaña nuevas). */}
        {otrosPendientes > 0 && <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-background bg-gold" data-testid="aviso-otras-secciones" />}
      </button>
      {derecha}

      <Sheet open={abierta} onOpenChange={setAbierta}>
        <SheetContent side="bottom" className="rounded-t-2xl px-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3" data-testid="hoja-secciones">
          <SheetHeader className="px-4 pb-1">
            <SheetTitle className="text-base">Instagram</SheetTitle>
            <SheetDescription className="sr-only">Elige la sección de Instagram</SheetDescription>
          </SheetHeader>
          <ul className="mt-1" role="list">
            {secciones.map((s) => {
              const activa = s.valor === valor;
              return (
                <li key={s.valor}>
                  <button
                    type="button"
                    aria-current={activa ? "page" : undefined}
                    onClick={() => {
                      onCambio(s.valor);
                      setAbierta(false);
                    }}
                    className={cn(
                      "flex h-14 w-full items-center gap-3 px-4 text-left text-base transition-colors active:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      activa ? "bg-primary/10 font-semibold" : "font-medium",
                    )}
                  >
                    <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center [&>svg]:h-5 [&>svg]:w-5">
                      {s.icono}
                    </span>
                    <span className="flex-1">{s.etiqueta}</span>
                    {s.contador ? (
                      <span aria-label={s.etiquetaContador} className={cn(CLASE_CONTADOR, "bg-gold/10 text-gold-strong")}>
                        {formatoContador(s.contador)}
                      </span>
                    ) : null}
                    {activa && <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-primary" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {pie && <div className="mt-2 border-t px-4 pt-3">{pie}</div>}
        </SheetContent>
      </Sheet>
    </div>
  );
}
