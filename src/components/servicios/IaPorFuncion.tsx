import { useMemo, useState } from "react";
import { AlertTriangle, Bot, Coins, Loader2 } from "lucide-react";
import { useCostePorUso, useCuadreOpenai } from "@/hooks/useCostePorUso";
import { useIaFunciones } from "@/hooks/useCostes";
import { type FilaCostePorUso, costesPorAccion, gastoPorAccion, plural, resumirCuadreOpenai, textoCosteUso, totalesIa, ventanasIa } from "@/lib/costesServicios";
import { textoMes, textoMesCorto } from "@/lib/informeServicios";
import { fechaCorta, formatearEur, formatearPorcentaje } from "@/lib/servicios";
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
 *   · «Gasto de IA por acción» (17/11/2026): cada acción con sus usos del
 *     mes, lo gastado, su parte del total y lo que cuesta cada vez; lo que no
 *     se ha usado, lo que gasta sin estar en el catálogo y lo que no apunta su
 *     gasto; el aviso de los modelos sin tarifa y el cuadre con la factura.
 * Sale de `ia_coste_por_uso` (tokens × tarifa de `ia_uso`, sin IVA). Lo que
 * factura OpenAI de verdad está en el bloque de OpenAI, y la IA ya va dentro
 * del total del mes: aquí no se suma nada otra vez.
 */
