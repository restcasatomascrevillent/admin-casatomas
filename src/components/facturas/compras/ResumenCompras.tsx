import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import {
  mesCorto,
  type AgregadoProveedor,
  type FiltroLocal,
  type MesGrafica,
  type RangoMeses,
  type ResumenCompras as DatosResumen,
} from "@/lib/facturas/resumenCompras";

const CLAVE_PLEGADO = "compras.resumen.plegado";

const leerPlegado = (): boolean => {
  try {
    return window.localStorage.getItem(CLAVE_PLEGADO) === "1";
  } catch {
    return false;
  }
};
const guardarPlegado = (plegado: boolean) => {
  try {
    window.localStorage.setItem(CLAVE_PLEGADO, plegado ? "1" : "0");
  } catch {
    /* sin almacenamiento: solo en esta sesión */
  }
};

const COLOR_CASA_TOMAS = "bg-primary/80";
const COLOR_TOUZA = "bg-violet-500/80";

/** Una cifra del resumen: etiqueta gris encima, valor debajo. */
const Cifra = ({ etiqueta, valor, nota, clase = "" }: { etiqueta: string; valor: string; nota?: string; clase?: string }) => (
  <div className="min-w-0">
    <dt className="truncate text-xs font-medium text-muted-foreground">{etiqueta}</dt>
    <dd className={`truncate text-base font-semibold tabular-nums ${clase}`}>{valor}</dd>
    {nota && <dd className="truncate text-xs text-muted-foreground">{nota}</dd>}
  </div>
);

/**
 * Compras › resumen (rediseño del 05/11/2026): franja plegable encima de la
 * lista (el plegado se recuerda). Respeta el local y el periodo elegidos:
 * gasto neto con IVA, abonos, regalado / descuentos y nº de documentos; la
 * gráfica de los últimos 12 meses (apilada por local con «Todos»; los meses
 * del periodo resaltados) y el top 10 de proveedores por gasto. Tocar un mes
 * filtra ese mes; tocar un proveedor lo abre en Proveedores.
 */
