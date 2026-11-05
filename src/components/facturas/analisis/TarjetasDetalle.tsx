// Tarjetas de detalle del tablero: «Lo que más ha subido», «Gasto por
// familia», «Gastos fijos al mes», «Abonos por proveedor» y «Casa Tomás y
// Touza». Cada fila abre un menú (ver sus documentos, Compras, explorador).
// «Precio de un producto» ya no es tarjeta: es un preset del explorador.
import { useState } from "react";
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
import { COLOR_CASA_TOMAS, COLOR_TOUZA, FilaConMenu, FOCO, SinDatos, Tarjeta, type AccionMenu } from "./piezas";

const FILA = cn("flex min-h-11 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent", FOCO);
const FILA_BARRA = cn("flex min-h-11 w-full flex-col justify-center gap-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50", FOCO);

// ─── Lo que más ha subido ───────────────────────────────────────────────────

export function LoQueMasHaSubido({ subidas, acciones }: { subidas: TableroCompras["subidas"]; acciones: (s: Subida) => AccionMenu[] }) {
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
              <FilaConMenu
                className={FILA}
                acciones={acciones(p)}
                nombre={`${p.producto} (${p.proveedor}): de ${formatCurrency(p.precio_inicio)} a ${formatCurrency(p.precio_fin)} por ${p.unidad}, ${textoPct(p.variacion_pct)}. Opciones`}
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 break-words text-sm">{p.producto}</span>
                  <span className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {nombreCorto(p.proveedor)} · {formatCurrency(p.precio_inicio)} → {formatCurrency(p.precio_fin)}/{p.unidad}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium tabular-nums text-red-700 dark:text-red-400">
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                  {textoPct(p.variacion_pct, false)}
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
}: {
  familias: TableroCompras["familias"];
  onClasificar: () => void;
  acciones: (f: Familia) => AccionMenu[];
}) {
  const { sinClasificar, importeTotal } = familias;
  const [todas, setTodas] = useState(false);
  const visibles = todas ? familias.familias : familias.familias.slice(0, 6);
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
        <div className="mb-2 flex flex-col items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-2 text-sm text-amber-900 dark:text-amber-200" role="note">
          <span className="min-w-0">
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
        <>
        <ul className="space-y-0.5" id="lista-familias">
          {visibles.map((f) => (
            <li key={f.id ?? f.familia} className="text-sm">
              <FilaConMenu nombre={`${f.familia}: ${formatCurrency(f.importe)} sin IVA. Opciones`} acciones={acciones(f)} className={FILA_BARRA}>
                <span className="flex w-full items-baseline gap-2">
                  <span className="line-clamp-2 min-w-0 flex-1 break-words">{f.familia}</span>
                  <span className="shrink-0 tabular-nums">{formatCurrency(f.importe)}</span>
                </span>
                <span className="block h-1.5 w-full rounded-full bg-muted/60" aria-hidden>
                  <span className={cn("block h-full rounded-full", COLOR_CASA_TOMAS)} style={{ width: `${(f.importe / max) * 100}%` }} />
                </span>
              </FilaConMenu>
            </li>
          ))}
        </ul>
        {familias.familias.length > 6 && (
          <button
            type="button"
            onClick={() => setTodas((v) => !v)}
            aria-expanded={todas}
            aria-controls="lista-familias"
            className={cn("mt-1 inline-flex min-h-11 items-center self-start rounded-md px-1.5 text-sm font-medium text-primary hover:underline", FOCO)}
          >
            {todas ? "Ver solo 6" : `Ver las ${familias.familias.length}`}
          </button>
        )}
        </>
      )}
    </Tarjeta>
  );
}

// ─── Gastos fijos al mes ────────────────────────────────────────────────────

export function GastosFijos({ fijos, acciones }: { fijos: TableroCompras["fijos"]; acciones: (f: GastoFijo) => AccionMenu[] }) {
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
                <FilaConMenu
                  className={FILA}
                  acciones={acciones(f)}
                  title={f.nombre}
                  nombre={`${f.nombre}: ${formatCurrency(f.medio_mes)} al mes de media, ${f.meses} de ${f.meses_con_datos} meses. Opciones`}
                >
                  {/* En táctil no hay `title`: el nombre en dos líneas, no cortado (QA 05/11/2026). */}
                  <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm">{nombreCorto(f.nombre)}</span>
                  <span className="shrink-0 text-sm tabular-nums">{formatCurrency(f.medio_mes)}</span>
                  <span className="w-10 shrink-0 text-right text-xs text-muted-foreground">/mes</span>
                </FilaConMenu>
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

export function AbonosPorProveedor({ abonos, acciones }: { abonos: AbonoProveedor[]; acciones: (a: AbonoProveedor) => AccionMenu[] }) {
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
              <FilaConMenu
                className={FILA}
                acciones={acciones(a)}
                title={a.nombre}
                nombre={`${a.nombre}: ${formatImporte(a.importe)} en ${plural(a.documentos, "abono", "abonos")}. Opciones`}
              >
                <span className="line-clamp-2 min-w-0 flex-1 break-words text-sm">{nombreCorto(a.nombre)}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{plural(a.documentos, "doc.", "docs.")}</span>
                <span className="w-24 shrink-0 text-right text-sm tabular-nums">{formatImporte(a.importe)}</span>
              </FilaConMenu>
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

export function CasaTomasYTouza({
  locales,
  onVer,
}: {
  locales: TableroCompras["locales"];
  /** Sin `onVer` (cargando otro periodo) los dos bloques no se pueden tocar. */
  onVer?: (local: "casa_tomas" | "touza", gasto: number) => void;
}) {
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
    >
      {total <= 0 ? (
        <SinDatos>No hay gasto en este periodo.</SinDatos>
      ) : (
        <div className="space-y-2">
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted/60" aria-hidden>
            <span className={COLOR_CASA_TOMAS} style={{ width: `${pctCt}%` }} />
            <span className={COLOR_TOUZA} style={{ width: `${pctTz}%` }} />
          </div>
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {bloques.map((b) => (
              <li key={b.clave}>
                <button
                  type="button"
                  onClick={() => onVer?.(b.clave, b.gasto)}
                  disabled={!onVer}
                  className={cn("group flex min-h-11 w-full flex-col rounded-md px-1.5 py-1 text-left hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent", FOCO)}
                >
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span className={cn("h-2.5 w-2.5 rounded-sm", b.color)} aria-hidden /> {b.nombre}
                    <ChevronRight className="h-3 w-3 opacity-60" aria-hidden />
                  </span>
                  <span className="font-medium tabular-nums">{formatCurrency(b.gasto)}</span>
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
