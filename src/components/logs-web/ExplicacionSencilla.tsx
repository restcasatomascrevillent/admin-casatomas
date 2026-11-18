import { HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ExplicacionSencilla as Explicacion } from "./calculos";

type Clave = keyof Pick<Explicacion, "queHizo" | "queFallo" | "afecta" | "seArregla" | "queHacer">;

/** Formato del dueño: qué pasó, a quién afecta, ¿se arregla solo? y qué hacer (y qué hizo el cliente, si viene del navegador). */
const APARTADOS: Array<[Clave, string]> = [
  ["queHizo", "Qué hizo el cliente"],
  ["queFallo", "Qué pasó"],
  ["afecta", "A quién afecta"],
  ["seArregla", "¿Se arregla solo?"],
  ["queHacer", "Qué hacer"],
];

/**
 * Bloque en español llano arriba del detalle (incidencia o sesión). Lo técnico
 * va debajo, plegado. En la incidencia, la cabecera («Fallo del admin · Panel ›
 * Facturas») y el título en llano van en la cabecera del panel lateral: aquí
 * `titulo={null}` quita el encabezado del bloque.
 */
export function ExplicacionSencilla({ explicacion, titulo = "En pocas palabras" }: { explicacion: Explicacion; titulo?: string | null }) {
  const apartados = APARTADOS.filter(([clave]) => typeof explicacion[clave] === "string" && explicacion[clave] !== "");
  return (
    <section className="space-y-2 rounded-md border border-primary/30 bg-primary/5 p-3" data-testid="explicacion-sencilla" data-fuente={explicacion.fuente}>
      {titulo && <h3 className="flex items-center gap-1.5 text-sm font-semibold"><HelpCircle className="h-4 w-4" aria-hidden /> {titulo}</h3>}
      <dl className="space-y-2 text-sm">
        {apartados.map(([clave, etiqueta]) => (
          <div key={clave} data-testid={`sencillo-${clave}`}>
            <dt className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
              {etiqueta}
              {clave === "queFallo" && explicacion.fuente === "ia" && (
                <Badge variant="outline" className="border-amber-500/60 px-1.5 py-0 text-[10px] font-normal text-amber-700 dark:text-amber-300" data-testid="marca-ia">
                  Explicación de la IA · sin comprobar
                </Badge>
              )}
            </dt>
            <dd className="break-words">{explicacion[clave]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
