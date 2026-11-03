import { AlertTriangle, ExternalLink, Loader2, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type LecturaServicio,
  type ServicioContratado,
  TEXTO_CICLO,
  TEXTO_ERROR,
  combinarMetricas,
  fechaCorta,
  haceCuanto,
  peorSemaforo,
  textoPrecio,
} from "@/lib/servicios";
import { AvisoClave } from "./AvisoClave";
import { BarraConsumo, ChipSemaforo } from "./BarraConsumo";

interface Props {
  servicio: ServicioContratado;
  lectura: LecturaServicio | null;
  cargando: boolean;
  actualizando: boolean;
  onActualizar: () => void;
  onEditar: () => void;
}

const textoLista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function textoRenovacion(s: ServicioContratado): string {
  const f = fechaCorta(s.renovacion);
  if (f) return `${f} (${TEXTO_CICLO[s.ciclo] ?? s.ciclo})`;
  if (s.ciclo === "gratuito") return "No hay que renovar (plan gratis)";
  if (s.ciclo === "por_uso") return "No hay cuota: se paga por cobro";
  return "Sin fecha";
}

export function TarjetaServicio({ servicio, lectura, cargando, actualizando, onActualizar, onEditar }: Props) {
  const idTitulo = `servicio-${servicio.proveedor}`;
  const filas = combinarMetricas(servicio, lectura);
  const peor = peorSemaforo(filas);
  const detalles = lectura?.detalles ?? {};
  const avisos = textoLista(detalles.avisos);
  const modo = typeof detalles.modo === "string" ? detalles.modo : null;
  const planDetectado = typeof detalles.plan_detectado === "string" ? detalles.plan_detectado : null;
  const secretoOpcional = typeof detalles.secreto_opcional === "string" ? detalles.secreto_opcional : null;
  const faltaClave = lectura?.error === "falta_secreto";
  const otroError = lectura?.error && !faltaClave ? lectura.error : null;
  const fecha = lectura?.tomado_en ? new Date(lectura.tomado_en) : null;

  return (
    <Card className="flex min-w-0 flex-col" aria-labelledby={idTitulo} role="article">
      <CardHeader className="space-y-2 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-lg font-semibold leading-tight text-foreground">{servicio.nombre}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Plan <span className="font-medium text-foreground">{servicio.plan || "sin dato"}</span> · {textoPrecio(servicio)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {modo && (
              <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium",
                modo === "real" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                {modo === "real" ? "Modo real (cobra de verdad)" : modo === "prueba" ? "Modo prueba" : "Modo desconocido"}
              </span>
            )}
            {faltaClave ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Falta configurar</span>
            ) : peor ? (
              <ChipSemaforo estado={peor} />
            ) : null}
          </div>
        </div>
        <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted-foreground">Renovación</dt>
          <dd className="min-w-0 break-words">{textoRenovacion(servicio)}</dd>
          {servicio.cuenta && (
            <>
              <dt className="text-muted-foreground">Cuenta</dt>
              <dd className="min-w-0 break-words">{servicio.cuenta}</dd>
            </>
          )}
          {planDetectado && (
            <>
              <dt className="text-muted-foreground">Según la API</dt>
              <dd className="min-w-0 break-words">plan {planDetectado}</dd>
            </>
          )}
        </dl>
      </CardHeader>

      <CardContent className="flex min-w-0 flex-1 flex-col gap-3 px-4 pb-3 pt-0 sm:px-5">
        {faltaClave && lectura?.secreto && <AvisoClave secreto={lectura.secreto} />}
        {otroError && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{TEXTO_ERROR[otroError] ?? "No se pudieron leer los datos."}</span>
          </p>
        )}
        {cargando && !lectura ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leyendo el consumo…
          </p>
        ) : filas.length > 0 ? (
          <ul className="min-w-0 divide-y divide-border/60" aria-label={`Consumo de ${servicio.nombre}`}>
            {filas.map((f) => <BarraConsumo key={f.clave} fila={f} />)}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            {faltaClave ? "Sin datos de consumo hasta que se configure la clave." : "Este servicio no tiene límites de uso en su plan."}
          </p>
        )}
        {secretoOpcional && <AvisoClave secreto={secretoOpcional} opcional />}
        {avisos.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground" aria-label={`Avisos de ${servicio.nombre}`}>
            {avisos.map((a) => <li key={a}>· {a}</li>)}
          </ul>
        )}
        {servicio.notas && <p className="break-words text-xs text-muted-foreground">{servicio.notas}</p>}
      </CardContent>

      <CardFooter className="flex min-w-0 flex-col items-stretch gap-2 border-t p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">
          Última lectura:{" "}
          {fecha ? (
            <time dateTime={lectura!.tomado_en} title={fecha.toLocaleString("es-ES")}>{haceCuanto(lectura!.tomado_en)}</time>
          ) : (
            "todavía ninguna"
          )}
          {lectura?.desde_cache && " · se renueva cada 15 min"}
        </p>
        <div className="flex min-w-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-11 flex-1 gap-1.5 px-3 sm:flex-none"
            onClick={onActualizar}
            disabled={actualizando}
            aria-label={`Actualizar ahora el consumo de ${servicio.nombre}`}
          >
            <RefreshCw className={cn("h-4 w-4", actualizando && "animate-spin")} aria-hidden="true" />
            Actualizar ahora
          </Button>
          <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5 px-3 sm:flex-none" onClick={onEditar} aria-label={`Editar el plan de ${servicio.nombre}`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </Button>
          {servicio.panel_url && (
            <Button asChild variant="ghost" className="h-11 w-full gap-1.5 px-3 sm:ml-auto sm:w-auto">
              <a href={servicio.panel_url} target="_blank" rel="noopener noreferrer">
                Panel de {servicio.nombre}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">(se abre en otra pestaña)</span>
              </a>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
