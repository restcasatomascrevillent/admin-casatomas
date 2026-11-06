// Detalle EN GRANDE de un módulo del tablero (06/11/2026): al ampliar una
// tarjeta se abre un diálogo casi a pantalla completa (hoja completa en el
// móvil) con toda su información y todos los filtros:
//
//   · Filtros: periodo (el mismo selector de la barra), local, con/sin IVA,
//     eje de tiempo, buscador, proveedor, familia y rango de importe. Empiezan
//     con el periodo y el local del tablero; cambiarlos aquí NO cambia el
//     tablero.
//   · Gráfica (ranking de barras o por meses) y TABLA ORDENABLE (cabeceras
//     con `aria-sort`); cada fila abre su menú (ver documentos, Compras,
//     explorador).
//   · Pie: cuántas filas y cuánto suman, «Exportar CSV», «Ver documentos» y
//     «Abrir en el explorador».
//
// Sin IA: lee las RPC de siempre (explorar_compras hasta 50 filas,
// tablero_compras, documentos_de_cifra). Ver lib/facturas/detalleModulo.ts.
import { useMemo, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpDown, BarChart3, Check, ChevronDown, FileText, LineChart, Loader2, Search, ShoppingCart, SlidersHorizontal, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { formatCurrency, formatEntero, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { consultaTablero } from "@/hooks/useTableroCompras";
import { useDocumentosDeCifra, useExplorarCompras, useFamiliasFiltro, useProveedoresFiltro } from "@/hooks/useExplorarCompras";
import { FILTROS_LOCAL, type FiltroLocal } from "@/lib/facturas/resumenCompras";
import { enlaceMesCompras, enlaceProveedorCompras, fechaCorta, localRpc, nombreCorto, textoPct, type GastoFijo, type Subida } from "@/lib/facturas/tableroCompras";
import { fechasSeleccion, seleccionDeRango, textoRango, type SeleccionPeriodo } from "@/lib/facturas/periodoAnalisis";
import {
  FILTROS_VACIOS,
  parametrosExplorar,
  rangoDeClave,
  resumenExploracion,
  type Agrupar,
  type ConfigExplorador,
  type EntidadFiltro,
  type LocalRpc,
} from "@/lib/facturas/explorador";
import { enlaceDocumentoCompras, peticionSimple, type DocumentoCifra, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import {
  consultaExplorar,
  csvDetalle,
  filasDeAlbaranes,
  filasDeExploracion,
  filasDeFijos,
  filasDeSubidas,
  filtrarFilas,
  leerImporte,
  nombreCsv,
  ordenarFilas,
  SPECS,
  sumaValor,
  type ColumnaDetalle,
  type Direccion,
  type FilaDetalle,
  type IdDetalle,
  type Iva,
} from "@/lib/facturas/detalleModulo";
import { EstadoError, EstadoVacio } from "@/components/facturas/compras/estilo";
import { GraficaExplorador } from "./GraficaExplorador";
import { SelectorPeriodo } from "./SelectorPeriodo";
import { COLOR_CASA_TOMAS, DIALOGO_GRANDE, FilaConMenu, FOCO, Segmentado, useEscapeCierra, type AccionMenu } from "./piezas";
import { useFocoAlCerrar } from "./desplazar";

interface Props {
  modulo: IdDetalle | null;
  /** «Evolución de un producto»: el producto. */
  producto?: string | null;
  onCerrar: () => void;
  /** Periodo y local del tablero: de ahí arrancan los filtros. */
  periodo: { desde: string | null; hasta: string | null };
  local: LocalRpc;
  onDocumentos: (p: PeticionDocumentos) => void;
  onIrA: (enlace: string) => void;
  onExplorar: (c: Partial<ConfigExplorador>) => void;
}

export function DetalleModulo({ modulo, onCerrar, ...resto }: Props) {
  // Se abre por código (desde la cabecera de la tarjeta): al cerrar, el foco vuelve a ella.
  const focoAlCerrar = useFocoAlCerrar(!!modulo);
  return (
    <Dialog open={!!modulo} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent
        data-testid="detalle-modulo"
        onCloseAutoFocus={focoAlCerrar}
        className={cn(DIALOGO_GRANDE, "sm:h-[min(92dvh,62rem)] sm:w-[min(96vw,86rem)]")}
      >
        {modulo && <Contenido key={modulo} modulo={modulo} onCerrar={onCerrar} {...resto} />}
      </DialogContent>
    </Dialog>
  );
}

// ─── Contenido ──────────────────────────────────────────────────────────────

const EJES_TIEMPO: { valor: Agrupar; etiqueta: string }[] = [
  { valor: "mes", etiqueta: "Mes" },
  { valor: "trimestre", etiqueta: "Trimestre" },
  { valor: "semana", etiqueta: "Semana" },
];
const OPCIONES_IVA: { valor: Iva; etiqueta: string }[] = [
  { valor: "con", etiqueta: "Con IVA" },
  { valor: "sin", etiqueta: "Sin IVA" },
];
const ETIQUETA_LOCAL: Record<FiltroLocal, string> = { todos: "los dos locales", casa_tomas: "Casa Tomás", touza: "Touza" };
const ICONO = "h-4 w-4 text-muted-foreground";

function Contenido({ modulo, producto, onCerrar, periodo, local, onDocumentos, onIrA, onExplorar }: Props & { modulo: IdDetalle }) {
  const base0 = SPECS[modulo];
  const productos = modulo === "precio_producto" && producto ? [producto] : [];
  const spec = productos.length ? { ...base0, titulo: `Precio de ${producto!.charAt(0).toUpperCase()}${producto!.slice(1).toLowerCase()}` } : base0;
  const hoy = useMemo(() => new Date(), []);
  const [seleccion, setSeleccion] = useState<SeleccionPeriodo>(() =>
    periodo.desde && periodo.hasta ? seleccionDeRango(periodo.desde, periodo.hasta, hoy) : { tipo: "todo" },
  );
  const [localF, setLocalF] = useState<FiltroLocal>(local ?? "todos");
  const [texto, setTexto] = useState("");
  const [proveedores, setProveedores] = useState<EntidadFiltro[]>([]);
  const [familias, setFamilias] = useState<EntidadFiltro[]>([]);
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [iva, setIva] = useState<Iva>("con");
  const [agrupar, setAgrupar] = useState<Agrupar>("mes");
  const [orden, setOrden] = useState<{ col: string; dir: Direccion } | null>(null);
  const [elegida, setElegida] = useState<string | null>(null);
  const [verFiltros, setVerFiltros] = useState(false);
  /** En estrecho se ve una cosa: la gráfica (como lista con barras) o la tabla. */
  const [vista, setVista] = useState<"grafica" | "tabla">("grafica");

  const fechas = useMemo(() => fechasSeleccion(seleccion, hoy), [seleccion, hoy]);
  const lrpc: LocalRpc = spec.local ? localRpc(localF) : null;

  // ── Datos ──
  const consulta = consultaExplorar(modulo, { iva, agrupar, local: lrpc, familias: familias.length });
  const params = useMemo(
    () =>
      parametrosExplorar(
        {
          medida: consulta?.medida ?? "gasto",
          agrupar: consulta?.agrupar ?? "proveedor",
          desglose: consulta?.desglose ?? null,
          filtros: { ...FILTROS_VACIOS, proveedores: spec.fuente === "explorar" ? proveedores : [], familias: spec.familia ? familias : [], productos },
          grafica: "auto",
          top: consulta?.top ?? 50,
        },
        fechas,
        lrpc,
      ),
    // `productos` sale de `producto` (un texto): con él basta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [consulta?.medida, consulta?.agrupar, consulta?.desglose, consulta?.top, spec.fuente, spec.familia, proveedores, familias, fechas, lrpc, producto],
  );
  const ex = useExplorarCompras(params, { activo: spec.fuente === "explorar" });
  const tab = useQuery({ ...consultaTablero(fechas.desde, fechas.hasta, lrpc), enabled: spec.fuente === "tablero", placeholderData: keepPreviousData });
  const peticionAlbaranes = useMemo(
    () =>
      spec.fuente === "documentos"
        ? peticionSimple({
            titulo: "Albaranes sin factura",
            detalle: "Gasto con IVA de los albaranes que aún no están en una factura",
            desde: fechas.desde,
            hasta: fechas.hasta,
            medida: "gasto",
            filtros: { tipos: ["albaran"], ...(proveedores.length ? { proveedores: proveedores.map((p) => p.id) } : {}) },
            local: lrpc,
          })
        : null,
    [spec.fuente, fechas, proveedores, lrpc],
  );
  const docs = useDocumentosDeCifra(peticionAlbaranes);

  const etiquetaValor = modulo === "abonos" ? "Abonado" : modulo === "regalado" ? "Regalado" : consulta?.medida === "gasto" ? "Gasto con IVA" : "Base sin IVA";
  const base = useMemo(() => {
    if (spec.fuente === "explorar") return ex.data ? filasDeExploracion(ex.data, etiquetaValor) : null;
    if (spec.fuente === "tablero") {
      if (!tab.data) return null;
      return modulo === "subidas" ? filasDeSubidas(tab.data.subidas.productos) : filasDeFijos(tab.data.fijos.proveedores);
    }
    const lista = (docs.data?.pages ?? []).flatMap((p) => p.filas);
    return docs.data ? filasDeAlbaranes(lista) : null;
  }, [spec.fuente, ex.data, tab.data, docs.data, modulo, etiquetaValor]);
  const cargando = spec.fuente === "explorar" ? ex.isLoading : spec.fuente === "tablero" ? tab.isLoading : docs.isLoading;
  const actualizando = spec.fuente === "explorar" ? ex.isFetching || !ex.alDia : spec.fuente === "tablero" ? tab.isFetching : docs.isFetching;
  const error = spec.fuente === "explorar" ? ex.error : spec.fuente === "tablero" ? tab.error : docs.error;
  const reintentar = () => void (spec.fuente === "explorar" ? ex.refetch() : spec.fuente === "tablero" ? tab.refetch() : docs.refetch());

  const minN = leerImporte(min);
  const maxN = leerImporte(max);
  const filtradas = useMemo(() => {
    if (!base) return [];
    const f = filtrarFilas(base.filas, {
      texto: spec.tiempo ? "" : texto,
      min: minN,
      max: maxN,
      proveedores: spec.fuente === "tablero" ? proveedores.map((p) => p.id) : undefined,
    });
    return orden ? ordenarFilas(f, orden.col, orden.dir) : f;
  }, [base, texto, minN, maxN, proveedores, spec.fuente, spec.tiempo, orden]);

  const columnas = base?.columnas ?? [];
  const total = sumaValor(filtradas);
  const resto = spec.fuente === "explorar" && ex.data?.resto && ex.data.resto.entidades > 0 ? ex.data.resto : null;
  const tipoValor = columnas.find((c) => c.id === "valor")?.tipo ?? "eur";
  const textoPeriodo = fechas.desde && fechas.hasta ? textoRango(fechas.desde, fechas.hasta) : "Todo el histórico";
  const nFiltros = (spec.tiempo ? 0 : texto.trim() ? 1 : 0) + proveedores.length + familias.length + (minN !== null ? 1 : 0) + (maxN !== null ? 1 : 0);
  const avisoIva = spec.iva && iva === "con" && familias.length > 0;

  // ── Acciones ──
  const salir = (f: () => void) => {
    onCerrar();
    f();
  };
  const verDocs = (p: Parameters<typeof peticionSimple>[0]): AccionMenu => ({
    etiqueta: "Ver documentos",
    icono: <FileText className={ICONO} aria-hidden />,
    onClick: () => onDocumentos(peticionSimple(p)),
  });
  const filtrosComunes = () => ({
    ...(proveedores.length && spec.fuente !== "tablero" ? { proveedores: proveedores.map((p) => p.id) } : {}),
    ...(familias.length && spec.familia ? { familias: familias.map((p) => p.id) } : {}),
    ...(productos.length ? { productos } : {}),
  });
  const enCompras = (id: number | null): AccionMenu[] =>
    id === null ? [] : [{ etiqueta: "Abrir en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => salir(() => onIrA(enlaceProveedorCompras(id))) }];

  const accionesFila = (f: FilaDetalle): AccionMenu[] => {
    if (actualizando && spec.fuente === "explorar") return [];
    const comun = { desde: fechas.desde, hasta: fechas.hasta, local: lrpc };
    const medida = consulta?.medida ?? "gasto";
    switch (modulo) {
      case "proveedores":
      case "abonos":
      case "regalado":
        return f.id === null
          ? []
          : [
              verDocs({ ...comun, titulo: modulo === "abonos" ? `Abonos de ${f.nombre}` : f.nombre, medida, agrupar: "proveedor", clave: String(f.id), cifra: f.valor === null ? null : Math.abs(f.valor) * (modulo === "abonos" ? -1 : 1), filtros: filtrosComunes() }),
              ...enCompras(f.id),
              {
                etiqueta: "Ver su gasto por mes",
                icono: <BarChart3 className={ICONO} aria-hidden />,
                onClick: () => salir(() => onExplorar({ medida: modulo === "proveedores" ? medida : modulo, agrupar: "mes", desglose: null, filtros: { ...FILTROS_VACIOS, proveedores: [{ id: f.id as number, nombre: f.nombre }] } })),
              },
            ];
      case "familias": {
        const id = f.id ?? (f.clave === "0" ? 0 : null);
        return id === null
          ? []
          : [
              verDocs({ ...comun, titulo: f.nombre, medida: "base", agrupar: "familia", clave: String(id), cifra: f.valor, detalle: "Base sin IVA de sus líneas", filtros: filtrosComunes() }),
              {
                etiqueta: "Ver por mes en el explorador",
                icono: <BarChart3 className={ICONO} aria-hidden />,
                onClick: () => salir(() => onExplorar({ medida: "base", agrupar: "mes", desglose: null, filtros: { ...FILTROS_VACIOS, familias: [{ id, nombre: f.nombre }] } })),
              },
            ];
      }
      case "productos":
        return [
          verDocs({ ...comun, titulo: f.nombre, medida: "base", agrupar: "producto", clave: f.clave, cifra: f.valor, detalle: "Base sin IVA de sus líneas", filtros: filtrosComunes() }),
          {
            etiqueta: "Ver su precio en el explorador",
            icono: <LineChart className={ICONO} aria-hidden />,
            onClick: () => salir(() => onExplorar({ medida: "precio", agrupar: "mes", desglose: "proveedor", grafica: "auto", filtros: { ...FILTROS_VACIOS, productos: [f.clave] } })),
          },
        ];
      case "locales":
      case "gasto_mes":
      case "precio_producto": {
        const r = rangoDeClave(agrupar, f.clave, fechas);
        return r
          ? [
              verDocs({ titulo: `${f.nombreLargo}`, desde: r.desde, hasta: r.hasta, medida, local: lrpc, cifra: f.valor, filtros: filtrosComunes() }),
              ...(agrupar === "mes" ? [{ etiqueta: "Abrir en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => salir(() => onIrA(enlaceMesCompras(f.clave, lrpc))) }] : []),
            ]
          : [];
      }
      case "subidas": {
        const s = f.dato as Subida;
        return [
          {
            etiqueta: "Ver su precio en el explorador",
            icono: <LineChart className={ICONO} aria-hidden />,
            onClick: () => salir(() => onExplorar({ medida: "precio", agrupar: "mes", desglose: "proveedor", filtros: { ...FILTROS_VACIOS, productos: [s.producto], unidad: s.unidad ? s.unidad.toLowerCase() : null } })),
          },
          ...(s.proveedor_id !== null
            ? [
                verDocs({ ...comun, titulo: `${s.producto} · ${nombreCorto(s.proveedor)}`, medida: "base", filtros: { proveedores: [s.proveedor_id], productos: [s.producto] }, detalle: "Base sin IVA de sus líneas" }),
                ...enCompras(s.proveedor_id),
              ]
            : []),
        ];
      }
      case "fijos": {
        const g = f.dato as GastoFijo;
        return g.id === null
          ? []
          : [
              verDocs({
                titulo: nombreCorto(g.nombre),
                medida: "gasto",
                local: lrpc,
                filtros: { proveedores: [g.id], tipos: ["factura"] },
                desde: g.desdeMedia ?? tab.data?.fijos.ventana?.desde ?? fechas.desde,
                hasta: g.hastaMedia ?? tab.data?.fijos.ventana?.hasta ?? fechas.hasta,
                detalle: `Sus facturas · media de ${plural(g.meses, "mes", "meses")}: ${formatCurrency(g.medio_mes)} al mes`,
              }),
              ...enCompras(g.id),
            ];
      }
      case "por_revisar": {
        const d = f.dato as DocumentoCifra;
        return [
          { etiqueta: "Abrir el albarán en Compras", icono: <ShoppingCart className={ICONO} aria-hidden />, onClick: () => salir(() => onIrA(enlaceDocumentoCompras(d.id))) },
          ...(d.proveedorId !== null
            ? [verDocs({ ...comun, titulo: `Albaranes sin factura de ${f.nombre}`, medida: "gasto", filtros: { tipos: ["albaran"], proveedores: [d.proveedorId] } })]
            : []),
        ];
      }
      default:
        return [];
    }
  };

  /** «Ver documentos» de todo lo que se ve (si tiene sentido en el módulo). */
  const docsDeTodo: (() => void) | null = (() => {
    const comun = { desde: fechas.desde, hasta: fechas.hasta, local: lrpc };
    if (spec.fuente === "explorar" && consulta) {
      const titulo = `${spec.titulo}${lrpc ? ` · ${ETIQUETA_LOCAL[localF]}` : ""}`;
      return () =>
        onDocumentos(
          peticionSimple({ ...comun, titulo, medida: consulta.medida, filtros: filtrosComunes(), cifra: ex.data?.total.valor !== undefined && ex.data?.total.valor !== null ? (consulta.medida === "abonos" ? -Math.abs(ex.data.total.valor) : ex.data.total.valor) : null }),
        );
    }
    if (modulo === "por_revisar" && peticionAlbaranes) return () => onDocumentos(peticionAlbaranes);
    if (modulo === "fijos" && filtradas.length) {
      const ids = filtradas.map((f) => f.id).filter((x): x is number => x !== null);
      const v = tab.data?.fijos.ventana;
      return ids.length
        ? () => onDocumentos(peticionSimple({ titulo: "Facturas de los gastos fijos", medida: "gasto", local: lrpc, desde: v?.desde ?? fechas.desde, hasta: v?.hasta ?? fechas.hasta, filtros: { proveedores: ids, tipos: ["factura"] } }))
        : null;
    }
    return null;
  })();

  const abrirExplorador: (() => void) | null =
    spec.fuente === "explorar" && consulta
      ? () =>
          salir(() =>
            onExplorar({
              medida: consulta.medida,
              agrupar: consulta.agrupar,
              desglose: consulta.desglose,
              grafica: "auto",
              top: Math.min(consulta.top, 25),
              filtros: { ...FILTROS_VACIOS, proveedores, familias: spec.familia ? familias : [], productos },
            }),
          )
      : null;

  const exportar = () => {
    if (!base) return;
    const titulo = `${spec.titulo} · ${textoPeriodo} · ${ETIQUETA_LOCAL[spec.local ? localF : "todos"]}`;
    const blob = new Blob([csvDetalle(titulo, columnas, filtradas)], { type: "text/csv;charset=utf-8" });
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nombreCsv(spec.titulo, fechas.desde, fechas.hasta);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const limpiar = () => {
    setTexto("");
    setProveedores([]);
    setFamilias([]);
    setMin("");
    setMax("");
  };

  const ordenarPor = (col: string) =>
    setOrden((o) => (o?.col === col ? { col, dir: o.dir === "asc" ? "desc" : "asc" } : { col, dir: col === "nombre" || col === "fecha" ? "asc" : "desc" }));

  // ── Vista ──
  const descripcion = [
    textoPeriodo,
    spec.local ? ETIQUETA_LOCAL[localF] : "los dos locales",
    spec.iva ? (consulta?.medida === "gasto" ? "con IVA" : "sin IVA") : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const filtros = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorPeriodo valor={seleccion} onCambio={setSeleccion} hoy={hoy} />
        {spec.local && <Segmentado<FiltroLocal> etiqueta="Local" opciones={FILTROS_LOCAL} valor={localF} onCambio={setLocalF} />}
        {spec.iva && <Segmentado<Iva> etiqueta="IVA" opciones={OPCIONES_IVA} valor={iva} onCambio={setIva} />}
        {spec.tiempo && <Segmentado<Agrupar> etiqueta="Agrupar por" opciones={EJES_TIEMPO} valor={agrupar} onCambio={setAgrupar} />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!spec.tiempo && (
          <label className="relative min-w-[12rem] flex-1 basis-56 sm:max-w-xs">
            <span className="sr-only">{spec.buscar}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input type="search" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={`${spec.buscar}…`} className="h-11 pl-9" />
          </label>
        )}
        {spec.proveedor && <FiltroEntidades tipo="proveedor" elegidas={proveedores} onCambio={setProveedores} />}
        {spec.familia && <FiltroEntidades tipo="familia" elegidas={familias} onCambio={setFamilias} />}
        <FiltroRango etiqueta={spec.rango} min={min} max={max} onMin={setMin} onMax={setMax} />
        {nFiltros > 0 && (
          <button type="button" onClick={limpiar} className={cn("inline-flex min-h-11 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-primary hover:underline", FOCO)}>
            <X className="h-4 w-4" aria-hidden /> Quitar filtros
          </button>
        )}
      </div>
      {(proveedores.length > 0 || familias.length > 0 || minN !== null || maxN !== null) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Filtros aplicados">
          {proveedores.map((p) => (
            <Chip key={`p${p.id}`} texto={`Proveedor: ${p.nombre}`} onQuitar={() => setProveedores((l) => l.filter((x) => x.id !== p.id))} />
          ))}
          {familias.map((p) => (
            <Chip key={`f${p.id}`} texto={`Familia: ${p.nombre}`} onQuitar={() => setFamilias((l) => l.filter((x) => x.id !== p.id))} />
          ))}
          {minN !== null && <Chip texto={`${spec.rango} desde ${formatCurrency(minN)}`} onQuitar={() => setMin("")} />}
          {maxN !== null && <Chip texto={`${spec.rango} hasta ${formatCurrency(maxN)}`} onQuitar={() => setMax("")} />}
        </ul>
      )}
      {avisoIva && <p className="text-xs text-amber-800 dark:text-amber-300">Con una familia se mide la base sin IVA de sus líneas (el IVA va por documento).</p>}
    </div>
  );

  return (
    <>
      {/* Cabecera */}
      <div className="flex shrink-0 items-start gap-3 border-b border-border/70 px-4 pb-3 pt-4 sm:px-6">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{spec.titulo}</DialogTitle>
          <DialogDescription className="mt-0.5 text-sm text-muted-foreground">{descripcion}</DialogDescription>
        </div>
        {actualizando && !cargando && (
          <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" role="status">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Actualizando…
          </span>
        )}
        <DialogClose
          className={cn("-mr-2 -mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", FOCO)}
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" aria-hidden />
        </DialogClose>
      </div>

      {/* Filtros: a la vista desde sm; en el móvil, plegados tras «Filtros». */}
      <div className="shrink-0 border-b border-border/70 bg-muted/20 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => setVerFiltros((v) => !v)}
          aria-expanded={verFiltros}
          className={cn("flex min-h-11 w-full items-center gap-2 rounded-md text-sm font-medium sm:hidden", FOCO)}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden />
          Filtros{nFiltros > 0 ? ` (${nFiltros})` : ""}
          <span className="truncate font-normal text-muted-foreground">· {descripcion}</span>
          <ChevronDown className={cn("ml-auto h-4 w-4 shrink-0 transition-transform", verFiltros && "rotate-180")} aria-hidden />
        </button>
        <div className={cn("max-sm:mt-2", !verFiltros && "max-sm:hidden")}>{filtros}</div>
      </div>

      {/* Cuerpo */}
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
        {cargando ? (
          <div className="space-y-2" role="status" aria-label="Cargando">
            <div className="h-48 animate-pulse rounded-xl bg-muted/60 motion-reduce:animate-none" />
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted/50 motion-reduce:animate-none" />
            ))}
          </div>
        ) : error && !base ? (
          <EstadoError titulo="No se han podido leer los datos" detalle={(error as Error)?.message} onReintentar={reintentar} />
        ) : !base || base.filas.length === 0 ? (
          <EstadoVacio icono={<BarChart3 />} titulo="No hay datos con estos filtros" texto="Prueba con otro periodo o con los dos locales." />
        ) : (
          <div className={cn("grid gap-4 @[62rem]:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @[62rem]:items-start", actualizando && "opacity-70 transition-opacity")}>
            <Segmentado<"grafica" | "tabla">
              etiqueta="Ver como"
              valor={vista}
              onCambio={setVista}
              opciones={[
                { valor: "grafica", etiqueta: "Gráfica" },
                { valor: "tabla", etiqueta: `Tabla (${formatEntero(filtradas.length)})` },
              ]}
              className="w-full @[62rem]:hidden [&>button]:flex-1"
            />
            <section
              aria-label="Gráfica"
              className={cn("min-w-0 rounded-xl border border-border/70 bg-card p-3 sm:p-4 @[62rem]:sticky @[62rem]:top-0", vista !== "grafica" && "hidden @[62rem]:block")}
            >
              {spec.tiempo && ex.data ? (
                <GraficaExplorador
                  exploracion={ex.data}
                  tipo={ex.data.parametros.medida === "precio" ? "lineas" : ex.data.parametros.desglose ? "apiladas" : "barras"}
                  alto={260}
                  seleccion={elegida}
                  onSeleccion={(c) => setElegida((e) => (e === c ? null : c))}
                  descripcion={`${spec.titulo}. ${resumenExploracion(ex.data)}`}
                />
              ) : (
                <GraficaRanking filas={filtradas} tipoValor={tipoValor} elegida={elegida} onElegir={(c) => setElegida((e) => (e === c ? null : c))} titulo={spec.titulo} />
              )}
            </section>
            <section aria-label="Tabla" className={cn("min-w-0", vista !== "tabla" && "hidden @[62rem]:block")}>
              <ResumenFilas n={filtradas.length} de={base.filas.length} total={total} tipoValor={tipoValor} resto={resto} medida={consulta?.medida} />
              {filtradas.length === 0 ? (
                <EstadoVacio icono={<Search />} titulo="Ninguna fila con estos filtros" texto="Quita algún filtro o cambia el rango de importe." accion={{ etiqueta: "Quitar filtros", onClick: limpiar }} />
              ) : (
                <TablaDetalle columnas={columnas} filas={filtradas} orden={orden} onOrdenar={ordenarPor} acciones={accionesFila} elegida={elegida} titulo={spec.titulo} />
              )}
              {modulo === "por_revisar" && docs.hasNextPage && (
                <button
                  type="button"
                  onClick={() => void docs.fetchNextPage()}
                  disabled={docs.isFetchingNextPage}
                  className={cn("mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted/60", FOCO)}
                >
                  {docs.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Cargar más ({(docs.data?.pages[0]?.documentos ?? 0) - (base?.filas.length ?? 0)} quedan)
                </button>
              )}
            </section>
          </div>
        )}
      </div>

      {/* Pie */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
        <p className="mr-auto hidden text-sm text-muted-foreground sm:block">
          {base ? (
            <>
              <span className="font-medium tabular-nums text-foreground">{formatEntero(filtradas.length)}</span> {filtradas.length === 1 ? "fila" : "filas"}
              {tipoValor === "eur" && (
                <>
                  {" · "}
                  <span className="font-medium tabular-nums text-foreground">{formatImporte(total)}</span>
                </>
              )}
            </>
          ) : (
            " "
          )}
        </p>
        <BotonPie onClick={exportar} disabled={!base || filtradas.length === 0} icono={<ArrowDownToLine className="h-4 w-4" aria-hidden />} corto="CSV">
          Exportar CSV
        </BotonPie>
        {docsDeTodo && (
          <BotonPie onClick={docsDeTodo} disabled={!base || actualizando} icono={<FileText className="h-4 w-4" aria-hidden />} corto="Documentos">
            Ver documentos
          </BotonPie>
        )}
        {abrirExplorador && (
          <BotonPie onClick={abrirExplorador} icono={<BarChart3 className="h-4 w-4" aria-hidden />} corto="Explorador">
            Abrir en el explorador
          </BotonPie>
        )}
      </div>
    </>
  );
}

// ─── Piezas del detalle ─────────────────────────────────────────────────────

/** Botón del pie. En el móvil, con su texto corto (el nombre accesible sigue siendo el largo). */
function BotonPie({ onClick, disabled, icono, children, corto }: { onClick: () => void; disabled?: boolean; icono: ReactNode; children: string; corto: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={children}
      className={cn(
        "inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50 sm:flex-none",
        FOCO,
      )}
    >
      {icono}
      <span className="sm:hidden" aria-hidden>
        {corto}
      </span>
      <span className="hidden sm:inline" aria-hidden>
        {children}
      </span>
    </button>
  );
}

function Chip({ texto, onQuitar }: { texto: string; onQuitar: () => void }) {
  return (
    <li className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background py-0.5 pl-3 pr-0.5 text-sm">
      <span className="truncate">{texto}</span>
      <button type="button" onClick={onQuitar} aria-label={`Quitar ${texto}`} className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-muted", FOCO)}>
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </li>
  );
}

const DISPARADOR = cn(
  "inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium hover:bg-muted/60 aria-expanded:bg-muted/60",
  FOCO,
);

/** Elegir proveedores o familias (varios), con buscador. */
function FiltroEntidades({ tipo, elegidas, onCambio }: { tipo: "proveedor" | "familia"; elegidas: EntidadFiltro[]; onCambio: (l: EntidadFiltro[]) => void }) {
  const [abierto, setAbierto] = useState(false);
  const [busca, setBusca] = useState("");
  useEscapeCierra(abierto, () => setAbierto(false));
  const prov = useProveedoresFiltro(abierto && tipo === "proveedor");
  const fam = useFamiliasFiltro(abierto && tipo === "familia");
  const q = tipo === "proveedor" ? prov : fam;
  const titulo = tipo === "proveedor" ? "Proveedor" : "Familia";
  const lista = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const todas = (q.data ?? []).map((x) => ({ id: x.id, nombre: tipo === "proveedor" ? nombreCorto(x.nombre) : x.nombre, largo: x.nombre }));
    return (t ? todas.filter((x) => x.largo.toLowerCase().includes(t)) : todas).slice(0, 80);
  }, [q.data, busca, tipo]);
  const elegido = (id: number) => elegidas.some((e) => e.id === id);
  const alternar = (x: EntidadFiltro) => onCambio(elegido(x.id) ? elegidas.filter((e) => e.id !== x.id) : [...elegidas, x]);
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" className={DISPARADOR} aria-label={`Filtrar por ${titulo.toLowerCase()}${elegidas.length ? ` (${elegidas.length})` : ""}`}>
          {titulo}
          {elegidas.length > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">{elegidas.length}</span>}
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="pointer-events-auto w-[min(22rem,calc(100vw-1.5rem))] p-0" aria-label={`Elegir ${titulo.toLowerCase()}`}>
        <div className="border-b border-border/70 p-2">
          <label className="relative block">
            <span className="sr-only">Buscar {titulo.toLowerCase()}</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder={`Buscar ${titulo.toLowerCase()}…`} className="h-11 pl-9" />
          </label>
        </div>
        <ul className="max-h-72 overflow-y-auto p-1" aria-label={titulo === "Proveedor" ? "Proveedores" : "Familias"}>
          {q.isLoading && (
            <li className="flex items-center gap-2 px-2 py-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Cargando…
            </li>
          )}
          {!q.isLoading && lista.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">Ninguno coincide.</li>}
          {lista.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={elegido(x.id)}
                onClick={() => alternar({ id: x.id, nombre: x.nombre })}
                title={x.largo}
                className={cn("flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-muted/60", FOCO)}
              >
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input",
                    elegido(x.id) && "border-primary bg-primary text-primary-foreground",
                  )}
                  aria-hidden
                >
                  {elegido(x.id) && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1 truncate">{x.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** Rango de importe (desde / hasta), en euros. */
function FiltroRango({ etiqueta, min, max, onMin, onMax }: { etiqueta: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void }) {
  const activos = (min.trim() ? 1 : 0) + (max.trim() ? 1 : 0);
  const [abierto, setAbierto] = useState(false);
  useEscapeCierra(abierto, () => setAbierto(false));
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" className={DISPARADOR} aria-label={`Filtrar por ${etiqueta.toLowerCase()}${activos ? ` (${activos})` : ""}`}>
          {etiqueta}
          {activos > 0 && <span className="rounded-full bg-primary px-1.5 text-xs font-semibold leading-5 text-primary-foreground">{activos}</span>}
          <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" collisionPadding={12} className="pointer-events-auto w-[min(20rem,calc(100vw-1.5rem))] p-3" aria-label={`Rango de ${etiqueta.toLowerCase()}`}>
        <p className="mb-2 text-xs text-muted-foreground">{etiqueta} en euros (los abonos, sin el signo).</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs font-medium text-muted-foreground">
            Desde
            <Input inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder="0" className="mt-1 h-11 tabular-nums" />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            Hasta
            <Input inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} placeholder="Sin límite" className="mt-1 h-11 tabular-nums" />
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ResumenFilas({
  n,
  de,
  total,
  tipoValor,
  resto,
  medida,
}: {
  n: number;
  de: number;
  total: number;
  tipoValor: string;
  resto: { entidades: number; valor: number | null } | null;
  medida?: string;
}) {
  return (
    <p className="mb-2 text-sm text-muted-foreground" aria-live="polite">
      {n === de ? `${formatEntero(n)} ${n === 1 ? "fila" : "filas"}` : `${formatEntero(n)} de ${formatEntero(de)} filas`}
      {tipoValor === "eur" && <> · suman <span className="font-medium tabular-nums text-foreground">{formatImporte(total)}</span></>}
      {resto && (
        <>
          {" "}
          · se ven las {formatEntero(de)} primeras; {plural(resto.entidades, "más suma", "más suman")}{" "}
          <span className="tabular-nums">{formatImporte(resto.valor === null ? null : medida === "abonos" ? -Math.abs(resto.valor) : resto.valor)}</span>
        </>
      )}
    </p>
  );
}

/** Formato de una celda según su columna. */
function formatoCelda(c: ColumnaDetalle, f: FilaDetalle): string {
  const v = f.celdas[c.id];
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return c.tipo === "fecha" ? fechaCorta(v) : v;
  switch (c.tipo) {
    case "eur":
      return formatImporte(v);
    case "entero":
      return formatEntero(v);
    case "pct":
      return textoPct(v, false);
    case "variacion":
      return textoPct(v);
    case "precio":
      return `${formatCurrency(v)}${f.celdas.unidad ? `/${f.celdas.unidad}` : ""}`;
    default:
      return String(v);
  }
}

const NUMERICA = (t: ColumnaDetalle["tipo"]) => t !== "texto" && t !== "fecha";

/** Tabla ordenable: cada cabecera es un botón con `aria-sort`; la primera columna, fija al desplazar. */
function TablaDetalle({
  columnas,
  filas,
  orden,
  onOrdenar,
  acciones,
  elegida,
  titulo,
}: {
  columnas: ColumnaDetalle[];
  filas: FilaDetalle[];
  orden: { col: string; dir: Direccion } | null;
  onOrdenar: (col: string) => void;
  acciones: (f: FilaDetalle) => AccionMenu[];
  elegida: string | null;
  titulo: string;
}) {
  const primera = columnas.findIndex((c) => c.id === "nombre");
  return (
    // En ancho `overflow-x: clip` (no crea caja de scroll): la cabecera se queda pegada arriba al desplazar.
    <div className="overflow-x-auto rounded-xl border border-border/70 @[62rem]:overflow-x-clip">
      <table className="w-full text-sm">
        <caption className="sr-only">{titulo}: una fila por elemento. Las cabeceras ordenan la tabla.</caption>
        <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            {columnas.map((c, i) => {
              const activa = orden?.col === c.id;
              const Icono = !activa ? ArrowUpDown : orden.dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={activa ? (orden.dir === "asc" ? "ascending" : "descending") : "none"}
                  className={cn("whitespace-nowrap px-1 py-1 font-medium", NUMERICA(c.tipo) && "text-right", i === primera && "sticky left-0 z-10 bg-muted")}
                >
                  <button
                    type="button"
                    onClick={() => onOrdenar(c.id)}
                    className={cn("inline-flex min-h-9 items-center gap-1 rounded-md px-2 hover:bg-background/70 hover:text-foreground", activa && "text-foreground", FOCO)}
                  >
                    {c.etiqueta}
                    <Icono className={cn("h-3.5 w-3.5", !activa && "opacity-40")} aria-hidden />
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => (
            <tr key={f.clave} className={cn("border-t border-border/50", elegida === f.clave && "bg-primary/5")} data-elegida={elegida === f.clave || undefined}>
              {columnas.map((c, i) =>
                i === primera ? (
                  <th key={c.id} scope="row" className={cn("sticky left-0 z-[1] max-w-[11rem] bg-card p-0 text-left font-normal sm:max-w-[22rem]", elegida === f.clave && "bg-[color-mix(in_srgb,hsl(var(--primary))_5%,hsl(var(--card)))]")}>
                    <FilaConMenu
                      nombre={`${f.nombreLargo}: ${formatoCelda(columnas.find((x) => x.id === "valor") ?? c, f)}. Opciones`}
                      acciones={acciones(f)}
                      title={f.nombreLargo}
                      className={cn("flex min-h-11 w-full min-w-[8rem] items-center gap-1 px-3 text-left hover:bg-muted/60 disabled:cursor-default disabled:hover:bg-transparent", FOCO)}
                    >
                      <span className="min-w-0 truncate">{f.nombre}</span>
                    </FilaConMenu>
                  </th>
                ) : (
                  <td key={c.id} className={cn("whitespace-nowrap px-3 py-2", NUMERICA(c.tipo) && "text-right tabular-nums", c.id === "valor" && "font-medium", c.tipo === "variacion" && "text-red-700 dark:text-red-400")}>
                    {formatoCelda(c, f)}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Ranking en barras horizontales (HTML) con los 12 primeros de lo que se ve. */
function GraficaRanking({
  filas,
  tipoValor,
  elegida,
  onElegir,
  titulo,
}: {
  filas: FilaDetalle[];
  tipoValor: string;
  elegida: string | null;
  onElegir: (clave: string) => void;
  titulo: string;
}) {
  const top = useMemo(() => [...filas].sort((a, b) => Math.abs(b.valor ?? 0) - Math.abs(a.valor ?? 0)).slice(0, 12), [filas]);
  const max = Math.max(1, ...top.map((f) => Math.abs(f.valor ?? 0)));
  const fmt = (v: number | null) => (v === null ? "—" : tipoValor === "variacion" ? textoPct(v) : tipoValor === "pct" ? textoPct(v, false) : formatImporte(v));
  if (top.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nada que dibujar con estos filtros.</p>;
  return (
    <figure className="m-0">
      <figcaption className="mb-2 text-xs font-medium text-muted-foreground">
        {filas.length > top.length ? `Los ${top.length} mayores de ${formatEntero(filas.length)}` : `${titulo}`}
      </figcaption>
      <ol className="space-y-1" aria-label={`Gráfica: ${titulo}`}>
        {top.map((f) => (
          <li key={f.clave}>
            <button
              type="button"
              onClick={() => onElegir(f.clave)}
              aria-pressed={elegida === f.clave}
              title={f.nombreLargo}
              className={cn(
                "grid min-h-10 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded-md px-1.5 py-1 text-left hover:bg-muted/50 aria-pressed:bg-primary/5",
                FOCO,
              )}
            >
              <span className="min-w-0 truncate text-sm">{f.nombre}</span>
              <span className="whitespace-nowrap text-right text-sm tabular-nums">{fmt(f.valor)}</span>
              <span className="col-span-2 block h-2 rounded-full bg-muted/70" aria-hidden>
                <span
                  className={cn("block h-full rounded-full", tipoValor === "variacion" ? "bg-red-600 dark:bg-red-400" : COLOR_CASA_TOMAS, elegida && elegida !== f.clave && "opacity-40")}
                  style={{ width: `${(Math.abs(f.valor ?? 0) / max) * 100}%` }}
                />
              </span>
            </button>
          </li>
        ))}
      </ol>
    </figure>
  );
}

