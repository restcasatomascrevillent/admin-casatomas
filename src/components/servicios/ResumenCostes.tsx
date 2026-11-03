import { useState } from "react";
import { CalendarClock, Gauge, Loader2, Pencil, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ConfigServicios, useGuardarTipoCambio } from "@/hooks/useServicios";
import { cn } from "@/lib/utils";
import {
  type FilaCoste,
  type Renovacion,
  type ResumenCostes as Resumen,
  fechaCorta,
  formatearCantidad,
  formatearEur,
  leerNumero,
  textoDias,
} from "@/lib/servicios";

/** Con 30 días o menos (o ya pasada) la renovación se marca. */
export const DIAS_RENOVACION_CERCANA = 30;

interface Props {
  resumen: Resumen;
  renovaciones: Renovacion[];
  /** Métricas a partir del 80 %. */
  avisos: number;
  config: ConfigServicios | null;
  /** false si falta 20261103160000: sin coste variable ni tipo de cambio editable. */
  costesDisponibles: boolean;
}

function Tile({ icono, titulo, valor, children }: { icono: React.ReactNode; titulo: string; valor: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border bg-card p-3 sm:p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icono}
        {titulo}
      </p>
      <p className="break-words text-2xl font-semibold tabular-nums leading-tight text-foreground">{valor}</p>
      {children && <div className="min-w-0 break-words text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}

/** «1 US$ = 0,8938 €», editable (solo super admin; se guarda en servicios_config). */
function TipoCambio({ config, editable }: { config: ConfigServicios | null; editable: boolean }) {
  const guardar = useGuardarTipoCambio();
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cambio = config?.eurPorUsd ?? null;
  const fmt = (n: number) => n.toLocaleString("es-ES", { minimumFractionDigits: 4, maximumFractionDigits: 6 });

  const enviar = async (valor: number) => {
    setError(null);
    try {
      await guardar.mutateAsync(valor);
      toast.success("Tipo de cambio guardado");
      setEditando(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el tipo de cambio.");
    }
  };
  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    const n = leerNumero(texto);
    if (n == null || Number.isNaN(n) || n <= 0.2 || n >= 5) {
      setError("Escribe cuántos euros vale un dólar (por ejemplo 0,92).");
      return;
    }
    void enviar(n);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      {editando ? (
        <form onSubmit={alEnviar} className="flex min-w-0 flex-wrap items-end gap-2" noValidate>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="servicios-tipo-cambio">Euros por 1 dólar</Label>
            <Input
              id="servicios-tipo-cambio"
              inputMode="decimal"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="h-11 w-32"
              aria-invalid={!!error}
              aria-describedby={error ? "servicios-tipo-cambio-error" : undefined}
              autoFocus
            />
          </div>
          <Button type="submit" className="h-11 gap-1.5" disabled={guardar.isPending}>
            {guardar.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
          <Button type="button" variant="outline" className="h-11" onClick={() => { setEditando(false); setError(null); }}>Cancelar</Button>
        </form>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            Tipo de cambio: <span className="font-medium tabular-nums text-foreground">1 US$ = {cambio == null ? "…" : `${fmt(cambio)} €`}</span>
          </span>
          {editable && cambio != null && (
            <Button type="button" variant="outline" className="h-11 gap-1.5 px-3" onClick={() => { setTexto(fmt(cambio)); setEditando(true); }} aria-label="Cambiar el tipo de cambio del dólar">
              <Pencil className="h-4 w-4" aria-hidden="true" />
              Cambiar
            </Button>
          )}
        </div>
      )}
      {error && <p id="servicios-tipo-cambio-error" className="text-xs text-destructive">{error}</p>}
      {config?.bce && editable && (
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Último del Banco Central Europeo: {fmt(config.bce.eurPorUsd)} € ({fechaCorta(config.bce.fecha)}).</span>
          {cambio != null && Math.abs(config.bce.eurPorUsd - cambio) >= 0.000001 && (
            <Button type="button" variant="ghost" className="h-11 px-2 text-xs underline underline-offset-2" disabled={guardar.isPending} onClick={() => void enviar(config.bce!.eurPorUsd)}>
              Usar el del BCE
            </Button>
          )}
        </p>
      )}
      {!editable && <p className="text-xs text-muted-foreground">Falta la migración de costes: se usa 0,92 € por dólar.</p>}
    </div>
  );
}

/** «cuota 17,88 € + uso 1,20 €», con el importe original si no es en euros. */
function detalleFila(f: FilaCoste): string {
  const partes: string[] = [];
  if (f.fijo && f.fijo.importe > 0) {
    const original = f.fijo.moneda.toUpperCase() === "EUR" ? "" : ` (${formatearCantidad(f.fijo.importe, f.fijo.moneda)})`;
    partes.push(`cuota ${formatearEur(f.fijoEur ?? 0)}${original}`);
  }
  if (f.variable && f.variable.importe > 0) {
    const original = f.variable.moneda.toUpperCase() === "EUR" ? "" : ` (${formatearCantidad(f.variable.importe, f.variable.moneda)})`;
    partes.push(`uso ${formatearEur(f.variableEur)}${original}`);
  }
  return partes.join(" + ");
}

/** Desglose por proveedor: barras horizontales (una sola serie: € al mes), con la cifra escrita. */
function Desglose({ filas }: { filas: FilaCoste[] }) {
  const conGasto = filas.filter((f) => f.totalEur > 0);
  const sinGasto = filas.filter((f) => f.totalEur <= 0);
  const max = Math.max(...conGasto.map((f) => f.totalEur), 0);
  return (
    <div className="min-w-0 space-y-2">
      <h3 id="servicios-desglose" className="text-sm font-semibold text-foreground">Coste de este mes por proveedor</h3>
      {conGasto.length === 0 ? (
        <p className="text-sm text-muted-foreground">Este mes no hay ningún gasto medido: todo lo que se usa está en planes gratis o sin consumo.</p>
      ) : (
        <ul className="min-w-0 space-y-2.5" aria-labelledby="servicios-desglose">
          {conGasto.map((f) => {
            const detalle = detalleFila(f);
            return (
              <li key={f.proveedor} className="min-w-0 space-y-1" data-coste={f.proveedor}>
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3">
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">
                    {f.nombre}
                    {f.porConfirmar && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(por confirmar)</span>}
                  </span>
                  <span className="text-sm tabular-nums text-foreground">{formatearEur(f.totalEur)}</span>
                </div>
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true" title={`${f.nombre}: ${formatearEur(f.totalEur)}`}>
                  <div className="h-full rounded-full bg-sky-700 dark:bg-sky-400" style={{ width: `${Math.max(2, (f.totalEur / max) * 100)}%` }} />
                </div>
                {detalle && <p className="break-words text-xs text-muted-foreground">{detalle}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {sinGasto.length > 0 && (
        <p className="break-words text-xs text-muted-foreground">
          <span className="font-medium">Gratis o sin gasto este mes:</span> {sinGasto.map((f) => f.nombre).join(", ")}.
        </p>
      )}
    </div>
  );
}

function ListaRenovaciones({ renovaciones }: { renovaciones: Renovacion[] }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 id="servicios-renovaciones" className="text-sm font-semibold text-foreground">Próximas renovaciones</h3>
      {renovaciones.length === 0 ? (
        <p className="text-sm text-muted-foreground">Ninguna fecha apuntada. Ponlas en «Editar» de cada servicio (por ejemplo, la caducidad del dominio).</p>
      ) : (
        <ul className="min-w-0 divide-y divide-border/60" aria-labelledby="servicios-renovaciones">
          {renovaciones.slice(0, 6).map((r) => {
            const cerca = r.dias <= DIAS_RENOVACION_CERCANA;
            return (
              <li key={`${r.proveedor}-${r.concepto}-${r.fecha}`} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-sm">
                <span className="min-w-0 break-words">
                  <span className="font-medium text-foreground">{r.nombre}</span>
                  <span className="text-muted-foreground"> · {r.concepto}{r.deLaApi ? " (según su API)" : ""}</span>
                </span>
                <span className={cn("tabular-nums", r.dias < 0 ? "font-medium text-red-800 dark:text-red-300" : cerca ? "font-medium text-amber-900 dark:text-amber-200" : "text-muted-foreground")}>
                  {fechaCorta(r.fecha)} · {r.dias < 0 ? `pasó ${textoDias(r.dias)}` : textoDias(r.dias)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Arriba de Super Admin › Servicios: cuánto cuesta todo (al mes y al año, en
 * euros), de qué proveedor sale, qué se renueva pronto y el tipo de cambio.
 */
export function ResumenCostes({ resumen, renovaciones, avisos, config, costesDisponibles }: Props) {
  const proxima = renovaciones.find((r) => r.dias >= 0) ?? renovaciones[0] ?? null;
  return (
    <section aria-labelledby="servicios-coste" className="flex min-w-0 flex-col gap-4 rounded-lg border bg-muted/30 p-3 sm:p-4">
      <h2 id="servicios-coste" className="text-lg font-semibold text-foreground">Coste y renovaciones</h2>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile icono={<Wallet className="h-4 w-4" aria-hidden="true" />} titulo="Este mes" valor={formatearEur(resumen.totalMesEur)}>
          {formatearEur(resumen.fijoMesEur)} de cuotas + {formatearEur(resumen.variableMesEur)} por uso (lo gastado hasta hoy).
        </Tile>
        <Tile icono={<Wallet className="h-4 w-4" aria-hidden="true" />} titulo="Al año (previsión)" valor={formatearEur(resumen.previsionAnioEur)}>
          Cuotas: {formatearEur(resumen.fijoAnioEur)} al año; el uso, al ritmo de este mes.
        </Tile>
        <Tile
          icono={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
          titulo="Próxima renovación"
          valor={proxima ? fechaCorta(proxima.fecha) : "Sin fechas"}
        >
          {proxima ? `${proxima.nombre} · ${proxima.dias < 0 ? `pasó ${textoDias(proxima.dias)}` : textoDias(proxima.dias)}` : "Apúntalas en «Editar» de cada servicio."}
        </Tile>
        <Tile
          icono={<Gauge className="h-4 w-4" aria-hidden="true" />}
          titulo="Consumo"
          valor={avisos === 0 ? "Bien" : `${avisos} ${avisos === 1 ? "aviso" : "avisos"}`}
        >
          {avisos === 0 ? "Nada pasa del 80 % de su límite." : `${avisos === 1 ? "Una métrica pasa" : `${avisos} métricas pasan`} del 80 % de su límite: mira el aviso de arriba.`}
        </Tile>
      </div>

      {(resumen.sinPrecio.length > 0 || resumen.porConfirmar.length > 0) && (
        <p className="break-words text-xs text-muted-foreground">
          {resumen.sinPrecio.length > 0 && <>El total no incluye lo que no tiene precio apuntado: {resumen.sinPrecio.join(", ")}. </>}
          {resumen.porConfirmar.length > 0 && <>Plan o precio por confirmar: {resumen.porConfirmar.join(", ")}.</>}
        </p>
      )}
      {!costesDisponibles && (
        <p className="break-words text-xs text-amber-900 dark:text-amber-200">
          Falta aplicar en Supabase la migración 20261103160000_servicios_planes_costes: hasta entonces no se ven el gasto por uso ni los proveedores nuevos.
        </p>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
        <Desglose filas={resumen.filas} />
        <div className="flex min-w-0 flex-col gap-4">
          <ListaRenovaciones renovaciones={renovaciones} />
          {(resumen.hayUsd || config) && <TipoCambio config={config} editable={costesDisponibles && !!config?.guardada} />}
        </div>
      </div>
    </section>
  );
}
