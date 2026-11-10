import { Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGenerarResumenIa, useUltimoResumenIa, type ConclusionIa, type Entorno } from "@/hooks/useLogsWeb";

const APARTADOS: Array<{ clave: "cambios" | "contenido_mejor" | "perdidas" | "problemas" | "mejoras"; titulo: string }> = [
  { clave: "cambios", titulo: "Qué ha cambiado" },
  { clave: "contenido_mejor", titulo: "Qué contenido funciona mejor" },
  { clave: "perdidas", titulo: "Dónde se pierden usuarios" },
  { clave: "problemas", titulo: "Problemas que conviene revisar" },
  { clave: "mejoras", titulo: "Mejoras que podrían probarse" },
];

function Conclusiones({ lista }: { lista: ConclusionIa[] }) {
  if (!lista.length) return <p className="text-xs italic text-muted-foreground">Nada que destacar con las cifras del periodo.</p>;
  return (
    <ul className="space-y-1.5">
      {lista.map((c, i) => (
        <li key={i} className="text-sm">
          <Badge variant="outline" className={c.tipo === "hipotesis" ? "mr-1.5 border-amber-500/60 text-amber-700 dark:text-amber-400" : "mr-1.5"}>
            {c.tipo === "hipotesis" ? "Hipótesis" : "Observación"}
          </Badge>
          {c.texto}
        </li>
      ))}
    </ul>
  );
}

/**
 * Resumen del periodo con IA (Edge Function resumen-logs-web): solo con cifras
 * agregadas, cada conclusión apoyada en una cifra del periodo y marcada como
 * observación o hipótesis. Se guarda: abrirlo otra vez no vuelve a llamar a la IA.
 */
export function ResumenIa({ desde, hasta, entorno }: { desde: string; hasta: string; entorno: Entorno }) {
  const guardado = useUltimoResumenIa(desde, hasta, entorno);
  const generar = useGenerarResumenIa();
  const resumen = generar.data?.desde === desde && generar.data?.hasta === hasta ? generar.data : guardado.data;

  const pedir = (forzar: boolean) =>
    generar.mutate({ desde, hasta, entorno, forzar }, { onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo generar el resumen") });

  return (
    <Card variante="plana" data-testid="resumen-ia">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 px-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden /> Resumen con IA del periodo
        </CardTitle>
        <Button variant="outline" className="h-11 gap-2" onClick={() => pedir(!!resumen)} disabled={generar.isPending}>
          {generar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : resumen ? <RefreshCw className="h-4 w-4" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {resumen ? "Regenerar" : "Generar resumen"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 px-0">
        {!resumen?.resumen ? (
          <p className="text-sm text-muted-foreground">
            La IA recibe solo las estadísticas agregadas del periodo (nunca visitas sueltas) y cada conclusión debe citar una cifra; las que no lo hacen se descartan.
          </p>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {APARTADOS.map((a) => (
                <div key={a.clave}>
                  <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{a.titulo}</h4>
                  <Conclusiones lista={resumen.resumen![a.clave] ?? []} />
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {resumen.modelo ? `Modelo ${resumen.modelo} · ` : ""}generado {new Date(resumen.creado_en).toLocaleString("es-ES")}
              {resumen.resumen.descartadas > 0 && ` · ${resumen.resumen.descartadas} conclusiones descartadas por no citar cifras del periodo`}
              {resumen.resumen.limitaciones.length > 0 && ` · Limitaciones: ${resumen.resumen.limitaciones.join(" ")}`}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
