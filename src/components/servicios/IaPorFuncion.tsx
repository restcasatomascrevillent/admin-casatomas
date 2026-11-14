import { useMemo, useState } from "react";
import { AlertTriangle, Bot, Coins, Loader2 } from "lucide-react";
import { useCostePorUso } from "@/hooks/useCostePorUso";
import { type FilaCostePorUso, costesPorAccion, plural, textoCosteUso, totalesIa, ventanasIa } from "@/lib/costesServicios";
import { textoMes, textoMesCorto } from "@/lib/informeServicios";
import { formatearEur } from "@/lib/servicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";
import { formatearCambio } from "./TipoCambio";

const entero = (n: number) => n.toLocaleString("es-ES");

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/** «0,6 céntimos por documento», «gratis (en nuestro servidor)», «sin datos». */
function costePorUso(f: FilaCostePorUso, eurPorUsd: number): string {
  if (f.usosConCoste === 0) return "sin datos";
  const texto = textoCosteUso(f.medianaUsd, eurPorUsd, f.servidorPropio).replace(/^≈ /, "");
  return (f.medianaUsd ?? 0) <= 0 ? texto : `${texto} por ${f.unidad}`;
}

interface Props {
  eurPorUsd: number;
  hoy?: Date;
}

/**
 * Servicios › Costes › la IA en detalle (13/11/2026, pasos 3 y 4 del encargo):
 *   · «Cuánto cuesta cada cosa»: leer una factura, la etiqueta de un vino,
 *     traducir un plato, recortar una foto… con la MEDIANA del coste de cada
 *     vez en el mes (o del mes anterior si este aún no se ha usado).
 *   · «IA, función por función»: qué hace, llamadas este mes, coste y coste
 *     por uso, con el aviso de las llamadas de modelos sin tarifa (su coste no
 *     suma hasta que se da de alta la tarifa; entonces se recalcula solo).
 * Sale de `ia_coste_por_uso` (tokens × tarifa de `ia_uso`, sin IVA). Lo que
 * factura OpenAI de verdad está en el bloque de OpenAI, y la IA ya va dentro
 * del total del mes: aquí no se suma nada otra vez.
 */
