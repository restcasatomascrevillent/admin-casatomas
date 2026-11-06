// Tarjetas de detalle del tablero: «Lo que más ha subido», «Gasto por
// familia», «Gastos fijos al mes», «Abonos por proveedor» y «Casa Tomás y
// Touza». Cada fila abre un menú (ver sus documentos, Compras, explorador) y
// la cabecera amplía la tarjeta (detalle en grande con filtros).
//
// Las filas se ordenan por el ancho de SU tarjeta (container queries): en una
// estrecha, el nombre va en su línea y las cifras debajo, alineadas; nunca se
// parte letra a letra ni se corta una cifra (QA 06/11/2026, con la IA abierta).
// «Precio de un producto» ya no es tarjeta: es un preset del explorador.
import { useId, useState } from "react";
import { ArrowUp, ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import {
  nombreCorto,
  textoPct,
  textoTramos,
  type AbonoProveedor,
  type Familia,
  type GastoFijo,
  type Subida,
  type TableroCompras,
} from "@/lib/facturas/tableroCompras";
import { formasImporte } from "@/lib/facturas/cifras";
import type { Tamano } from "@/lib/facturas/widgetsTablero";
import { Cifra } from "./Cifra";
import {
  BotonVerMas,
  COLOR_CASA_TOMAS,
  COLOR_TOUZA,
  ContenidoFilaBarra,
  ContenidoFilaDoble,
  FILA_BARRA,
  FILA_DOBLE,
  FILAS_TAMANO,
  FilaConMenu,
  FOCO,
  SinDatos,
  Tarjeta,
  type AccionMenu,
} from "./piezas";

interface Comunes {
  tamano?: Tamano;
  onAmpliar?: () => void;
}

/** Lista que pasa a dos columnas cuando la tarjeta es muy ancha (módulo grande). */
const LISTA = "space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0";

// ─── Lo que más ha subido ───────────────────────────────────────────────────

export function LoQueMasHaSubido({ subidas, acciones, tamano = "s", onAmpliar }: { subidas: TableroCompras["subidas"]; acciones: (s: Subida) => AccionMenu[] } & Comunes) {
  const productos = subidas.productos.slice(0, FILAS_TAMANO[tamano]);
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
      onAmpliar={onAmpliar}
    >
      {productos.length === 0 ? (
        <SinDatos>
          {subidas.comparados > 0
            ? `De ${plural(subidas.comparados, "producto comparado", "productos comparados")}, ninguno ha subido.`
            : "No hay compras suficientes para comparar precios en este periodo."}
        </SinDatos>
      ) : (
        <ol className={LISTA} aria-label="Productos que más han subido">
          {productos.map((p) => (
            <li key={`${p.proveedor_id}-${p.nombre_normalizado}-${p.unidad}`}>
              <FilaConMenu
                className={cn(
                  "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
                  FOCO,
                )}
                acciones={acciones(p)}
                title={`${p.producto} · ${p.proveedor}`}
                nombre={`${p.producto} (${p.proveedor}): de ${formatCurrency(p.precio_inicio)} a ${formatCurrency(p.precio_fin)} por ${p.unidad}, ${textoPct(p.variacion_pct)}. Opciones`}
              >
                <span className="min-w-0 truncate text-sm text-foreground">{p.producto}</span>
                <span className="inline-flex items-center gap-0.5 justify-self-end rounded-full bg-red-500/10 px-1.5 py-px text-sm font-medium tabular-nums text-red-700 dark:text-red-400">
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  {textoPct(p.variacion_pct, false)}
                </span>
                {/* El detalle, a todo lo ancho (debajo del nombre y del %). */}
                <span className="col-span-2 min-w-0 truncate text-xs text-muted-foreground">
                  {nombreCorto(p.proveedor)} · <span className="tabular-nums">{formatCurrency(p.precio_inicio)} → {formatCurrency(p.precio_fin)}/{p.unidad}</span>
                </span>
              </FilaConMenu>
            </li>
          ))}
        </ol>
      )}
    </Tarjeta>
  );
}

// ─── Gasto por familia ──────────────────────────────────────────────────────

