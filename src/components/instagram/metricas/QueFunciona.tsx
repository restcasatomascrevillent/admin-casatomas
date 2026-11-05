import { Info, Lightbulb } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatearPorcentaje } from "./agregacion";
import { vistaQueFunciona, type EjeVista } from "./vistaQueFunciona";
import type { QueFunciona as DatosQueFunciona } from "./tipos";

/**
 * Bloque «Qué funciona» de la pestaña Métricas (fase 3), con el estilo de la
 * maqueta: por cada eje (formato, plantilla, tipo de foto, día, hora y
 * hashtag) unas barras simples con la tasa de interacción, la mejor en oro y
 * una frase en castellano llano. Con pocos datos lo dice en vez de sacar
 * conclusiones. Los datos son los de la RPC instagram_que_funciona (los
 * mismos que lee la IA). Sin scroll de página: el contenido hace scroll
 * dentro de la tarjeta desde `md`.
 */
export interface QueFuncionaProps {
  /** null = falta la migración 20261110000000 (o la función es anterior). */
  datos: DatosQueFunciona | null | undefined;
  className?: string;
}

function Eje({ v }: { v: EjeVista }) {
  const grupos = v.grupos;
  return (
    <section aria-label={v.titulo} className="min-w-0" data-testid={`eje-${v.eje}`}>
      <h4 className="mb-1.5 text-xs font-semibold">{v.titulo}</h4>
      {grupos.length === 0 ? (
        <p className="text-xs text-muted-foreground">Sin datos todavía.</p>
      ) : (
        <ul className="space-y-1.5">
          {grupos.map((g) => (
            <li key={g.clave} className={cn("text-xs", !g.suficiente && "text-muted-foreground")}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2">
                <span className="truncate" title={g.etiqueta}>
                  {g.etiqueta}
                  {!g.suficiente && <span className="ml-1 text-xs">(pocos datos)</span>}
                  {g.mejor && <span className="sr-only"> (el mejor)</span>}
                </span>
                <b className="font-semibold tabular-nums">{formatearPorcentaje(g.tasa)}</b>
              </div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className={cn("h-full rounded-full", g.mejor ? "bg-sidebar-primary" : g.suficiente ? "bg-primary" : "bg-muted-foreground/40")}
                  style={{ width: `${g.ancho}%` }}
                />
              </div>
              <span className="sr-only">
                {g.publicaciones} {g.publicaciones === 1 ? "publicación" : "publicaciones"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {v.frase && (
        <p className={cn("mt-1.5 text-xs leading-snug", v.conclusion?.estado === "mejor" ? "text-foreground" : "text-muted-foreground")} data-testid="conclusion">
          {v.frase}
        </p>
      )}
    </section>
  );
}

export function QueFunciona({ datos, className }: QueFuncionaProps) {
  return (
    <Card className={cn("flex flex-col p-3", className)} data-testid="que-funciona">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
          <Lightbulb className="h-4 w-4 text-sidebar-primary" aria-hidden="true" />
          Qué funciona <span className="font-normal text-muted-foreground">· tasa de interacción</span>
        </CardTitle>
        {datos && (
          <span className="text-xs text-muted-foreground">
            {datos.publicaciones} publicaciones · últimos {datos.periodo_dias} días
            {typeof datos.tasa_media === "number" && ` · media ${formatearPorcentaje(datos.tasa_media)}`}
          </span>
        )}
      </div>
      {!datos ? (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground" data-testid="que-funciona-sin-migracion">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          «Qué funciona» aún no está disponible: falta actualizar la base de datos (migración 20261110000000) o la función de métricas.
        </p>
      ) : (
        <div className="md:min-h-0 md:flex-1 md:overflow-y-auto md:pr-1">
          {!datos.suficiente && (
            <p role="status" className="mb-2 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs" data-testid="faltan-datos">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Faltan datos.</strong> {datos.aviso ?? "Todavía hay pocas publicaciones para sacar conclusiones."} Las barras son orientativas.
              </span>
            </p>
          )}
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {vistaQueFunciona(datos).map((v) => (
              <Eje key={v.eje} v={v} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Tasa = interacciones ÷ alcance. Un grupo cuenta con {datos.minimo} publicaciones o más. Es lo mismo que lee la IA al proponer textos y campañas.
          </p>
        </div>
      )}
    </Card>
  );
}
