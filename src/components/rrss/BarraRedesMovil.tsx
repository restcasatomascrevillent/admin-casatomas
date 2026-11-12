import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export interface RedMovil {
  valor: string;
  etiqueta: string;
  /** Nombre accesible si es más largo que lo que cabe (p. ej. «Subida de fotos» con la etiqueta «Subida»). */
  nombre?: string;
  icono: ReactNode;
}

/**
 * Navegación de RRSS en el móvil (12/11/2026): las redes (Instagram, Facebook, Subida y Métricas) en una barra
 * INFERIOR, al alcance del pulgar, con icono y texto de 14 px y 56 px de alto (más el borde seguro del iPhone).
 * Va dentro del `<Tabs>` de la página como último hijo del bloque de alto fijo, de borde a borde (anula el relleno
 * del `<main>`), así que el contenido reparte el alto que queda y la página no hace scroll. La pestaña activa se
 * marca con una píldora sobre el icono y el texto en negrita, no solo con el color.
 */
export function BarraRedesMovil({ redes }: { redes: RedMovil[] }) {
  return (
    <nav aria-label="Redes sociales" className="-mx-3 -mb-3 shrink-0 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_8px_rgba(0,0,0,0.04)]" data-testid="barra-redes-movil">
      <TabsList className="flex h-auto min-h-0 w-full justify-between gap-0 overflow-visible rounded-none bg-transparent p-0 pointer-coarse:min-h-0">
        {redes.map((r) => (
          <TabsTrigger
            key={r.valor}
            value={r.valor}
            aria-label={r.nombre}
            className="group flex h-14 min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-none px-1 py-1 text-sm font-medium text-muted-foreground shadow-none data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none pointer-coarse:min-h-14 pointer-coarse:px-1"
          >
            <span
              aria-hidden="true"
              className={cn(
                "inline-flex h-7 w-14 items-center justify-center rounded-full transition-colors [&>svg]:h-5 [&>svg]:w-5",
                "group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground",
              )}
            >
              {r.icono}
            </span>
            <span className="leading-none">{r.etiqueta}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </nav>
  );
}