export function GastoPorFamilia({
  familias,
  onClasificar,
  acciones,
  tamano = "s",
  onAmpliar,
}: {
  familias: TableroCompras["familias"];
  onClasificar: () => void;
  acciones: (f: Familia) => AccionMenu[];
} & Comunes) {
  const { sinClasificar, importeTotal } = familias;
  const [todas, setTodas] = useState(false);
  const idLista = useId();
  const limite = FILAS_TAMANO[tamano];
  const visibles = todas ? familias.familias : familias.familias.slice(0, limite);
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
      onAmpliar={onAmpliar}
    >
      {sinClasificar.lineas > 0 && (
        <div
          className="mb-2 flex flex-col items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-sm text-amber-900 @[26rem]:flex-row @[26rem]:items-center dark:text-amber-200"
          role="note"
        >
          <span className="min-w-0 flex-1">
            <strong className="font-medium">{plural(sinClasificar.lineas, "línea sin clasificar", "líneas sin clasificar")}</strong>{" "}
            <span className="text-xs">
              ({formatCurrency(sinClasificar.importe)}, {textoPct(pctSin, false)} del gasto): no cuentan en ninguna familia.
            </span>
          </span>
          <button
            type="button"
            onClick={onClasificar}
            className={cn(
              "relative z-10 inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md border border-amber-600/40 bg-background px-3 text-sm font-medium text-foreground hover:bg-muted/60",
              FOCO,
            )}
          >
            <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Clasificar con IA
          </button>
        </div>
      )}
      {familias.familias.length === 0 ? (
        <SinDatos>Ninguna línea de este periodo tiene familia todavía.</SinDatos>
      ) : (
        <>
          <ul className={LISTA} id={idLista}>
            {visibles.map((f) => (
              <li key={f.id ?? f.familia}>
                <FilaConMenu nombre={`${f.familia}: ${formatCurrency(f.importe)} sin IVA. Opciones`} acciones={acciones(f)} className={FILA_BARRA} title={f.familia}>
                  <ContenidoFilaBarra
                    nombre={f.familia}
                    valor={formatCurrency(f.importe)}
                    pct={importeTotal > 0 ? textoPct((f.importe / importeTotal) * 100, false) : null}
                    fraccion={f.importe / max}
                  />
                </FilaConMenu>
              </li>
            ))}
          </ul>
          <BotonVerMas total={familias.familias.length} visibles={limite} abierto={todas} onCambio={setTodas} controla={idLista} femenino />
        </>
      )}
    </Tarjeta>
  );
}

// ─── Gastos fijos al mes ────────────────────────────────────────────────────

export function GastosFijos({ fijos, acciones, tamano = "s", onAmpliar }: { fijos: TableroCompras["fijos"]; acciones: (f: GastoFijo) => AccionMenu[] } & Comunes) {
  const lista = fijos.proveedores;
  const [todos, setTodos] = useState(false);
  const idLista = useId();
  const limite = FILAS_TAMANO[tamano];
  const visibles = todos ? lista : lista.slice(0, limite);
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
      onAmpliar={onAmpliar}
    >
      {lista.length === 0 ? (
        <SinDatos>Hacen falta al menos 3 meses con facturas para reconocer los gastos fijos.</SinDatos>
      ) : (
        <>
          <ul className={LISTA} id={idLista}>
            {visibles.map((f) => (
              <li key={f.id ?? f.nombre}>
                <FilaConMenu
                  className={FILA_DOBLE}
                  acciones={acciones(f)}
                  title={f.nombre}
                  nombre={`${f.nombre}: ${formatCurrency(f.medio_mes)} al mes de media, ${f.meses} de ${f.meses_con_datos} meses. Opciones`}
                >
                  <ContenidoFilaDoble
                    nombre={nombreCorto(f.nombre)}
                    detalle={`${f.meses} de ${f.meses_con_datos} meses`}
                    valor={
                      <>
                        {formatCurrency(f.medio_mes)}
                        <span className="ml-0.5 text-xs font-normal text-muted-foreground">/mes</span>
                      </>
                    }
                  />
                </FilaConMenu>
              </li>
            ))}
          </ul>
          <BotonVerMas total={lista.length} visibles={limite} abierto={todos} onCambio={setTodos} controla={idLista} />
        </>
      )}
    </Tarjeta>
  );
}

// ─── Abonos por proveedor ───────────────────────────────────────────────────

