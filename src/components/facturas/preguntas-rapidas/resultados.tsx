// Pintado de los resultados de las preguntas rápidas (sin IA).
// Cada componente recibe el JSON tal cual lo devuelve la RPC y lo enseña en
// tarjetas o tablas compactas. Los avisos de la RPC (cifra parcial, totales
// deducidos, fecha dudosa) salen en una línea discreta, sin interpretar.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Factura } from "@/hooks/useFacturas";
import { GraficoSeriePrecio } from "@/components/facturas/GraficoSeriePrecio";
import { EditarFacturaDialog } from "@/components/facturas/EditarFacturaDialog";
import { BotonOriginal } from "@/components/facturas/shared/BotonOriginal";
import {
  avisoFechaDudosa,
  avisosDeImportes,
  capitalizar,
  formatCantidad,
  formatEuros,
  formatFechaEs,
  formatMesEs,
  formatNumeroEs,
  formatPorcentaje,
  formatPrecioUnidad,
  plural,
  type Aviso,
  type DocumentoCompacto,
  type FiltroDocumentos,
  type FilaCantidadProducto,
  type FilaGastoProveedor,
  type GastoCategorias,
  type VariacionPrecios,
  type MesEstadistica,
  type Ranking,
  type ResumenPeriodo,
  type rangosGastoMes,
} from "@/lib/facturas/preguntasRapidas";

// ─── Avisos ──────────────────────────────────────────────────────────────────

const describirDoc = (d: { numero: string | null; proveedor: string | null; fecha?: string | null }) =>
  [d.proveedor, d.numero, d.fecha ? formatFechaEs(d.fecha) : null].filter(Boolean).join(" · ");