export function ResumenCompras({
  datos,
  meses,
  top,
  local,
  rango,
  mesElegido,
  periodo,
  parcial,
  cargando,
  onElegirMes,
  onAbrirProveedor,
}: {
  datos: DatosResumen;
  meses: MesGrafica[];
  top: AgregadoProveedor[];
  local: FiltroLocal;
  /** Meses del periodo elegido (null = todo): se resaltan en la gráfica. */
  rango: RangoMeses | null;
  /** Mes elegido tocando la gráfica (null = un periodo del selector). */
  mesElegido: string | null;
  /** El periodo en palabras («Noviembre 2026»…). */
  periodo: string;
  /** Aún llegan tandas de documentos: las cifras no son las finales. */
  parcial: boolean;
  cargando: boolean;
  onElegirMes: (mes: string) => void;
  onAbrirProveedor: (a: AgregadoProveedor) => void;
}) {
  const [plegado, setPlegado] = useState(leerPlegado);
  const alternar = () =>
    setPlegado((v) => {
      guardarPlegado(!v);
      return !v;
    });
  const Chevron = plegado ? ChevronRight : ChevronDown;
  const maximo = Math.max(0, ...meses.map((m) => Math.max(m.total, m.casa_tomas + m.touza)));
  const maxTop = top[0]?.gasto ?? 0;
  const apilado = local === "todos";
  const resumenCorto = cargando ? "Cargando…" : `${formatImporte(datos.gasto)} con IVA · ${plural(datos.documentos, "documento", "documentos")}`;

  return (
    <section
      aria-labelledby="resumen-compras-titulo"
      className="flex max-h-[50%] min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm"
      data-tour="facturas-resumen"
    >
      <h2 id="resumen-compras-titulo" className="m-0 shrink-0 text-sm">
        <button
          type="button"
          onClick={alternar}
          aria-expanded={!plegado}
          aria-controls="resumen-compras-cuerpo"
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left font-semibold transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        >
          <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="shrink-0">Resumen</span>
          <span className="min-w-0 truncate font-normal text-muted-foreground">· {periodo}</span>
          {plegado && <span className="ml-auto shrink-0 truncate pl-2 font-normal tabular-nums">{resumenCorto}</span>}
        </button>
      </h2>

      {!plegado && (
        <div id="resumen-compras-cuerpo" className="min-h-0 space-y-3 overflow-y-auto overscroll-contain border-t border-border/50 px-3 py-2">
          {parcial && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400" role="status" data-testid="resumen-parcial">
              Cifras parciales: aún están llegando documentos anteriores.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-2" aria-label="Cifras del periodo">
              <Cifra etiqueta="Gasto neto con IVA" valor={formatImporte(datos.gasto)} />
              <Cifra
                etiqueta="Abonos"
                valor={datos.nAbonos > 0 ? formatImporte(datos.abonos) : "—"}
                nota={datos.nAbonos > 0 ? plural(datos.nAbonos, "abono", "abonos") : "ninguno"}
                clase={datos.nAbonos > 0 ? "text-emerald-700 dark:text-emerald-400" : ""}
              />
              <Cifra
                etiqueta="Regalado / descuentos"
                valor={formatCurrency(datos.regalado)}
                nota={`sin IVA${datos.regaladoEstimado ? " · estimado" : ""}`}
              />
              <Cifra etiqueta="Documentos" valor={formatEntero(datos.documentos)} />
            </dl>

            <figure className="m-0 min-w-0" aria-label="Gasto neto con IVA de los últimos 12 meses">
              <div className="flex h-32 items-stretch gap-0.5" role="group" aria-label="Meses: toca uno para ver solo ese mes">
                {meses.map((m) => {
                  const enPeriodo = !rango || (m.clave >= rango.desde && m.clave <= rango.hasta);
                  const elegido = mesElegido === m.clave;
                  const alto = (v: number) => `${maximo > 0 ? Math.max(0, (v / maximo) * 100) : 0}%`;
                  const detalle = apilado && m.touza !== 0 ? ` (Casa Tomás ${formatImporte(m.casa_tomas)}, Touza ${formatImporte(m.touza)})` : "";
                  return (
                    <button
                      key={m.clave}
                      type="button"
                      onClick={() => onElegirMes(m.clave)}
                      aria-pressed={elegido}
                      aria-label={`${etiquetaMes(m.clave)}: ${formatImporte(m.total)}${detalle}`}
                      className={`flex min-w-0 flex-1 flex-col items-stretch rounded-sm px-px transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                        elegido ? "bg-muted" : ""
                      }`}
                    >
                      <span className={`flex min-h-0 flex-1 flex-col justify-end ${enPeriodo ? "" : "opacity-40"}`} aria-hidden="true">
                        {apilado ? (
                          <>
                            <span className={`block w-full rounded-t-sm ${COLOR_TOUZA}`} style={{ height: alto(m.touza) }} />
                            <span className={`block w-full ${m.touza > 0 ? "" : "rounded-t-sm"} ${COLOR_CASA_TOMAS}`} style={{ height: alto(m.casa_tomas) }} />
                          </>
                        ) : (
                          <span className={`block w-full rounded-t-sm ${local === "touza" ? COLOR_TOUZA : COLOR_CASA_TOMAS}`} style={{ height: alto(m.total) }} />
                        )}
                      </span>
                      <span className={`truncate text-center text-xs ${elegido ? "font-semibold text-foreground" : "text-muted-foreground"}`} aria-hidden="true">
                        {mesCorto(m.clave)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                <span>Máximo {formatImporte(maximo)}</span>
                {apilado && (
                  <>
                    <span className="inline-flex items-center gap-1">
                      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOR_CASA_TOMAS}`} aria-hidden="true" /> Casa Tomás
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${COLOR_TOUZA}`} aria-hidden="true" /> Touza
                    </span>
                  </>
                )}
              </figcaption>
            </figure>
          </div>

          <div>
            <h3 className="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Top 10 proveedores <span className="font-normal normal-case tracking-normal">· gasto con IVA</span>
            </h3>
            {top.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Sin compras en este periodo.</p>
            ) : (
              <ol className="grid gap-x-4 sm:grid-cols-2 sm:grid-flow-col sm:grid-rows-5" aria-label="Top 10 proveedores por gasto">
                {top.map((a, i) => (
                  <li key={a.clave} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onAbrirProveedor(a)}
                      className="flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    >
                      <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{a.nombre}</span>
                        <span className="mt-0.5 block h-1.5 rounded-full bg-muted" aria-hidden="true">
                          <span className="block h-full rounded-full bg-primary/70" style={{ width: `${maxTop > 0 ? (a.gasto / maxTop) * 100 : 0}%` }} />
                        </span>
                      </span>
                      <span className="shrink-0 text-sm tabular-nums">{formatImporte(a.gasto)}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
