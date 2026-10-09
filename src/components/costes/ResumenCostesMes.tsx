import { useState } from "react";
import { CalendarClock, Pencil, Receipt, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { ComponentType, ReactNode, SVGProps } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useFijarTopeIa } from "@/hooks/useGastoIa";
import { evaluarTope, fmtEurIa } from "@/lib/facturas/gastoIa";
import { esNulo, fmtEur, SIN_DATOS } from "./formato";
import type { ResumenCostesMes } from "./resumenMes";

interface KpiProps {
  titulo: string;
  valor: string;
  icono: ComponentType<SVGProps<SVGSVGElement>>;
  pie?: ReactNode;
  testId: string;
}

function Kpi({ titulo, valor, icono: Icono, pie, testId }: KpiProps) {
  const sinDatos = valor === SIN_DATOS;
  return (
    <Card data-testid={testId}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground sm:text-sm">{titulo}</p>
          <Icono className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </div>
        <p
          className={
            sinDatos
              ? "mt-1 text-lg font-medium italic text-muted-foreground"
              : "mt-1 text-xl font-semibold tabular-nums text-foreground sm:text-2xl"
          }
        >
          {valor}
        </p>
        {pie && <div className="mt-1 text-xs text-muted-foreground">{pie}</div>}
      </CardContent>
    </Card>
  );
}

/** Edita el tope mensual (RPC `fijar_tope_ia_mes`, solo super admin). */
function EditorTope({ topeEur }: { topeEur: number }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState(String(topeEur).replace(".", ","));
  const fijar = useFijarTopeIa();
  const valor = Number(texto.replace(",", "."));
  const valido = Number.isFinite(valor) && valor >= 0.01 && valor <= 10000;

  return (
    <Popover
      open={abierto}
      onOpenChange={(o) => {
        setAbierto(o);
        if (o) setTexto(String(topeEur).replace(".", ","));
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label="Cambiar el tope mensual de IA"
          data-testid="editar-tope-ia"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-2 p-3">
        <Label htmlFor="tope-ia-mes" className="text-xs">
          Tope mensual de IA (€)
        </Label>
        <Input
          id="tope-ia-mes"
          inputMode="decimal"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="h-11"
        />
        <p className="text-xs text-muted-foreground">
          Facturas avisa en ámbar al 80 % y en rojo al pasarlo. Entre 0,01 y 10.000 €.
        </p>
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={!valido || fijar.isPending}
          onClick={() =>
            fijar.mutate(valor, {
              onSuccess: () => {
                toast.success("Tope guardado");
                setAbierto(false);
              },
              onError: (e) => toast.error(e instanceof Error ? e.message : "No se ha podido guardar el tope"),
            })
          }
        >
          Guardar tope
        </Button>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Una sola fila de cifras: lo que llevamos este mes (fijos + IA real), la IA
 * del mes contra el tope y la previsión a fin de mes.
 */
export function ResumenCostesMesFila({ resumen, topeEur }: { resumen: ResumenCostesMes; topeEur: number }) {
  const tope = evaluarTope(resumen.iaEur, topeEur);
  const barra = tope.nivel === "superado" ? "bg-destructive" : tope.nivel === "aviso" ? "bg-amber-500" : "bg-primary";
  const aprox = resumen.fijosSinVerificar > 0;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Kpi
        testId="kpi-este-mes"
        titulo="Este mes"
        icono={Receipt}
        valor={esNulo(resumen.totalEur) ? SIN_DATOS : `${aprox ? "≥ " : ""}${fmtEur(resumen.totalEur)}`}
        pie={
          <>
            Fijos {fmtEur(resumen.fijosEur)} + IA {fmtEurIa(resumen.iaEur)}
            {resumen.origenIa === "estimado" && " (estimada)"}
            {aprox && ` · ${resumen.fijosSinVerificar} fijo${resumen.fijosSinVerificar === 1 ? "" : "s"} sin verificar`}
          </>
        }
      />

      <Card data-testid="kpi-ia-mes">
        <CardContent className="p-3 sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground sm:text-sm">IA este mes</p>
            <EditorTope topeEur={topeEur} />
          </div>
          <p
            className={
              esNulo(resumen.iaEur)
                ? "text-lg font-medium italic text-muted-foreground"
                : "text-xl font-semibold tabular-nums sm:text-2xl"
            }
          >
            {esNulo(resumen.iaEur) ? SIN_DATOS : fmtEurIa(resumen.iaEur)}
          </p>
          <div
            role="progressbar"
            aria-label="Gasto de IA frente al tope mensual"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, Math.round(tope.pct))}
            data-nivel={tope.nivel}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div className={`h-full ${barra} transition-all`} style={{ width: `${Math.min(100, tope.pct)}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">
            {Math.round(tope.pct)} % del tope de {fmtEurIa(topeEur)}
            {tope.nivel === "superado" && <span className="ml-1 font-medium text-destructive">· superado</span>}
            {tope.nivel === "aviso" && (
              <span className="ml-1 font-medium text-amber-700 dark:text-amber-400">· cerca del tope</span>
            )}
          </p>
        </CardContent>
      </Card>

      <Kpi
        testId="kpi-prevision"
        titulo="Previsión fin de mes"
        icono={CalendarClock}
        valor={esNulo(resumen.previsionEur) ? SIN_DATOS : `${aprox ? "≥ " : "≈ "}${fmtEur(resumen.previsionEur)}`}
        pie={
          <span className="inline-flex items-center gap-1">
            <Sparkles className="h-3 w-3" aria-hidden />
            IA al ritmo del mes: {fmtEurIa(resumen.iaPrevisionEur)}
          </span>
        }
      />
    </div>
  );
}
