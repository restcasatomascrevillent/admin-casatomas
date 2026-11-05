// Fila 3 del tablero: «Lo que más ha subido», «Precio de un producto»,
// «Gasto por familia», «Gastos fijos al mes», «Abonos por proveedor» y
// «Casa Tomás y Touza».
import { forwardRef, useDeferredValue, useState } from "react";
import { ArrowUp, Loader2, Search, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { useBuscarProductosComprados, useSeriePrecioProducto } from "@/hooks/useTableroCompras";
import {
  nombreCorto,
  textoPct,
  textoTramos,
  type AbonoProveedor,
  type TableroCompras,
} from "@/lib/facturas/tableroCompras";
import { COLOR_CASA_TOMAS, COLOR_TOUZA, FOCO, SinDatos, Tarjeta } from "./piezas";

const FILA = cn("flex min-h-11 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent", FOCO);

// ─── Lo que más ha subido ───────────────────────────────────────────────────

export function LoQueMasHaSubido({
  subidas,
  onProducto,
}: {
  subidas: TableroCompras["subidas"];
  onProducto: (producto: string) => void;
}) {
  const productos = subidas.productos.slice(0, 5);
  return (
    <Tarjeta
      titulo="Lo que más ha subido"
      subtitulo={`${textoTramos(subidas.tramoInicio, subidas.tramoFin)} · sin IVA`}
      resumen={
        productos.length
          ? `Sube más: ${productos.slice(0, 3).map((p) => `${p.producto} ${textoPct(p.variacion_pct)}`).join(", ")}.`
          : "Ningún producto ha subido de precio en este periodo."
      }
      testId="tarjeta-subidas"
    >
      {productos.length === 0 ? (
        <SinDatos>
          {subidas.comparados > 0
            ? `De ${plural(subidas.comparados, "producto comparado", "productos comparados")}, ninguno ha subido.`
            : "No hay compras suficientes para comparar precios en este periodo."}
        </SinDatos>
      ) : (
        <ol className="space-y-0.5" aria-label="Productos que más han subido">
          {productos.map((p) => (
            <li key={`${p.proveedor_id}-${p.nombre_normalizado}-${p.unidad}`}>
              <button
                type="button"
                className={FILA}
                onClick={() => onProducto(p.producto)}
                aria-label={`${p.producto} (${p.proveedor}): de ${formatCurrency(p.precio_inicio)} a ${formatCurrency(p.precio_fin)} el ${p.unidad}, ${textoPct(p.variacion_pct)}. Ver su precio`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{p.producto}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {nombreCorto(p.proveedor)} · {formatCurrency(p.precio_inicio)} → {formatCurrency(p.precio_fin)}/{p.unidad}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium tabular-nums text-red-700 dark:text-red-400">
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  {textoPct(p.variacion_pct, false)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  );
}

// ─── Precio de un producto ──────────────────────────────────────────────────

export const PrecioDeUnProducto = forwardRef<
  HTMLInputElement,
  { producto: string | null; onProducto: (p: string | null) => void }
>(function PrecioDeUnProducto({ producto, onProducto }, ref) {
  const [texto, setTexto] = useState("");
  const diferido = useDeferredValue(texto);
  const buscando = !producto && diferido.trim().length >= 2;
  const resultados = useBuscarProductosComprados(buscando ? diferido : "");
  const serie = useSeriePrecioProducto(producto);

  return (
    <Tarjeta
      titulo="Precio de un producto"
      subtitulo="Precio unitario sin IVA, una línea por proveedor"
      testId="tarjeta-precio-producto"
      className="md:row-span-1"
    >
      {producto ? (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate text-sm font-medium" title={producto}>
              {producto}
            </p>
            <button
              type="button"
              onClick={() => {
                onProducto(null);
                setTexto("");
              }}
              className={cn("inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground", FOCO)}
            >
              <X className="h-3.5 w-3.5" aria-hidden /> Otro producto
            </button>
          </div>
          {serie.isLoading ? (
            <div className="h-40 animate-pulse rounded-md bg-muted/60" role="status" aria-label="Cargando el precio" />
          ) : serie.isError ? (
            <p className="text-sm text-destructive" role="alert">
              No se ha podido leer el precio.{" "}
              <button type="button" className={cn("min-h-11 underline", FOCO)} onClick={() => void serie.refetch()}>
                Reintentar
              </button>
            </p>
          ) : (
            <GraficoSeriePrecio datos={serie.data} compacto alto={170} />
          )}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-1">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              ref={ref}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Busca un producto: gamba, tomate, aceite…"
              aria-label="Buscar producto para ver su precio"
              className="h-11 pl-9 text-base"
            />
          </div>
          {buscando && (
            <ul className="max-h-48 overflow-y-auto" aria-label="Productos comprados">
              {resultados.isLoading && (
                <li className="flex items-center gap-2 px-2 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando…
                </li>
              )}
              {resultados.isError && <li className="px-2 py-2 text-sm text-destructive">No se ha podido buscar.</li>}
              {resultados.data?.length === 0 && <li className="px-2 py-2 text-sm text-muted-foreground">Ningún producto comprado se llama así.</li>}
              {resultados.data?.map((nombre) => (
                <li key={nombre}>
                  <button type="button" className={cn(FILA, "text-sm")} onClick={() => onProducto(nombre)}>
                    <span className="min-w-0 truncate">{nombre}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!buscando && <p className="py-2 text-xs text-muted-foreground">Escribe al menos 2 letras o toca un producto de «Lo que más ha subido».</p>}
        </div>
      )}
    </Tarjeta>
  );
});

// ─── Gasto por familia ──────────────────────────────────────────────────────

export function GastoPorFamilia({ familias, onClasificar }: { familias: TableroCompras["familias"]; onClasificar: () => void }) {
  const { sinClasificar, importeTotal } = familias;
  const max = Math.max(1, ...familias.familias.map((f) => f.importe));
  const pctSin = importeTotal > 0 ? (sinClasificar.importe / importeTotal) * 100 : 0;
  return (
    <Tarjeta
      titulo="Gasto por familia"
      subtitulo="Base sin IVA de las líneas"
      resumen={
        familias.familias.length
          ? `La familia con más gasto es ${familias.familias[0].familia}, ${formatCurrency(familias.familias[0].importe)}. ${formatEntero(sinClasificar.lineas)} líneas sin clasificar.`
          : `${formatEntero(sinClasificar.lineas)} líneas sin clasificar: aún no hay reparto por familia.`
      }
      testId="tarjeta-familias"
    >
      {sinClasificar.lineas > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-sm text-amber-900 dark:text-amber-200" role="note">
          <span className="min-w-0 flex-1">
            <strong className="font-medium">{plural(sinClasificar.lineas, "línea sin clasificar", "líneas sin clasificar")}</strong>{" "}
            <span className="text-xs">
              ({formatCurrency(sinClasificar.importe)}, {textoPct(pctSin, false)} del gasto): no cuentan en ninguna familia.
            </span>
          </span>
          <button
            type="button"
            onClick={onClasificar}
            className={cn("inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-amber-600/40 bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60", FOCO)}
          >
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Clasificar con IA
          </button>
        </div>
      )}
      {familias.familias.length === 0 ? (
        <SinDatos>Ninguna línea de este periodo tiene familia todavía.</SinDatos>
      ) : (
        <ul className="space-y-1.5">
          {familias.familias.map((f) => (
            <li key={f.id ?? f.familia} className="text-sm">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{f.familia}</span>
                <span className="shrink-0 tabular-nums">{formatCurrency(f.importe)}</span>
              </span>
              <span className="mt-0.5 block h-1.5 w-full rounded-full bg-muted/60" aria-hidden>
                <span className={cn("block h-full rounded-full", COLOR_CASA_TOMAS)} style={{ width: `${(f.importe / max) * 100}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  );
}

// ─── Gastos fijos al mes ────────────────────────────────────────────────────

export function GastosFijos({ fijos, onProveedor }: { fijos: TableroCompras["fijos"]; onProveedor: (id: number) => void }) {
  const lista = fijos.proveedores;
  const visibles = lista.slice(0, 6);
  return (
    <Tarjeta
      titulo="Gastos fijos al mes"
      subtitulo={
        lista.length
          ? `≈ ${formatCurrency(fijos.totalMedioMes)} al mes con IVA · facturan casi todos los meses`
          : "Con IVA · proveedores que facturan casi todos los meses"
      }
      resumen={
        lista.length
          ? `${plural(lista.length, "gasto fijo", "gastos fijos")}, unos ${formatCurrency(fijos.totalMedioMes)} al mes. El mayor, ${nombreCorto(lista[0].nombre)} con ${formatCurrency(lista[0].medio_mes)}.`
          : "Sin gastos fijos detectados."
      }
      testId="tarjeta-fijos"
    >
      {lista.length === 0 ? (
        <SinDatos>Hacen falta al menos 3 meses con facturas para reconocer los gastos fijos.</SinDatos>
      ) : (
        <>
          <ul className="space-y-0.5">
            {visibles.map((f) => (
              <li key={f.id ?? f.nombre}>
                <button
                  type="button"
                  className={FILA}
                  disabled={f.id === null}
                  onClick={() => f.id !== null && onProveedor(f.id)}
                  title={f.nombre}
                  aria-label={`${f.nombre}: ${formatCurrency(f.medio_mes)} al mes de media, ${f.meses} de ${f.meses_con_datos} meses. Ver en Compras`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm">{nombreCorto(f.nombre)}</span>
                  <span className="shrink-0 text-sm tabular-nums">{formatCurrency(f.medio_mes)}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">/mes</span>
                </button>
              </li>
            ))}
          </ul>
          {lista.length > visibles.length && (
            <p className="mt-1 px-1.5 text-xs text-muted-foreground">
              Y {plural(lista.length - visibles.length, "más", "más")}: {lista.slice(6).map((f) => nombreCorto(f.nombre)).join(", ")}.
            </p>
          )}
        </>
      )}
    </Tarjeta>
  );
}

// ─── Abonos por proveedor ───────────────────────────────────────────────────

export function AbonosPorProveedor({ abonos, onProveedor }: { abonos: AbonoProveedor[]; onProveedor: (id: number) => void }) {
  const total = abonos.reduce((s, a) => s + a.importe, 0);
  return (
    <Tarjeta
      titulo="Abonos por proveedor"
      subtitulo="Devoluciones y rectificativas, con IVA"
      resumen={abonos.length ? `${plural(abonos.length, "proveedor", "proveedores")} con abonos; el mayor, ${nombreCorto(abonos[0].nombre)} con ${formatImporte(abonos[0].importe)}.` : "Sin abonos."}
      testId="tarjeta-abonos"
    >
      {abonos.length === 0 ? (
        <SinDatos>No hay abonos en este periodo.</SinDatos>
      ) : (
        <ul className="space-y-0.5">
          {abonos.map((a) => (
            <li key={a.id ?? a.nombre}>
              <button
                type="button"
                className={FILA}
                disabled={a.id === null}
                onClick={() => a.id !== null && onProveedor(a.id)}
                title={a.nombre}
                aria-label={`${a.nombre}: ${formatImporte(a.importe)} en ${plural(a.documentos, "abono", "abonos")}. Ver en Compras`}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{nombreCorto(a.nombre)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{plural(a.documentos, "doc.", "docs.")}</span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums">{formatImporte(a.importe)}</span>
              </button>
            </li>
          ))}
          {abonos.length > 1 && (
            <li className="flex px-1.5 pt-1 text-xs text-muted-foreground">
              <span className="flex-1">Estos {abonos.length}</span>
              <span className="tabular-nums">{formatImporte(total)}</span>
            </li>
          )}
        </ul>
      )}
    </Tarjeta>
  );
}

// ─── Casa Tomás y Touza ─────────────────────────────────────────────────────

export function CasaTomasYTouza({ locales }: { locales: TableroCompras["locales"] }) {
  const ct = locales.casaTomas.gasto;
  const tz = locales.touza.gasto;
  const total = ct + tz;
  const pctTz = total > 0 ? (Math.max(0, tz) / total) * 100 : 0;
  const pctCt = total > 0 ? 100 - pctTz : 0;
  return (
    <Tarjeta
      titulo="Casa Tomás y Touza"
      subtitulo="Con IVA · los dos locales, aunque filtres por uno"
      resumen={total > 0 ? `Casa Tomás ${formatCurrency(ct)} (${textoPct(pctCt, false)}); Touza ${formatCurrency(tz)} (${textoPct(pctTz, false)}).` : "Sin gasto en el periodo."}
      testId="tarjeta-locales"
    >
      {total <= 0 ? (
        <SinDatos>No hay gasto en este periodo.</SinDatos>
      ) : (
        <div className="space-y-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden>
            <span className={COLOR_CASA_TOMAS} style={{ width: `${pctCt}%` }} />
            <span className={COLOR_TOUZA} style={{ width: `${pctTz}%` }} />
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_CASA_TOMAS)} aria-hidden /> Casa Tomás
              </dt>
              <dd className="font-medium tabular-nums">{formatCurrency(ct)}</dd>
              <dd className="text-xs text-muted-foreground">
                {textoPct(pctCt, false)} · {plural(locales.casaTomas.documentos, "documento", "documentos")}
              </dd>
            </div>
            <div>
              <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_TOUZA)} aria-hidden /> Touza
              </dt>
              <dd className="font-medium tabular-nums">{formatCurrency(tz)}</dd>
              <dd className="text-xs text-muted-foreground">
                {textoPct(pctTz, false)} · {plural(locales.touza.documentos, "documento", "documentos")}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </Tarjeta>
  );
}