export function Avisos({ avisos }: { avisos: (Aviso | null | undefined)[] }) {
  const lista = avisos.filter((a): a is Aviso => !!a);
  if (lista.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" aria-label="Avisos de los datos">
      {lista.map((a) => (
        <li key={a.texto} className="text-xs text-amber-800 dark:text-amber-300">
          {a.docs && a.docs.length > 0 ? (
            <details className="group">
              <summary className="flex min-h-8 pointer-coarse:min-h-11 cursor-pointer list-none items-start gap-1.5 [&::-webkit-details-marker]:hidden">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>
                  {a.texto} <span className="underline decoration-dotted group-open:hidden">Ver cuáles</span>
                </span>
              </summary>
              <ul className="ml-5 mt-0.5 list-disc space-y-0.5 text-muted-foreground">
                {a.docs.map((d) => (
                  <li key={d.id}>{describirDoc(d) || `Documento ${d.id}`}</li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              <span>{a.texto}</span>
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Barra horizontal proporcional (solo decorativa: la cifra va escrita). */
function Barra({ valor, maximo }: { valor: number; maximo: number }) {
  const pct = maximo > 0 ? Math.max(0, Math.min(100, (valor / maximo) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-muted" aria-hidden>
      <div className="h-1.5 rounded-full bg-[hsl(38,59%,45%)]" style={{ width: `${pct}%` }} />
    </div>
  );
}

const ALBARANES = { uno: "albarán", varios: "albaranes" };

// ─── Gasto este mes ──────────────────────────────────────────────────────────

export interface DatosGastoMes {
  rangos: ReturnType<typeof rangosGastoMes>;
  actual: ResumenPeriodo;
  anterior: ResumenPeriodo;
}

function CifraMes({ titulo, nota, r }: { titulo: string; nota?: string; r: ResumenPeriodo }) {
  const f = r.facturas;
  const a = r.albaranes;
  return (
    <div className="rounded-lg border border-border/60 bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">
        {titulo}
        {nota && <span className="font-normal"> · {nota}</span>}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatEuros(f?.gasto ?? 0)}</p>
      <p className="text-xs text-muted-foreground">
        {plural(f?.n ?? 0, "factura", "facturas")} (IVA incluido)
        {a && a.n > 0 && (
          <>
            {" · "}
            {plural(a.n, "albarán", "albaranes")} por {formatEuros(a.valor)}
          </>
        )}
      </p>
      {r.sin_datos && <p className="mt-1 text-xs text-muted-foreground">Sin documentos cargados: 0 es «sin datos».</p>}
      <Avisos
        avisos={[
          ...avisosDeImportes(f?.si_das_importes),
          ...avisosDeImportes(a?.si_das_importes, ALBARANES),
          avisoFechaDudosa(r.con_alertas),
        ]}
      />
    </div>
  );
}

export function ResultadoGastoMes({ datos }: { datos: DatosGastoMes }) {
  const { rangos, actual, anterior } = datos;
  const nombreActual = capitalizar(formatMesEs(`${rangos.actual.anio}-${String(rangos.actual.mes).padStart(2, "0")}`));
  const nombreAnterior = capitalizar(
    formatMesEs(`${rangos.anterior.anio}-${String(rangos.anterior.mes).padStart(2, "0")}`),
  );
  const gA = actual.facturas?.gasto ?? 0;
  const gB = anterior.facturas?.gasto ?? 0;
  const diferencia = gA - gB;
  const proveedores = (actual.proveedores ?? []).filter((p) => p.gasto !== undefined).slice(0, 3);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <CifraMes titulo={nombreActual} nota={`en curso, hasta el día ${rangos.hoy.dia}`} r={actual} />
        <CifraMes titulo={nombreAnterior} nota="mes completo" r={anterior} />
      </div>
      <p className="text-sm text-foreground">
        Diferencia en facturas:{" "}
        <span className="font-semibold tabular-nums">
          {diferencia > 0 ? "+" : ""}
          {formatEuros(diferencia)}
        </span>
        {gB > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {" "}
            ({diferencia > 0 ? "+" : ""}
            {formatNumeroEs((diferencia / gB) * 100, 1)} %)
          </span>
        )}
        <span className="text-xs text-muted-foreground"> · el mes en curso aún no ha terminado</span>
      </p>
      {proveedores.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Más gasto en {nombreActual.toLowerCase()}:{" "}
          {proveedores.map((p) => `${p.proveedor} (${formatEuros(p.gasto)})`).join(" · ")}
        </p>
      )}
    </div>
  );
}

// ─── Gasto por mes ───────────────────────────────────────────────────────────

export interface DatosGastoPorMes {
  /** Los 12 meses a enseñar ("AAAA-MM"), del más antiguo al actual. */
  ventana: string[];
  meses: MesEstadistica[];
  sinDatos?: string;
}

export function ResultadoGastoPorMes({ datos }: { datos: DatosGastoPorMes }) {
  if (datos.sinDatos) return <p className="text-sm text-muted-foreground">{datos.sinDatos}</p>;
  const porMes = new Map(datos.meses.map((m) => [m.mes, m]));
  const filas = [...datos.ventana].reverse().map((clave) => ({ clave, m: porMes.get(clave) }));
  const maximo = Math.max(0, ...filas.map((f) => f.m?.gasto ?? 0));
  const total = filas.reduce((s, f) => s + (f.m?.gasto ?? 0), 0);
  const sinTotal = filas.reduce((s, f) => s + (f.m?.sin_total ?? 0), 0);
  const deducidos = filas.reduce((s, f) => s + (f.m?.deducidos ?? 0), 0);
  const fechaDudosa = filas.reduce((s, f) => s + (f.m?.fecha_dudosa ?? 0), 0);
  return (
    <div>
      <table className="w-full text-sm">
        <caption className="sr-only">Gasto en facturas por mes, últimos 12 meses</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="py-1 pr-2 font-medium">Mes</th>
            <th className="py-1 pr-2 text-right font-medium">Facturas</th>
            <th className="py-1 text-right font-medium">Gasto</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(({ clave, m }) => (
            <tr key={clave} className="border-t border-border/40 align-top">
              <td className="py-1.5 pr-2 whitespace-nowrap">{capitalizar(formatMesEs(clave, true))}</td>
              {m ? (
                <>
                  <td className="py-1.5 pr-2 text-right tabular-nums">
                    {formatNumeroEs(m.facturas, 0)}
                    {m.albaranes ? (
                      <span className="block text-xs text-muted-foreground">+{plural(m.albaranes, "albarán", "albaranes")}</span>
                    ) : null}
                  </td>
                  <td className="py-1.5 text-right">
                    <span className="tabular-nums font-medium">{formatEuros(m.gasto)}</span>
                    <Barra valor={m.gasto} maximo={maximo} />
                    {(m.sin_total || m.deducidos || m.fecha_dudosa) && (
                      <span className="block text-xs text-amber-800 dark:text-amber-300">
                        {[
                          m.sin_total ? `${m.sin_total} sin total` : null,
                          m.deducidos ? `${m.deducidos} deducido${m.deducidos === 1 ? "" : "s"}` : null,
                          m.fecha_dudosa ? `${m.fecha_dudosa} fecha dudosa` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                </>
              ) : (
                <td colSpan={2} className="py-1.5 text-right text-xs text-muted-foreground">
                  sin documentos cargados
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td className="py-1.5" colSpan={2}>
              Total 12 meses
            </td>
            <td className="py-1.5 text-right tabular-nums">{formatEuros(total)}</td>
          </tr>
        </tfoot>
      </table>
      <Avisos
        avisos={[
          sinTotal > 0 ? { texto: `Cifra parcial: ${plural(sinTotal, "factura", "facturas")} sin total (no suman).` } : null,
          deducidos > 0
            ? { texto: `${plural(deducidos, "factura", "facturas")} con el total calculado desde las líneas, no leído del documento.` }
            : null,
          fechaDudosa > 0
            ? { texto: `${plural(fechaDudosa, "documento", "documentos")} con fecha dudosa (puede estar en otro mes).` }
            : null,
          { texto: "Un mes «sin documentos cargados» no significa que no se gastara: no hay datos." },
        ]}
      />
    </div>
  );
}

// ─── Top proveedores ─────────────────────────────────────────────────────────

export interface DatosTopProveedores {
  anio: number;
  ranking: Ranking<FilaGastoProveedor>;
}

export function ResultadoTopProveedores({ datos }: { datos: DatosTopProveedores }) {
  const { ranking } = datos;
  if (ranking.filas.length === 0)
    return <p className="text-sm text-muted-foreground">No hay facturas cargadas de {datos.anio}.</p>;
  const maximo = Math.max(...ranking.filas.map((f) => f.importe));
  return (
    <div>
      <ol className="space-y-1.5">
        {ranking.filas.map((f, i) => (
          <li key={f.proveedor} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground tabular-nums">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate" title={f.proveedor}>
                {f.proveedor}
              </span>
              <span className="shrink-0 font-medium tabular-nums">{formatEuros(f.importe)}</span>
            </div>
            <div className="ml-7">
              <Barra valor={f.importe} maximo={maximo} />
              <p className="text-xs text-muted-foreground">
                {plural(f.documentos, "factura", "facturas")}
                {f.sin_total ? <span className="text-amber-800 dark:text-amber-300"> · {f.sin_total} sin total</span> : null}
                {f.deducidos ? (
                  <span className="text-amber-800 dark:text-amber-300">
                    {" "}
                    · {f.deducidos} con total deducido
                  </span>
                ) : null}
              </p>
            </div>
          </li>
        ))}
      </ol>
      {ranking.truncado && (
        <p className="mt-1 text-xs text-muted-foreground">
          Se enseñan {ranking.filas.length} de {ranking.total_filas} proveedores.
        </p>
      )}
      <Avisos
        avisos={avisosDeImportes({ sin_total: ranking.documentos_sin_total, deducidos: ranking.documentos_deducidos })}
      />
    </div>
  );
}

// ─── Productos más comprados ─────────────────────────────────────────────────

export interface DatosProductos {
  desde: string;
  hasta: string;
  ranking: Ranking<FilaCantidadProducto>;
}

/** Cuántos productos se enseñan por unidad (kg, ud, l…). */
export const PRODUCTOS_POR_UNIDAD = 5;

export function ResultadoProductos({ datos }: { datos: DatosProductos }) {
  const { ranking } = datos;
  if (ranking.filas.length === 0)
    return <p className="text-sm text-muted-foreground">No hay líneas de producto en ese periodo.</p>;
  // Kilos con kilos y unidades con unidades: no se comparan entre sí.
  const grupos = new Map<string, FilaCantidadProducto[]>();
  for (const f of ranking.filas) {
    const u = f.unidad || "sin unidad";
    if (!grupos.has(u)) grupos.set(u, []);
    grupos.get(u)!.push(f);
  }
  return (
    <div>
      <div className="grid gap-2 sm:grid-cols-2">
        {[...grupos.entries()].map(([unidad, filas]) => (
          <section key={unidad} className="rounded-lg border border-border/60 bg-background p-2.5">
            <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por {unidad}</h4>
            <ol className="space-y-1">
              {filas.slice(0, PRODUCTOS_POR_UNIDAD).map((f) => (
                <li key={`${f.producto}-${unidad}`} className="flex items-baseline gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate" title={f.producto}>
                    {f.producto}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {formatCantidad(f.cantidad)} {f.unidad ?? ""}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Del {formatFechaEs(datos.desde)} al {formatFechaEs(datos.hasta)}. Cantidad sumada de todas las compras.
      </p>
      <Avisos
        avisos={[
          ranking.servicios_excluidos && ranking.servicios_excluidos.n > 0
            ? {
                texto: `No cuenta ${plural(ranking.servicios_excluidos.n, "línea de servicio", "líneas de servicio")} (portes, mano de obra…).`,
              }
            : null,
        ]}
      />
    </div>
  );
}

// ─── Listas de documentos (por revisar / con avisos / sin total) ─────────────

export interface DatosDocumentos {
  filtro: "sin_verificar" | "con_alertas" | "sin_total";
  lista: FiltroDocumentos;
}

const VACIO: Record<DatosDocumentos["filtro"], string> = {
  sin_verificar: "No hay documentos por revisar.",
  con_alertas: "Ningún documento tiene avisos.",
  sin_total: "Todos los documentos tienen total.",
};

/**
 * Abre el documento en el mismo diálogo de edición que usa la pestaña
 * Documentos (ahí se corrige y se marca como verificado). El documento sale
 * de la caché de React Query que ya cargó la página de Facturas: no se pide
 * nada nuevo a la base de datos.
 */
function AccionesFila({ doc }: { doc: DocumentoCompacto }) {
  const qc = useQueryClient();
  const [abierto, setAbierto] = useState<Factura | null>(null);
  const clave = doc.tipo === "albaran" ? "albaranes" : "facturas";
  const completo = qc.getQueryData<Factura[]>([clave])?.find((d) => d.id === doc.id) ?? null;
  const etiqueta = `Abrir ${doc.tipo === "albaran" ? "el albarán" : "la factura"} ${doc.numero ?? doc.id}`;
  return (
    <div className="flex shrink-0 items-center gap-1">
      {completo && (
        <BotonOriginal driveUrl={completo.drive_url} archivoPath={completo.archivo_path} variant="desktop" />
      )}
      <button
        type="button"
        onClick={() => {
          if (completo) setAbierto(completo);
          else toast.info("Búscalo en la pestaña Documentos", { description: "Todavía no está cargado en esta pantalla." });
        }}
        className="inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-xs font-medium text-foreground hover:bg-muted"
        aria-label={etiqueta}
        title={etiqueta}
      >
        <FolderOpen className="h-4 w-4" aria-hidden />
        Abrir
      </button>
      <EditarFacturaDialog factura={abierto} open={!!abierto} onOpenChange={(o) => !o && setAbierto(null)} />
    </div>
  );
}

export function ResultadoDocumentos({ datos }: { datos: DatosDocumentos }) {
  const { lista, filtro } = datos;
  if (lista.total_filas === 0) return <p className="text-sm text-muted-foreground">{VACIO[filtro]}</p>;
  return (
    <div>
      <p className="mb-1 text-sm font-medium">{plural(lista.total_filas, "documento", "documentos")}</p>
      <ul className="divide-y divide-border/40">
        {lista.filas.map((d) => (
          <li key={d.id} className="flex items-start gap-2 py-1.5">
            <div className="min-w-0 flex-1 text-sm">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span
                  className={cn(
                    "rounded px-1.5 text-[11px] pointer-coarse:text-xs font-semibold uppercase",
                    d.tipo === "albaran" ? "bg-sky-500/10 text-sky-700 dark:text-sky-300" : "bg-muted text-muted-foreground",
                  )}
                >
                  {d.tipo === "albaran" ? "Albarán" : "Factura"}
                </span>
                <span className="font-medium">{d.numero ?? "sin número"}</span>
                <span className="truncate text-muted-foreground">{d.proveedor ?? "sin proveedor"}</span>
              </p>
              <p className="text-xs text-muted-foreground tabular-nums">
                {formatFechaEs(d.fecha)}
                {d.fecha_dudosa && <span className="text-amber-800 dark:text-amber-300"> (fecha dudosa)</span>}
                {" · "}
                {d.sin_total ? (
                  <span className="text-amber-800 dark:text-amber-300">sin total</span>
                ) : (
                  <>
                    {formatEuros(d.total)}
                    {d.total_origen === "deducido" && (
                      <span className="text-amber-800 dark:text-amber-300">
                        {" "}
                        (deducido{d.iva_conocido === false ? ", sin IVA" : ""})
                      </span>
                    )}
                  </>
                )}
              </p>
              {filtro === "con_alertas" && d.alertas && (
                <ul className="mt-0.5 space-y-0.5">
                  {d.alertas.map((a) => (
                    <li key={a.codigo} className="text-xs text-amber-800 dark:text-amber-300">
                      {a.mensaje}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <AccionesFila doc={d} />
          </li>
        ))}
      </ul>
      {lista.truncado && (
        <p className="mt-1 text-xs text-muted-foreground">
          Se enseñan {lista.filas.length} de {lista.total_filas}: el resto, en la pestaña Documentos.
        </p>
      )}
      {lista.nota && <Avisos avisos={[{ texto: "Sin total = no se leyó el importe. No quiere decir sin factura ni sin pagar." }]} />}
    </div>
  );
}

// ─── Gasto por categoría ─────────────────────────────────────────────────────

export interface DatosGastoCategorias {
  desde: string;
  hasta: string;
  datos: GastoCategorias;
}

export function ResultadoGastoCategorias({ datos: { desde, hasta, datos } }: { datos: DatosGastoCategorias }) {
  const periodo = `Del ${formatFechaEs(desde)} al ${formatFechaEs(hasta)}.`;
  if (datos.sin_datos || !datos.total)
    return <p className="text-sm text-muted-foreground">No hay líneas de producto con importe en ese periodo. {periodo}</p>;
  const total = datos.total.importe;
  const categorias = [...(datos.categorias ?? [])].sort((a, b) => b.importe - a.importe);
  const maximo = Math.max(0, ...categorias.map((c) => c.importe));
  return (
    <div>
      <p className="text-sm">
        Total: <span className="font-semibold tabular-nums">{formatEuros(total)}</span>{" "}
        <span className="text-xs text-muted-foreground">base sin IVA · {periodo}</span>
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {categorias.map((c) => {
          const conSub = !!c.sub && c.sub.length > 0;
          const fila = (
            <>
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate font-medium" title={c.categoria}>
                  {c.categoria}
                  {conSub && (
                    <span className="ml-1 text-xs font-normal text-muted-foreground group-open:hidden">
                      ({c.sub!.length} sub.)
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">
                  {formatEuros(c.importe)}
                  {c.pct !== undefined && (
                    <span className="ml-1 text-xs text-muted-foreground">{formatNumeroEs(c.pct, 1, 0)} %</span>
                  )}
                </span>
              </span>
              <Barra valor={c.importe} maximo={maximo} />
            </>
          );
          return (
            <li key={c.categoria} className="text-sm">
              {conSub ? (
                <details className="group">
                  <summary className="flex min-h-8 pointer-coarse:min-h-11 cursor-pointer list-none flex-col justify-center [&::-webkit-details-marker]:hidden">
                    {fila}
                  </summary>
                  <ul className="ml-3 mt-1 space-y-0.5 border-l border-border/60 pl-2">
                    {c.sub!.map((s) => (
                      <li key={s.categoria} className="flex items-baseline gap-2 text-xs text-muted-foreground">
                        <span className="min-w-0 flex-1 truncate">{s.categoria}</span>
                        <span className="shrink-0 tabular-nums">{formatEuros(s.importe)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : (
                <div className="flex min-h-8 flex-col justify-center">{fila}</div>
              )}
            </li>
          );
        })}
        {datos.sin_categoria && datos.sin_categoria.importe > 0 && (
          <li className="flex items-baseline gap-2 text-sm text-muted-foreground">
            <span className="flex-1">Productos sin categoría</span>
            <span className="tabular-nums">{formatEuros(datos.sin_categoria.importe)}</span>
          </li>
        )}
      </ul>
      <Avisos
        avisos={[
          datos.sin_clasificar && datos.sin_clasificar.lineas > 0
            ? {
                texto: `${plural(datos.sin_clasificar.lineas, "línea", "líneas")} aún sin clasificar (${formatEuros(datos.sin_clasificar.importe)}): no están en ninguna categoría.`,
              }
            : null,
          datos.avisos?.sin_importe
            ? { texto: `${plural(datos.avisos.sin_importe, "línea", "líneas")} sin importe: no suman.` }
            : null,
          datos.avisos?.albaranes_ya_facturados
            ? {
                texto: `${plural(datos.avisos.albaranes_ya_facturados, "línea de albarán ya facturada", "líneas de albarán ya facturadas")}: cuentan solo en su factura.`,
              }
            : null,
        ]}
      />
    </div>
  );
}

// ─── Qué ha subido de precio ─────────────────────────────────────────────────

export interface DatosSubidasPrecio {
  umbral: number;
  datos: VariacionPrecios;
}

export function ResultadoSubidasPrecio({ datos: { umbral, datos } }: { datos: DatosSubidasPrecio }) {
  const productos = datos.productos ?? [];
  const umbralTexto = `${formatNumeroEs(datos.umbral_pct ?? umbral, 1, 0)} %`;
  const sinReferencia = datos.avisos?.sin_referencia ?? 0;
  const avisos = [
    sinReferencia > 0
      ? { texto: `${plural(sinReferencia, "producto", "productos")} con una sola compra: no se pueden comparar.` }
      : null,
    datos.avisos?.sin_clasificar
      ? { texto: `${plural(datos.avisos.sin_clasificar, "línea", "líneas")} aún sin clasificar: no entran en la comparación.` }
      : null,
  ];
  if (productos.length === 0) {
    const comparados = datos.comparados ?? 0;
    return (
      <div>
        <p className="text-sm text-foreground">
          {comparados > 0
            ? `Nada ha subido más del ${umbralTexto} (${plural(comparados, "producto comparado", "productos comparados")}).`
            : "Todavía no hay compras repetidas de ningún producto con las que comparar precios."}
        </p>
        <Avisos avisos={avisos} />
      </div>
    );
  }
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">
        Subidas de más del {umbralTexto}: última compra frente a la referencia (compras anteriores). Precios sin IVA.
      </p>
      <ul className="divide-y divide-border/40">
        {productos.map((p) => (
          <li key={`${p.producto}-${p.unidad ?? ""}`} className="py-1.5 text-sm">
            <p className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium" title={p.producto}>
                {p.producto}
              </span>
              <span
                className={cn(
                  "shrink-0 font-semibold tabular-nums",
                  p.cambio_proveedor ? "text-muted-foreground" : "text-amber-800 dark:text-amber-300",
                )}
              >
                {formatPorcentaje(p.variacion_pct)}
              </span>
            </p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatPrecioUnidad(p.ref_precio, p.unidad)} → {formatPrecioUnidad(p.precio, p.unidad)}
              {p.proveedor && <> · {p.proveedor}</>}
              {p.fecha && <> · {formatFechaEs(p.fecha)}</>}
            </p>
            {(p.cambio_proveedor || p.pocas_compras || p.ref_antigua) && (
              <p className="text-xs text-amber-800 dark:text-amber-300">
                {[
                  p.cambio_proveedor
                    ? `cambio de proveedor${p.ref_proveedor ? ` (antes ${p.ref_proveedor})` : ""}, no es una subida real`
                    : null,
                  p.pocas_compras ? "referencia de una sola compra" : null,
                  p.ref_antigua ? "referencia antigua (más de 90 días)" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
      {datos.truncado && datos.total_productos !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">
          Se enseñan {productos.length} de {datos.total_productos}.
        </p>
      )}
      <Avisos avisos={avisos} />
    </div>
  );
}

// ─── Evolución de precio de un producto ──────────────────────────────────────

/** JSON de `serie_precios_agente` tal cual (la serie o `{sin_datos, buscado}`). */
export type DatosEvolucionPrecio = unknown;

export function ResultadoEvolucionPrecio({ datos }: { datos: DatosEvolucionPrecio }) {
  return <GraficoSeriePrecio datos={datos} />;
}
