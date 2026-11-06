// Módulos del catálogo de «Personalizar» que no salen por defecto
// (06/11/2026): «Gasto por mes», «Productos más comprados», «Albaranes por
// revisar», «Regalado por proveedor» y «Evolución de un producto». Leen las RPC de siempre: el tablero
// (meses), `explorar_compras` (rankings) y `documentos_de_cifra`
// (albaranes). Solo piden datos si están en el tablero (si no, no se montan).
import { useId, useMemo, useState } from "react";
import { BarChart3, FileText, LineChart, Search, ShoppingCart } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { useDocumentosDeCifra, useExplorarCompras } from "@/hooks/useExplorarCompras";
import { useBuscarProductosComprados } from "@/hooks/useTableroCompras";
import { enlaceProveedorCompras, fechaCorta, nombreCorto, resumenGastoMes, textoPct, type MesGasto } from "@/lib/facturas/tableroCompras";
import { mesCorto } from "@/lib/facturas/resumenCompras";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import { FILTROS_VACIOS, parametrosExplorar, rangoDeClave, resumenExploracion, type Agrupar, type ConfigExplorador, type LocalRpc, type Medida } from "@/lib/facturas/explorador";
import { enlaceDocumentoCompras, peticionSimple, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import type { Tamano } from "@/lib/facturas/widgetsTablero";
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
import { GraficaExplorador } from "./GraficaExplorador";

const ICONO = "h-4 w-4 text-muted-foreground";

interface Comunes {
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  tamano?: Tamano;
  onAmpliar?: () => void;
  onDocumentos: (p: PeticionDocumentos) => void;
  onIrA: (enlace: string) => void;
  onExplorar: (c: Partial<ConfigExplorador>) => void;
  /** Cargando otro periodo: las filas no se pueden tocar. */
  pendiente?: boolean;
}

const Cargando = ({ filas = 5 }: { filas?: number }) => (
  <div className="space-y-1.5" role="status" aria-label="Cargando">
    {Array.from({ length: filas }, (_, i) => (
      <div key={i} className="h-9 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" />
    ))}
  </div>
);

const Fallo = ({ error }: { error: unknown }) => (
  <p className="py-3 text-sm text-destructive" role="alert">
    No se ha podido calcular. {(error as Error)?.message}
  </p>
);

// ─── Gasto por mes (barras apiladas en HTML) ────────────────────────────────

export function GastoPorMesModulo({
  meses,
  periodo,
  local,
  tamano = "m",
  onAmpliar,
  onDocumentos,
  pendiente,
}: Pick<Comunes, "periodo" | "local" | "tamano" | "onAmpliar" | "onDocumentos" | "pendiente"> & { meses: MesGasto[] }) {
  const con = meses.filter((m) => m.documentos > 0 || m.total !== 0);
  const max = Math.max(1, ...con.map((m) => Math.max(0, m.casa_tomas) + Math.max(0, m.touza)));
  const variosAnios = new Set(con.map((m) => m.mes.slice(0, 4))).size > 1;
  const conTouza = !local && con.some((m) => m.touza > 0);
  return (
    <Tarjeta
      titulo="Gasto por mes"
      subtitulo={`Con IVA${conTouza ? " · Casa Tomás y Touza" : ""}`}
      resumen={resumenGastoMes(meses)}
      testId="tarjeta-gasto-mes"
      onAmpliar={onAmpliar}
    >
      {con.length === 0 ? (
        <SinDatos>No hay gasto en este periodo.</SinDatos>
      ) : (
        <>
          {conTouza && (
            <p className="mb-2 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_CASA_TOMAS)} /> Casa Tomás
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-2.5 w-2.5 rounded-sm", COLOR_TOUZA)} /> Touza
              </span>
            </p>
          )}
          <ol className={cn("flex items-stretch gap-1 @[28rem]:gap-1.5", tamano === "s" ? "h-36" : "h-44")} aria-label="Gasto de cada mes">
            {con.map((m) => {
              const ct = Math.max(0, m.casa_tomas);
              const tz = conTouza ? Math.max(0, m.touza) : 0;
              const nombre = etiquetaMes(m.mes);
              return (
                <li key={m.mes} className="flex min-w-0 flex-1 flex-col">
                  <button
                    type="button"
                    disabled={pendiente}
                    onClick={() => {
                      const r = rangoDeClave("mes", m.mes, periodo);
                      if (r) onDocumentos(peticionSimple({ titulo: `Gasto con IVA · ${nombre}`, desde: r.desde, hasta: r.hasta, medida: "gasto", local, cifra: m.total }));
                    }}
                    title={`${nombre}: ${formatCurrency(m.total)}${m.incompleto ? " (incompleto)" : ""}`}
                    aria-label={`${nombre}: ${formatCurrency(m.total)} con IVA${conTouza ? `; Touza ${formatCurrency(m.touza)}` : ""}${m.incompleto ? ", mes incompleto" : ""}. Ver documentos`}
                    className={cn("group flex min-h-0 flex-1 flex-col justify-end rounded-sm hover:bg-muted/40 disabled:cursor-default", FOCO)}
                  >
                    <span className={cn("flex w-full flex-col justify-end overflow-hidden rounded-t-[3px]", m.incompleto && "opacity-60")} style={{ height: `${((ct + tz) / max) * 100}%` }}>
                      {tz > 0 && <span className={cn("block w-full", COLOR_TOUZA)} style={{ height: `${(tz / (ct + tz)) * 100}%` }} />}
                      <span className={cn("block w-full flex-1", COLOR_CASA_TOMAS, m.incompleto && "bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgb(255_255_255/0.45)_3px_5px)]")} />
                    </span>
                  </button>
                  <span className="mt-1 truncate text-center text-xs leading-none text-muted-foreground" aria-hidden>
                    {mesCorto(m.mes, variosAnios)}
                  </span>
                </li>
              );
            })}
          </ol>
          {con.some((m) => m.incompleto) && <p className="mt-2 text-xs text-amber-800 dark:text-amber-400">Las barras claras son meses incompletos: faltan facturas por subir.</p>}
        </>
      )}
    </Tarjeta>
  );
}

// ─── Rankings con `explorar_compras` ────────────────────────────────────────

function RankingExplorar({
  titulo,
  subtitulo,
  testId,
  medida,
  agrupar,
  periodo,
  local,
  tamano = "s",
  onAmpliar,
  acciones,
  vacio,
  pendiente,
}: Pick<Comunes, "periodo" | "local" | "tamano" | "onAmpliar" | "pendiente"> & {
  titulo: string;
  subtitulo: string;
  testId: string;
  medida: Medida;
  agrupar: Agrupar;
  acciones: (p: { clave: string; etiqueta: string; id: number | null; valor: number | null }) => AccionMenu[];
  vacio: string;
}) {
  const [todos, setTodos] = useState(false);
  const idLista = useId();
  const limite = FILAS_TAMANO[tamano];
  const params = useMemo(
    () => parametrosExplorar({ medida, agrupar, desglose: null, filtros: FILTROS_VACIOS, grafica: "auto", top: 10 }, periodo, local),
    [medida, agrupar, periodo, local],
  );
  const q = useExplorarCompras(params, { retraso: 0 });
  const ex = q.data;
  const puntos = (ex?.puntos ?? []).filter((p) => p.valor !== null && p.valor !== 0 && p.clave !== "__otros__");
  const visibles = todos ? puntos : puntos.slice(0, limite);
  const max = Math.max(1, ...puntos.map((p) => Math.abs(p.valor ?? 0)));
  const total = ex?.total.valor ?? null;
  const signo = (n: number) => (medida === "abonos" ? -Math.abs(n) : n);
  const nombre = (p: { etiqueta: string }) => (agrupar === "proveedor" ? nombreCorto(p.etiqueta) : p.etiqueta.charAt(0).toUpperCase() + p.etiqueta.slice(1).toLowerCase());
  const resumen = puntos.length ? `Los que más: ${puntos.slice(0, 3).map((p) => `${nombre(p)} ${formatImporte(signo(p.valor ?? 0))}`).join(", ")}.` : vacio;
  return (
    <Tarjeta titulo={titulo} subtitulo={subtitulo} resumen={resumen} testId={testId} onAmpliar={onAmpliar}>
      {q.isLoading ? (
        <Cargando filas={Math.min(limite, 5)} />
      ) : q.isError && !ex ? (
        <Fallo error={q.error} />
      ) : puntos.length === 0 ? (
        <SinDatos>{vacio}</SinDatos>
      ) : (
        <>
          <ol className="space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0" id={idLista} aria-label={titulo}>
            {visibles.map((p) => (
              <li key={p.clave}>
                <FilaConMenu
                  className={FILA_BARRA}
                  title={p.etiqueta}
                  acciones={pendiente || !q.alDia ? [] : acciones(p)}
                  nombre={`${nombre(p)}: ${formatImporte(signo(p.valor ?? 0))}. Opciones`}
                >
                  <ContenidoFilaBarra
                    nombre={nombre(p)}
                    valor={formatImporte(signo(p.valor ?? 0))}
                    pct={total ? textoPct((Math.abs(p.valor ?? 0) / Math.abs(total)) * 100, false) : null}
                    fraccion={Math.abs(p.valor ?? 0) / max}
                  />
                </FilaConMenu>
              </li>
            ))}
          </ol>
          <BotonVerMas total={puntos.length} visibles={limite} abierto={todos} onCambio={setTodos} controla={idLista} />
        </>
      )}
    </Tarjeta>
  );
}

export function ProductosMasComprados(p: Comunes) {
  const { periodo, local, onDocumentos, onExplorar } = p;
  return (
    <RankingExplorar
      {...p}
      titulo="Productos más comprados"
      subtitulo="Base sin IVA de las líneas · % del total"
      testId="tarjeta-productos"
      medida="base"
      agrupar="producto"
      vacio="No hay líneas de producto en este periodo."
      acciones={(x) => [
        {
          etiqueta: "Ver documentos",
          icono: <FileText className={ICONO} aria-hidden />,
          onClick: () =>
            onDocumentos(peticionSimple({ titulo: x.etiqueta, desde: periodo.desde, hasta: periodo.hasta, medida: "base", agrupar: "producto", clave: x.clave, local, cifra: x.valor, detalle: "Base sin IVA de sus líneas" })),
        },
        {
          etiqueta: "Ver su precio en el explorador",
          icono: <LineChart className={ICONO} aria-hidden />,
          onClick: () => onExplorar({ medida: "precio", agrupar: "mes", desglose: "proveedor", grafica: "auto", filtros: { ...FILTROS_VACIOS, productos: [x.clave] } }),
        },
      ]}
    />
  );
}

export function RegaladoPorProveedor(p: Comunes) {
  const { periodo, local, onDocumentos, onIrA, onExplorar } = p;
  return (
    <RankingExplorar
      {...p}
      titulo="Regalado por proveedor"
      subtitulo="Lo que valía menos lo que se pagó · sin IVA"
      testId="tarjeta-regalado"
      medida="regalado"
      agrupar="proveedor"
      vacio="Ningún proveedor ha regalado ni descontado nada en este periodo."
      acciones={(x) =>
        x.id === null
          ? []
          : [
              {
                etiqueta: "Ver documentos",
                icono: <FileText className={ICONO} aria-hidden />,
                onClick: () =>
                  onDocumentos(
                    peticionSimple({ titulo: `Regalado · ${nombreCorto(x.etiqueta)}`, desde: periodo.desde, hasta: periodo.hasta, medida: "regalado", agrupar: "proveedor", clave: String(x.id), local, cifra: x.valor, detalle: "Lo que valía menos lo que se pagó" }),
                  ),
              },
              { etiqueta: "Abrir en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => onIrA(enlaceProveedorCompras(x.id as number)) },
              {
                etiqueta: "Ver por mes en el explorador",
                icono: <BarChart3 className={ICONO} aria-hidden />,
                onClick: () => onExplorar({ medida: "regalado", agrupar: "mes", desglose: null, filtros: { ...FILTROS_VACIOS, proveedores: [{ id: x.id as number, nombre: nombreCorto(x.etiqueta) }] } }),
              },
            ]
      }
    />
  );
}

// ─── Albaranes por revisar (documentos_de_cifra) ────────────────────────────

export function AlbaranesPorRevisar({ periodo, local, tamano = "s", onAmpliar, onDocumentos, onIrA, pendiente }: Comunes) {
  const [todos, setTodos] = useState(false);
  const idLista = useId();
  const limite = FILAS_TAMANO[tamano];
  const peticion = useMemo(
    () =>
      peticionSimple({
        titulo: "Albaranes sin factura",
        detalle: "Gasto con IVA de los albaranes que aún no están en una factura",
        desde: periodo.desde,
        hasta: periodo.hasta,
        medida: "gasto",
        filtros: { tipos: ["albaran"] },
        local,
      }),
    [periodo.desde, periodo.hasta, local],
  );
  const q = useDocumentosDeCifra(peticion);
  const primera = q.data?.pages[0];
  const docs = primera?.filas ?? [];
  const visibles = todos ? docs.slice(0, 20) : docs.slice(0, limite);
  return (
    <Tarjeta
      titulo="Albaranes por revisar"
      subtitulo={primera ? `${plural(primera.documentos, "albarán", "albaranes")} sin factura · ${formatCurrency(primera.cifra ?? primera.importeTotal)} con IVA` : "Sin factura todavía · con IVA"}
      resumen={primera ? `${plural(primera.documentos, "albarán sin factura", "albaranes sin factura")}.` : undefined}
      testId="tarjeta-por-revisar"
      onAmpliar={onAmpliar}
    >
      {q.isLoading ? (
        <Cargando filas={Math.min(limite, 5)} />
      ) : q.isError && !primera ? (
        <Fallo error={q.error} />
      ) : docs.length === 0 ? (
        <SinDatos>Todos los albaranes del periodo tienen su factura.</SinDatos>
      ) : (
        <>
          <ul className="space-y-0.5 @[52rem]:grid @[52rem]:grid-cols-2 @[52rem]:gap-x-6 @[52rem]:space-y-0" id={idLista} aria-label="Últimos albaranes sin factura">
            {visibles.map((d) => (
              <li key={d.id}>
                <FilaConMenu
                  className={FILA_DOBLE}
                  title={d.proveedor}
                  nombre={`Albarán ${d.numero ?? "sin número"} de ${d.proveedor}, ${d.fecha ? fechaCorta(d.fecha) : "sin fecha"}: ${formatImporte(d.aporta)}. Opciones`}
                  acciones={
                    pendiente
                      ? []
                      : [
                          { etiqueta: "Abrir el albarán en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => onIrA(enlaceDocumentoCompras(d.id)) },
                          { etiqueta: "Ver los albaranes sin factura", icono: <FileText className={ICONO} aria-hidden />, onClick: () => onDocumentos(peticion) },
                        ]
                  }
                >
                  <ContenidoFilaDoble
                    nombre={nombreCorto(d.proveedor)}
                    detalle={`${d.fecha ? fechaCorta(d.fecha) : "Sin fecha"} · nº ${d.numero ?? "—"}${d.local === "touza" ? " · Touza" : ""}`}
                    valor={formatImporte(d.aporta)}
                  />
                </FilaConMenu>
              </li>
            ))}
          </ul>
          <BotonVerMas total={Math.min(docs.length, 20)} visibles={limite} abierto={todos} onCambio={setTodos} controla={idLista} />
        </>
      )}
    </Tarjeta>
  );
}

// ─── Evolución de un producto ───────────────────────────────────────────────

/**
 * El precio medio (sin IVA) de UN producto mes a mes, una línea por
 * proveedor. El producto se elige aquí mismo (buscador) y se guarda con el
 * tablero; «Cambiar» vuelve a elegirlo.
 */
export function EvolucionProducto({
  producto,
  onElegir,
  periodo,
  local,
  tamano = "m",
  onAmpliar,
}: Pick<Comunes, "periodo" | "local" | "tamano" | "onAmpliar"> & { producto?: string; onElegir: (p: string | null) => void }) {
  const [texto, setTexto] = useState("");
  const busqueda = useBuscarProductosComprados(producto ? "" : texto);
  const params = useMemo(
    () =>
      parametrosExplorar(
        { medida: "precio", agrupar: "mes", desglose: "proveedor", filtros: { ...FILTROS_VACIOS, productos: producto ? [producto] : [] }, grafica: "auto", top: 5 },
        periodo,
        local,
      ),
    [producto, periodo, local],
  );
  const q = useExplorarCompras(params, { retraso: 0, activo: !!producto });
  const ex = q.data;
  const bonito = producto ? producto.charAt(0).toUpperCase() + producto.slice(1).toLowerCase() : "";
  const idBusca = useId();
  return (
    <Tarjeta
      titulo={producto ? `Precio de ${bonito}` : "Evolución de un producto"}
      subtitulo={producto ? `Precio medio sin IVA${ex?.parametros.unidad ? ` por ${ex.parametros.unidad}` : ""} · por proveedor` : "Elige un producto para seguir su precio"}
      resumen={ex && producto ? resumenExploracion(ex) : undefined}
      testId="tarjeta-precio-producto"
      onAmpliar={producto ? onAmpliar : undefined}
      accion={
        producto ? (
          <button
            type="button"
            onClick={() => onElegir(null)}
            className={cn("-mt-1.5 inline-flex min-h-9 items-center rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:min-h-11", FOCO)}
            aria-label={`Cambiar el producto (ahora, ${bonito})`}
          >
            Cambiar
          </button>
        ) : undefined
      }
    >
      {!producto ? (
        <div className="space-y-2">
          <label htmlFor={idBusca} className="text-xs font-medium text-muted-foreground">
            Producto
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input id={idBusca} type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Merluza, aceite, pan…" className="h-11 pl-9" />
          </div>
          {texto.trim().length >= 2 && (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto" aria-label="Productos encontrados">
              {busqueda.isLoading && <li className="px-1.5 py-2 text-sm text-muted-foreground">Buscando…</li>}
              {busqueda.data?.length === 0 && <li className="px-1.5 py-2 text-sm text-muted-foreground">Ningún producto con ese nombre.</li>}
              {(busqueda.data ?? []).map((p) => (
                <li key={p}>
                  <button type="button" onClick={() => onElegir(p)} className={cn("flex min-h-11 w-full items-center rounded-md px-1.5 text-left text-sm hover:bg-muted/50", FOCO)}>
                    <span className="truncate">{p}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : q.isLoading ? (
        <div className={cn("animate-pulse rounded-lg bg-muted/50 motion-reduce:animate-none", tamano === "s" ? "h-40" : "h-52")} role="status" aria-label="Calculando" />
      ) : q.isError && !ex ? (
        <Fallo error={q.error} />
      ) : !ex || ex.sinDatos ? (
        <SinDatos>No se ha comprado {bonito.toLowerCase()} en este periodo.</SinDatos>
      ) : (
        <GraficaExplorador exploracion={ex} tipo="lineas" alto={tamano === "s" ? 170 : 210} compacta descripcion={`Precio de ${bonito}. ${resumenExploracion(ex)}`} />
      )}
    </Tarjeta>
  );
}