export function AbonosPorProveedor({ abonos, acciones, tamano = "s", onAmpliar }: { abonos: AbonoProveedor[]; acciones: (a: AbonoProveedor) => AccionMenu[] } & Comunes) {
  const total = abonos.reduce((s, a) => s + a.importe, 0);
  const [todos, setTodos] = useState(false);
  const idLista = useId();
  const limite = FILAS_TAMANO[tamano];
  const visibles = todos ? abonos : abonos.slice(0, limite);
  return (
    <Tarjeta
      titulo="Abonos por proveedor"
      subtitulo="Devoluciones y rectificativas, con IVA"
      resumen={abonos.length ? `${plural(abonos.length, "proveedor", "proveedores")} con abonos; el mayor, ${nombreCorto(abonos[0].nombre)} con ${formatImporte(abonos[0].importe)}.` : "Sin abonos."}
      testId="tarjeta-abonos"
      onAmpliar={onAmpliar}
    >
      {abonos.length === 0 ? (
        <SinDatos>No hay abonos en este periodo.</SinDatos>
      ) : (
        <>
          <ul className={LISTA} id={idLista}>
            {visibles.map((a) => (
              <li key={a.id ?? a.nombre}>
                <FilaConMenu
                  className={FILA_DOBLE}
                  acciones={acciones(a)}
                  title={a.nombre}
                  nombre={`${a.nombre}: ${formatImporte(a.importe)} en ${plural(a.documentos, "abono", "abonos")}. Opciones`}
                >
                  <ContenidoFilaDoble nombre={nombreCorto(a.nombre)} detalle={plural(a.documentos, "documento", "documentos")} valor={formatImporte(a.importe)} />
                </FilaConMenu>
              </li>
            ))}
          </ul>
          {abonos.length > 1 && (
            <p className="mt-1 flex items-baseline gap-2 border-t border-border/60 px-1.5 pt-2 text-xs text-muted-foreground">
              <span className="flex-1">{abonos.length === visibles.length ? `Estos ${abonos.length}` : `Los ${abonos.length}`}</span>
              <span className="whitespace-nowrap text-sm font-medium tabular-nums text-foreground">{formatImporte(total)}</span>
            </p>
          )}
          <BotonVerMas total={abonos.length} visibles={limite} abierto={todos} onCambio={setTodos} controla={idLista} />
        </>
      )}
    </Tarjeta>
  );
}

// ─── Casa Tomás y Touza ─────────────────────────────────────────────────────

export function CasaTomasYTouza({
  locales,
  onVer,
  onAmpliar,
}: {
  locales: TableroCompras["locales"];
  /** Sin `onVer` (cargando otro periodo) los dos bloques no se pueden tocar. */
  onVer?: (local: "casa_tomas" | "touza", gasto: number) => void;
} & Comunes) {
  const ct = locales.casaTomas.gasto;
  const tz = locales.touza.gasto;
  const total = ct + tz;
  const pctTz = total > 0 ? (Math.max(0, tz) / total) * 100 : 0;
  const pctCt = total > 0 ? 100 - pctTz : 0;
  const bloques = [
    { clave: "casa_tomas" as const, nombre: "Casa Tomás", gasto: ct, pct: pctCt, docs: locales.casaTomas.documentos, color: COLOR_CASA_TOMAS },
    { clave: "touza" as const, nombre: "Touza", gasto: tz, pct: pctTz, docs: locales.touza.documentos, color: COLOR_TOUZA },
  ];
  return (
    <Tarjeta
      titulo="Casa Tomás y Touza"
      subtitulo="Con IVA · los dos locales, aunque filtres por uno"
      resumen={total > 0 ? `Casa Tomás ${formatCurrency(ct)} (${textoPct(pctCt, false)}); Touza ${formatCurrency(tz)} (${textoPct(pctTz, false)}).` : "Sin gasto en el periodo."}
      testId="tarjeta-locales"
      onAmpliar={onAmpliar}
    >
      {total <= 0 ? (
        <SinDatos>No hay gasto en este periodo.</SinDatos>
      ) : (
        <div className="space-y-3">
          <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted/60" aria-hidden>
            <span className={cn("rounded-l-full", pctTz <= 0 && "rounded-r-full", COLOR_CASA_TOMAS)} style={{ width: `${pctCt}%` }} />
            {pctTz > 0 && <span className={cn("min-w-1 rounded-r-full", COLOR_TOUZA)} style={{ width: `${pctTz}%` }} />}
          </div>
          <ul className="grid grid-cols-1 gap-2 text-sm @[17rem]:grid-cols-2">
            {bloques.map((b) => (
              <li key={b.clave} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => onVer?.(b.clave, b.gasto)}
                  disabled={!onVer}
                  className={cn(
                    "group flex min-h-11 w-full min-w-0 flex-col rounded-lg border border-border/60 px-2.5 py-2 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent",
                    FOCO,
                  )}
                >
                  <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", b.color)} aria-hidden /> {b.nombre}
                    <ChevronRight className="ml-auto h-3.5 w-3.5 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                  <Cifra formas={formasImporte(b.gasto)} className="mt-0.5 text-base font-semibold tabular-nums tracking-tight @[24rem]:text-lg" />
                  <span className="text-xs text-muted-foreground">
                    {textoPct(b.pct, false)} · {plural(b.docs, "documento", "documentos")}
                  </span>
                  <span className="sr-only">. Ver documentos</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tarjeta>
  );
}