export function IaPorFuncion({ eurPorUsd, hoy: hoyProp }: Props) {
  const [hoy] = useState(() => hoyProp ?? new Date());
  const v = useMemo(() => ventanasIa(hoy), [hoy]);
  const actualQ = useCostePorUso(v.actual.desde, v.actual.hasta);
  const anteriorQ = useCostePorUso(v.anterior.desde, v.anterior.hasta);
  const actual = actualQ.data?.disponible ? actualQ.data.filas : null;
  const anterior = anteriorQ.data?.disponible ? anteriorQ.data.filas : null;
  const sinMigracion = actualQ.data?.disponible === false;
  const mesTexto = textoMes(v.actual.mes);
  const mesAnteriorTexto = textoMes(v.anterior.mes);

  const acciones = useMemo(
    () => (actual ? costesPorAccion({ actual, anterior, eurPorUsd, textoMes: mesTexto, textoMesAnterior: mesAnteriorTexto }) : []),
    [actual, anterior, eurPorUsd, mesTexto, mesAnteriorTexto],
  );
  const totales = useMemo(() => (actual ? totalesIa(actual) : null), [actual]);
  const anteriorPorFuncion = useMemo(() => new Map((anterior ?? []).map((f) => [f.funcion, f])), [anterior]);

  const estado = sinMigracion ? (
    <Aviso>Falta aplicar en Supabase la migración 20261129153000_costes_servicios_ia: sin ella no se puede calcular el coste de cada cosa.</Aviso>
  ) : actualQ.isError ? (
    <p role="alert" className="text-sm text-destructive">No se pudo cargar el gasto de IA: {actualQ.error instanceof Error ? actualQ.error.message : "error desconocido"}.</p>
  ) : !actual ? (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Calculando el gasto de IA de {mesTexto}…
    </p>
  ) : null;

  return (
    <>
      <Bloque
        id="costes-cada-cosa"
        icono={<Coins />}
        titulo="Cuánto cuesta cada cosa"
        descripcion={`Lo que cuesta cada vez, a mitad de tabla (la mediana) de ${mesTexto}, con las tarifas de cada modelo y sin IVA.`}
      >
        {estado ?? (
          <>
            <ul className="min-w-0 divide-y divide-border/60 overflow-hidden rounded-md border" aria-label="Cuánto cuesta cada cosa" data-testid="coste-cada-cosa">
              {acciones.map((a) => (
                <li key={a.funcion} className="flex min-w-0 flex-col gap-0.5 p-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4" data-accion={a.funcion}>
                  <p className="min-w-0 break-words text-sm font-medium text-foreground">{a.accion}</p>
                  <p className="min-w-0 text-left sm:text-right">
                    <span className={cn("text-sm font-semibold tabular-nums", a.sinDatos ? "text-muted-foreground" : "text-foreground")}>{a.texto}</span>
                    {a.detalle && <span className="block text-xs text-muted-foreground">{a.detalle}{a.delMesAnterior ? " (este mes aún no se ha usado)" : ""}</span>}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">1 US$ = {formatearCambio(eurPorUsd)} €. Un céntimo es 0,01 €.</p>
          </>
        )}
      </Bloque>

      <Bloque
        id="costes-ia-funciones"
        icono={<Bot />}
        titulo="IA, función por función"
        descripcion={`Qué hace cada función de IA, cuántas llamadas lleva en ${mesTexto}, lo que ha costado y lo que cuesta cada vez.`}
      >
        {estado ?? (actual && totales && (
          <>
            {totales.filasSinTarifa > 0 && (
              <Aviso>
                {entero(totales.filasSinTarifa)} {totales.filasSinTarifa === 1 ? "llamada" : "llamadas"} de {totales.modelosSinTarifa.join(", ")} sin tarifa: su coste no está sumado.
                Hay que dar de alta el precio de ese modelo; entonces se recalcula solo.
              </Aviso>
            )}
            {actual.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este mes todavía no se ha usado ninguna función de IA.</p>
            ) : (
              <>
                <ul className="min-w-0 space-y-2 md:hidden" aria-label={`IA por función en ${mesTexto}`}>
                  {actual.map((f) => (
                    <li key={f.funcion} className="min-w-0 rounded-lg border p-3" data-ia-funcion={f.funcion}>
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-medium text-foreground">{f.queHace ?? f.funcion}</p>
                        <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">{f.costeUsd == null ? "—" : formatearEur(f.costeUsd * eurPorUsd)}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {entero(f.llamadas)} {f.llamadas === 1 ? "llamada" : "llamadas"} · {entero(f.usos)} {plural(f.unidad, f.usos)} · {costePorUso(f, eurPorUsd)}
                      </p>
                      {f.filasSinTarifa > 0 && <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">{entero(f.filasSinTarifa)} sin tarifa ({f.modelosSinTarifa.join(", ")})</p>}
                    </li>
                  ))}
                </ul>
                <div className="hidden min-w-0 overflow-x-auto rounded-md border md:block">
                  <table className="w-full min-w-[44rem] text-sm">
                    <caption className="sr-only">IA por función en {mesTexto}</caption>
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Qué hace</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Llamadas este mes</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Coste</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{textoMesCorto(v.anterior.mes).replace(/ \d{4}$/, "")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Coste por uso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {actual.map((f) => {
                        const antes = anteriorPorFuncion.get(f.funcion);
                        return (
                          <tr key={f.funcion} data-ia-funcion={f.funcion}>
                            <th scope="row" className="max-w-[22rem] px-3 py-2 text-left align-top font-normal text-foreground">
                              {f.queHace ?? f.funcion}
                              <span className="block font-mono text-[11px] text-muted-foreground">{f.funcion}</span>
                              {f.filasSinTarifa > 0 && (
                                <span className="block text-xs text-amber-900 dark:text-amber-200">{entero(f.filasSinTarifa)} sin tarifa ({f.modelosSinTarifa.join(", ")})</span>
                              )}
                            </th>
                            <td className="px-3 py-2 text-right align-top tabular-nums">
                              {entero(f.llamadas)}
                              <span className="block text-xs text-muted-foreground">{entero(f.usos)} {plural(f.unidad, f.usos)}</span>
                            </td>
                            <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{f.costeUsd == null ? "—" : formatearEur(f.costeUsd * eurPorUsd)}</td>
                            <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">{antes?.costeUsd == null ? "—" : formatearEur(antes.costeUsd * eurPorUsd)}</td>
                            <td className="px-3 py-2 text-right align-top tabular-nums">{costePorUso(f, eurPorUsd)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/30">
                        <th scope="row" className="px-3 py-2 text-left font-semibold">Total</th>
                        <td className="px-3 py-2 text-right tabular-nums">{entero(totales.llamadas)}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums" data-testid="ia-total">{formatearEur(totales.costeUsd * eurPorUsd)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{anterior?.length ? formatearEur(totalesIa(anterior).costeUsd * eurPorUsd) : "—"}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
            <p className="text-xs text-muted-foreground">
              Sale de lo que registra cada función (tokens × tarifa de su modelo), sin IVA. Lo que factura OpenAI de verdad, por proceso, está en el bloque de OpenAI; y en el total del mes la IA ya va dentro de OpenAI: no se cuenta dos veces.
              La lectura de facturas se cuenta en «ocr-trabajo» (cada documento, una vez).
            </p>
          </>
        ))}
      </Bloque>
    </>
  );
}
