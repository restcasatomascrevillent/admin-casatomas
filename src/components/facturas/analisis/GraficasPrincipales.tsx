// Fila 2 del tablero: «Gasto por mes» (barras apiladas por local) y
// «Proveedores con más gasto» (barras horizontales finas).
//
// Barras en HTML, no en recharts: cada mes y cada proveedor es un BOTÓN de
// verdad (foco visible, nombre accesible, 44 px de alto como poco) que abre
// Compras filtrado. Cada gráfica trae su resumen en texto y su tabla.
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/components/facturas/shared/formatters";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import {
  marcaEje,
  nombreCorto,
  topeEje,
  resumenGastoMes,
  resumenProveedores,
  textoPct,
  type MesGasto,
  type ProveedorGasto,
} from "@/lib/facturas/tableroCompras";
import { COLOR_CASA_TOMAS, COLOR_TOUZA, FOCO, SinDatos, Tarjeta } from "./piezas";

const ALTO_BARRAS = 176;


function TablaMeses({ meses, apilado }: { meses: MesGasto[]; apilado: boolean }) {
  return (
    <details className="mt-2 text-sm">
      <summary className={cn("inline-flex min-h-11 cursor-pointer items-center rounded-md px-1 text-xs text-muted-foreground hover:text-foreground", FOCO)}>
        Ver como tabla
      </summary>
      <div className="max-h-56 overflow-y-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 font-medium">Mes</th>
              {apilado && <th className="py-1 text-right font-medium">Casa Tomás</th>}
              {apilado && <th className="py-1 text-right font-medium">Touza</th>}
              <th className="py-1 text-right font-medium">Total con IVA</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.mes} className="border-t border-border/40">
                <td className="py-1">{etiquetaMes(m.mes)}</td>
                {apilado && <td className="py-1 text-right">{formatCurrency(m.casa_tomas)}</td>}
                {apilado && <td className="py-1 text-right">{formatCurrency(m.touza)}</td>}
                <td className="py-1 text-right font-medium">{formatCurrency(m.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function GastoPorMes({
  meses,
  apilado,
  onMes,
  className,
}: {
  meses: MesGasto[];
  /** «Todos»: Casa Tomás y Touza apilados con leyenda. */
  apilado: boolean;
  onMes: (mes: string) => void;
  className?: string;
}) {
  const tope = topeEje(Math.max(0, ...meses.map((m) => Math.max(m.total, m.casa_tomas + m.touza))));
  const alto = (v: number) => `${Math.max(0, (v / tope) * 100)}%`;
  return (
    <Tarjeta
      titulo="Gasto por mes"
      subtitulo="Con IVA · toca un mes para ver sus documentos"
      resumen={resumenGastoMes(meses)}
      className={className}
      testId="tarjeta-gasto-mes"
      accion={
        apilado ? (
          <ul className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Leyenda">
            <li className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_CASA_TOMAS)} aria-hidden /> Casa Tomás
            </li>
            <li className="flex items-center gap-1.5">
              <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_TOUZA)} aria-hidden /> Touza
            </li>
          </ul>
        ) : undefined
      }
    >
      {meses.length === 0 ? (
        <SinDatos>No hay documentos en este periodo.</SinDatos>
      ) : (
        <>
          <div className="flex gap-2">
            {/* Eje: tope y mitad (decorativo; las cifras exactas, en cada barra y en la tabla). */}
            <div className="relative w-14 shrink-0 text-right text-[11px] text-muted-foreground" style={{ height: ALTO_BARRAS }} aria-hidden>
              <span className="absolute right-0 top-0 -translate-y-1/2">{marcaEje(tope)}</span>
              <span className="absolute right-0 top-1/2 -translate-y-1/2">{marcaEje(tope / 2)}</span>
              <span className="absolute bottom-0 right-0 translate-y-1/2">0</span>
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-border/60" aria-hidden />
              <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/60" aria-hidden style={{ top: ALTO_BARRAS / 2 }} />
              <ol className="flex items-stretch gap-0.5 sm:gap-1" aria-label="Meses">
                {meses.map((m) => {
                  const nombre = `${etiquetaMes(m.mes)}: ${formatCurrency(m.total)} con IVA${
                    apilado ? ` (Casa Tomás ${formatCurrency(m.casa_tomas)}, Touza ${formatCurrency(m.touza)})` : ""
                  }. Ver en Compras`;
                  return (
                    <li key={m.mes} className="flex min-w-0 flex-1 flex-col">
                      <button
                        type="button"
                        onClick={() => onMes(m.mes)}
                        aria-label={nombre}
                        title={nombre}
                        className={cn("group flex w-full flex-col justify-end rounded-md px-0.5 hover:bg-muted/50", FOCO)}
                        style={{ height: ALTO_BARRAS }}
                      >
                        <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm" style={{ height: alto(apilado ? m.casa_tomas + m.touza : m.total) }}>
                          {apilado ? (
                            <>
                              <span className={cn("w-full", COLOR_TOUZA)} style={{ height: m.casa_tomas + m.touza > 0 ? `${(m.touza / (m.casa_tomas + m.touza)) * 100}%` : 0 }} />
                              <span className={cn("w-full flex-1", COLOR_CASA_TOMAS)} />
                            </>
                          ) : (
                            <span className={cn("h-full w-full", COLOR_CASA_TOMAS)} />
                          )}
                        </span>
                      </button>
                      <span className="mt-1 truncate text-center text-[11px] text-muted-foreground" aria-hidden>
                        {mesCorto(m.mes, meses.length > 12 && m.mes.endsWith("-01"))}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
          <TablaMeses meses={meses} apilado={apilado} />
        </>
      )}
    </Tarjeta>
  );
}

const VISIBLES = 5;

export function ProveedoresTop({
  proveedores,
  onProveedor,
  className,
}: {
  proveedores: ProveedorGasto[];
  onProveedor: (p: ProveedorGasto) => void;
  className?: string;
}) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(1, ...proveedores.map((p) => p.gasto));
  const lista = todos ? proveedores : proveedores.slice(0, VISIBLES);
  return (
    <Tarjeta
      titulo="Proveedores con más gasto"
      subtitulo="Con IVA · % del gasto del periodo"
      resumen={resumenProveedores(proveedores)}
      className={className}
      testId="tarjeta-proveedores"
    >
      {proveedores.length === 0 ? (
        <SinDatos>Ningún proveedor con gasto en este periodo.</SinDatos>
      ) : (
        <>
          <ol className="space-y-0.5" aria-label="Proveedores por gasto" id="lista-proveedores-top">
            {lista.map((p, i) => (
              <li key={`${p.id ?? p.nombre}-${i}`}>
                <button
                  type="button"
                  onClick={() => onProveedor(p)}
                  disabled={p.id === null}
                  title={p.nombre}
                  aria-label={`${p.nombre}: ${formatCurrency(p.gasto)}${p.pct !== null ? `, ${textoPct(p.pct, false)} del total` : ""}. Ver en Compras`}
                  className={cn("flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default", FOCO)}
                >
                  <span className="flex w-full items-baseline gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{nombreCorto(p.nombre)}</span>
                    <span className="shrink-0 tabular-nums">{formatCurrency(p.gasto)}</span>
                    {p.pct !== null && <span className="w-12 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{textoPct(p.pct, false)}</span>}
                  </span>
                  <span className="h-1.5 w-full rounded-full bg-muted/60" aria-hidden>
                    <span className={cn("block h-full rounded-full", COLOR_CASA_TOMAS)} style={{ width: `${(p.gasto / max) * 100}%` }} />
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {proveedores.length > VISIBLES && (
            <button
              type="button"
              onClick={() => setTodos((v) => !v)}
              aria-expanded={todos}
              aria-controls="lista-proveedores-top"
              className={cn("mt-1 inline-flex min-h-11 items-center self-start rounded-md px-1.5 text-sm font-medium text-primary hover:underline", FOCO)}
            >
              {todos ? "Ver solo 5" : `Ver los ${proveedores.length}`}
            </button>
          )}
        </>
      )}
    </Tarjeta>
  );
}
