import { AlertTriangle, ExternalLink, HardDrive } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LIMITE_FDT_BYTES, NOMBRE_PROYECTO, type FilaFdtMes, type ProyectoTrafico } from "@/hooks/useTraficoWeb";
import { esNulo, fmtBytes, fmtNumero, fmtPct, URL_USO_VERCEL } from "./formato";

const clampPct = (v: number) => Math.min(100, Math.max(0, v));

const proyeccionMax = (f: FilaFdtMes): number | null => {
  const a = f.bytes_proy_lineal;
  const b = f.bytes_proy_regresion;
  if (esNulo(a) && esNulo(b)) return null;
  return Math.max(a ?? -Infinity, b ?? -Infinity);
};

function BarraLimite({ acumulado, proyectado, limite }: { acumulado: number | null; proyectado: number | null; limite: number }) {
  const pctAcum = esNulo(acumulado) ? 0 : clampPct((100 * acumulado) / limite);
  const pctProy = esNulo(proyectado) ? null : clampPct((100 * proyectado) / limite);
  const alerta = !esNulo(proyectado) && proyectado > 0.8 * limite;
  return (
    <div className="space-y-1">
      <div
        className="relative h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Consumido ${fmtPct(esNulo(acumulado) ? null : (100 * acumulado) / limite)} del límite; proyectado ${fmtPct(
          esNulo(proyectado) ? null : (100 * proyectado) / limite,
        )}`}
      >
        {pctProy !== null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${pctProy}%`,
              background: alerta ? "var(--viz-critico)" : "var(--viz-1)",
              opacity: 0.25,
            }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pctAcum}%`, background: alerta ? "var(--viz-critico)" : "var(--viz-1)" }}
        />
        {/* Marca del 80 % (umbral de alerta R4) */}
        <div className="absolute inset-y-0 w-px bg-foreground/40" style={{ left: "80%" }} aria-hidden />
      </div>
      <div className="relative h-3 text-[10px] pointer-coarse:text-xs text-muted-foreground" aria-hidden>
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2" style={{ left: "80%" }}>
          80 GB
        </span>
        <span className="absolute right-0">100 GB</span>
      </div>
    </div>
  );
}

interface FdtMesProps {
  filas: FilaFdtMes[];
  /** Resalta la fila de la web filtrada; con "ambos" solo se destaca el total. */
  proyectoSeleccionado: ProyectoTrafico | null;
}

export function FdtMes({ filas, proyectoSeleccionado }: FdtMesProps) {
  const total = filas.find((f) => f.proyecto === "*");
  const porProyecto = filas.filter((f) => f.proyecto !== "*");
  const limite = total?.limite_bytes ?? LIMITE_FDT_BYTES;
  const proyTotal = total ? proyeccionMax(total) : null;
  const mes = format(new Date(), "MMMM yyyy", { locale: es });

  return (
    <Card variante="plana">
      <CardHeader className="px-0 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium sm:text-base">
            <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />
            Fast Data Transfer · {mes}
          </CardTitle>
          <Badge variant="outline" className="border-amber-500/60 font-semibold tracking-wide text-amber-700 dark:text-amber-400">
            ESTIMACIÓN
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Visitas × peso por visita de cada página. Límite del plan Hobby: 100 GB al mes para toda la cuenta de Vercel (GB
          decimales). La cifra real solo la da Vercel:{" "}
          <a
            href={URL_USO_VERCEL}
            target="_blank"
            rel="noopener noreferrer"
            className="touch-hit inline-flex items-center gap-0.5 font-medium text-primary underline-offset-2 hover:underline"
          >
            ver uso en Vercel <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-0">
        {total?.alerta_80 && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <p>
              <strong>ESTIMACIÓN:</strong> la proyección a fin de mes ({fmtBytes(proyTotal)}) supera el 80 % del límite de
              100 GB. Revisa el uso real en Vercel.
            </p>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="text-sm text-muted-foreground">
              Consumido (estimado):{" "}
              <span className="text-lg font-semibold tabular-nums text-foreground">{fmtBytes(total?.bytes_acumulados)}</span>{" "}
              <span className="tabular-nums">({fmtPct(total?.pct_limite)})</span>
            </p>
            <p className="text-sm text-muted-foreground">
              Proyección fin de mes:{" "}
              <span className="font-semibold tabular-nums text-foreground">{fmtBytes(proyTotal)}</span>{" "}
              <span className="tabular-nums">({fmtPct(total?.pct_proyectado)})</span>
            </p>
          </div>
          <BarraLimite acumulado={total?.bytes_acumulados ?? null} proyectado={proyTotal} limite={limite} />
          {total && (
            <p className="text-xs text-muted-foreground">
              {total.dias_con_dato} de {total.dias_mes} días con datos · quedan {total.dias_restantes}. Proyección lineal{" "}
              {fmtBytes(total.bytes_proy_lineal)} · por regresión {fmtBytes(total.bytes_proy_regresion)}.
            </p>
          )}
        </div>

        {porProyecto.length > 0 && (
          <div className="grid gap-2 sm:grid-cols-2">
            {porProyecto.map((f) => {
              const destacado = proyectoSeleccionado === f.proyecto;
              const nombre = NOMBRE_PROYECTO[f.proyecto as ProyectoTrafico] ?? f.proyecto;
              return (
                <div
                  key={f.proyecto}
                  className={`rounded-md border p-3 text-xs ${destacado ? "border-primary/60 bg-primary/5" : "border-border/60"}`}
                >
                  <p className="mb-1 text-sm font-medium">{nombre}</p>
                  <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-muted-foreground">
                    <dt>Visitas del mes</dt>
                    <dd className="text-right tabular-nums text-foreground">{fmtNumero(f.visitas_mes)}</dd>
                    <dt>Consumido</dt>
                    <dd className="text-right tabular-nums text-foreground">{fmtBytes(f.bytes_acumulados)}</dd>
                    <dt>Peso medio/visita</dt>
                    <dd className="text-right tabular-nums text-foreground">{fmtBytes(f.bytes_medios_por_visita)}</dd>
                    <dt>Proyección fin de mes</dt>
                    <dd className="text-right tabular-nums text-foreground">{fmtBytes(proyeccionMax(f))}</dd>
                  </dl>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