export function IaPorFuncion({ eurPorUsd, hoy: hoyProp }: Props) {
  const [hoy] = useState(() => hoyProp ?? new Date());
  const v = useMemo(() => ventanasIa(hoy), [hoy]);
  const actualQ = useCostePorUso(v.actual.desde, v.actual.hasta);
  const anteriorQ = useCostePorUso(v.anterior.desde, v.anterior.hasta);
  const cuadreQ = useCuadreOpenai(v.actual.desde, v.actual.hasta);
  const cuadre = useMemo(() => resumirCuadreOpenai(cuadreQ.data ?? null, eurPorUsd), [cuadreQ.data, eurPorUsd]);
  const ultimoDiaReal = fechaCorta(cuadreQ.data?.ultimoDia ?? null);
  const actual = actualQ.data?.disponible ? actualQ.data.filas : null;
  const anterior = anteriorQ.data?.disponible ? anteriorQ.data.filas : null;
  const sinMigracion = actualQ.data?.disponible === false;
  const mesTexto = textoMes(v.actual.mes);
  const mesAnteriorTexto = textoMes(v.anterior.mes);

  const acciones = useMemo(
    () => (actual ? costesPorAccion({ actual, anterior, eurPorUsd, textoMes: mesTexto, textoMesAnterior: mesAnteriorTexto }) : []),
    [actual, anterior, eurPorUsd, mesTexto, mesAnteriorTexto],
  );
  // El catálogo de funciones de IA: si no carga, la tabla sale igual (solo con lo que ha gastado).
  const catalogoQ = useIaFunciones();
  const gasto = useMemo(() => (actual ? gastoPorAccion({ actual, anterior, catalogo: catalogoQ.data ?? null }) : null), [actual, anterior, catalogoQ.data]);
  const totales = gasto?.totales ?? null;

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
        titulo="Gasto de IA por acción"
        descripcion={`Lo que ha gastado en ${mesTexto} cada cosa que hace la IA (leer facturas, el chat, traducir, las novedades, los recortes…), cuántas veces se ha usado y lo que cuesta cada vez.`}
      >
        {estado ?? (actual && gasto && totales && (
          <>
            {totales.filasSinTarifa > 0 && (
              <Aviso>
                {entero(totales.filasSinTarifa)} {totales.filasSinTarifa === 1 ? "llamada" : "llamadas"} de {totales.modelosSinTarifa.join(", ")} sin tarifa: su coste no está sumado.
                Hay que dar de alta el precio de ese modelo; entonces se recalcula solo.
              </Aviso>
            )}
            {gasto.sinCatalogar.length > 0 && (
              <Aviso>
                <span data-testid="ia-sin-catalogar">
                  {gasto.sinCatalogar.length === 1 ? "Hay una función que gasta IA y no está en el catálogo" : `Hay ${gasto.sinCatalogar.length} funciones que gastan IA y no están en el catálogo`}: {gasto.sinCatalogar.join(", ")}.
                  Su gasto ya está sumado aquí, pero hay que darla de alta para que salga con su nombre.
                </span>
              </Aviso>
            )}
            {gasto.sinRegistro.length > 0 && (
              <Aviso>
                <span data-testid="ia-sin-registro">
                  {gasto.sinRegistro.map((f) => f.nombre).join(", ")}: usa IA pero no apunta su gasto. Lo que gaste entra en la factura de OpenAI y no en esta tabla.
                </span>
              </Aviso>
            )}
            {gasto.filas.length === 0 ? (
              <p className="text-sm text-muted-foreground">Este mes todavía no se ha usado ninguna función de IA.</p>
            ) : (
              <>
                <ul className="min-w-0 space-y-2 md:hidden" aria-label={`Gasto de IA por acción en ${mesTexto}`}>
                  {gasto.filas.map((f) => (
                    <li key={f.funcion} className="min-w-0 rounded-lg border p-3" data-ia-funcion={f.funcion}>
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <p className="min-w-0 break-words text-sm font-medium text-foreground">{f.nombre}</p>
                        <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">{f.costeUsd == null ? "—" : formatearEur(f.costeUsd * eurPorUsd)}</p>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {f.pct != null && f.pct > 0 ? `${formatearPorcentaje(f.pct)} del gasto · ` : ""}{entero(f.usos)} {plural(f.unidad, f.usos)} · {costePorUso(f, eurPorUsd)}
                      </p>
                      {f.filasSinTarifa > 0 && <p className="mt-1 text-xs text-amber-900 dark:text-amber-200">{entero(f.filasSinTarifa)} sin tarifa ({f.modelosSinTarifa.join(", ")})</p>}
                    </li>
                  ))}
                </ul>
                <div className="hidden min-w-0 overflow-x-auto rounded-md border md:block">
                  <table className="w-full min-w-[46rem] text-sm">
                    <caption className="sr-only">Gasto de IA por acción en {mesTexto}</caption>
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-left font-medium">Acción</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Veces este mes</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Gasto</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">% del gasto</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">{textoMesCorto(v.anterior.mes).replace(/ \d{4}$/, "")}</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Cada vez</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {gasto.filas.map((f) => (
                        <tr key={f.funcion} data-ia-funcion={f.funcion}>
                          <th scope="row" className="max-w-[22rem] px-3 py-2 text-left align-top font-normal text-foreground">
                            <span className="font-medium">{f.nombre}</span>
                            {f.queHace && f.queHace !== f.nombre && <span className="block text-xs text-muted-foreground">{f.queHace}</span>}
                            <span className="block font-mono text-[11px] text-muted-foreground">{f.funcion}</span>
                            {f.filasSinTarifa > 0 && (
                              <span className="block text-xs text-amber-900 dark:text-amber-200">{entero(f.filasSinTarifa)} sin tarifa ({f.modelosSinTarifa.join(", ")})</span>
                            )}
                          </th>
                          <td className="px-3 py-2 text-right align-top tabular-nums">
                            {entero(f.usos)} <span className="text-xs text-muted-foreground">{plural(f.unidad, f.usos)}</span>
                            <span className="block text-xs text-muted-foreground">{entero(f.llamadas)} {f.llamadas === 1 ? "llamada" : "llamadas"}</span>
                          </td>
                          <td className="px-3 py-2 text-right align-top font-semibold tabular-nums">{f.costeUsd == null ? "—" : formatearEur(f.costeUsd * eurPorUsd)}</td>
                          <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">{f.pct == null ? "—" : formatearPorcentaje(f.pct)}</td>
                          <td className="px-3 py-2 text-right align-top tabular-nums text-muted-foreground">{f.anteriorUsd == null ? "—" : formatearEur(f.anteriorUsd * eurPorUsd)}</td>
                          <td className="px-3 py-2 text-right align-top tabular-nums">{costePorUso(f, eurPorUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t bg-muted/30">
                        <th scope="row" className="px-3 py-2 text-left font-semibold">Total registrado</th>
                        <td className="px-3 py-2 text-right tabular-nums">{entero(totales.llamadas)} <span className="text-xs text-muted-foreground">llamadas</span></td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums" data-testid="ia-total">{formatearEur(totales.costeUsd * eurPorUsd)}</td>
                        <td />
                        <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{anterior?.length ? formatearEur(totalesIa(anterior).costeUsd * eurPorUsd) : "—"}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </>
            )}
            {gasto.sinUso.length > 0 && (
              <p className="text-xs text-muted-foreground" data-testid="ia-sin-uso">
                Sin usar este mes (0,00 €): {gasto.sinUso.map((f) => f.nombre).join(" · ")}.
              </p>
            )}
            {cuadre.estado !== "sin_datos" && (
              <div
                className={cn(
                  "min-w-0 rounded-md border p-3 text-sm",
                  cuadre.estado === "cuadra" ? "border-border bg-muted/30" : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100",
                )}
                data-testid="ia-cuadre"
                data-estado={cuadre.estado}
              >
                <p className="font-medium">Cuadre con la factura de OpenAI{ultimoDiaReal ? ` (días cerrados hasta el ${ultimoDiaReal})` : ""}</p>
                <dl className="mt-2 grid min-w-0 grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                  <dt>Facturado por OpenAI</dt>
                  <dd className="text-right font-semibold">{formatearEur(cuadre.realEur)}</dd>
                  <dt>Registrado por las funciones del panel y de la web</dt>
                  <dd className="text-right">{formatearEur(cuadre.registradoEur)}</dd>
                  {cuadre.estado === "fuera" && (
                    <>
                      <dt>Fuera de producción (demo y pruebas)</dt>
                      <dd className="text-right font-semibold" data-testid="ia-cuadre-fuera">{formatearEur(cuadre.fueraEur)}{cuadre.fueraPct != null ? ` · ${cuadre.fueraPct} %` : ""}</dd>
                    </>
                  )}
                </dl>
                <p className="mt-2 text-xs">
                  {cuadre.estado === "cuadra"
                    ? "Cuadra: todo lo que cobra OpenAI sale de las funciones de arriba."
                    : cuadre.estado === "fuera"
                      ? "La demo y las pruebas de modelos usan la misma clave de OpenAI que producción: su gasto entra en la factura (y en el total del mes) pero no en la tabla de arriba, que solo cuenta producción."
                      : "Aquí hay registrado más de lo que OpenAI ha facturado: alguna tarifa de modelo está por encima de la real. Revísalas en Modelos."}
                </p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Sale de lo que apunta cada función cada vez que usa la IA (tokens × tarifa de su modelo), sin IVA. En el total del mes la IA ya va dentro de OpenAI: no se cuenta dos veces.
              Recortar fotos se hace en nuestro servidor y no gasta IA de pago.
            </p>
          </>
        ))}
      </Bloque>
    </>
  );
}
