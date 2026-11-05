import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, RotateCw, Search, Truck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAlbaranes, useFacturas, type Factura } from "@/hooks/useFacturas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCategoriasProducto, useResumenProductos } from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { avisosDocumento, indiceAnomaliasPrecio, indicePreciosLinea, plural } from "@/components/facturas/shared/formatters";
import { TabProductos } from "@/components/facturas/productos/TabProductos";
import { ProveedoresDialog } from "@/components/facturas/productos/ProveedoresDialog";
import { EditarFacturaDialog } from "@/components/facturas/EditarFacturaDialog";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { indexarCategorias, normalizarBusqueda } from "@/lib/facturas/productos";
import {
  FILTROS_DOCUMENTOS,
  FILTROS_PROVEEDORES,
  MODOS_COMPRAS,
  contarFiltrosDocumentos,
  contarPorModo,
  filtrarDocumentos,
  palabrasBusqueda,
  proveedoresDelTexto,
  type FiltroDocumentos,
  type FiltroProveedores,
  type ModoCompras,
} from "@/lib/facturas/compras";
import { etiquetaMes } from "@/lib/facturas/agrupacionDocumentos";
import {
  FILTROS_LOCAL,
  PERIODOS,
  agregarPorProveedor,
  esAbono,
  mesesGrafica,
  mismoPeriodo,
  ordenarProveedoresPorGasto,
  pasaLocal,
  pasaPeriodo,
  rangoPeriodo,
  resumirCompras,
  textoPeriodo,
  topProveedores,
  type AgregadoProveedor,
  type FiltroLocal,
  type Periodo,
} from "@/lib/facturas/resumenCompras";
import { ListaDocumentos } from "./ListaDocumentos";
import { ListaProveedores } from "./ListaProveedores";
import { FichaDocumento } from "./FichaDocumento";
import { FichaProducto } from "./FichaProducto";
import { FichaProveedor } from "./FichaProveedor";
import { ResumenCompras } from "./ResumenCompras";

const TODO_EL_PERIODO = { desde: null, hasta: null, tipo: null } as const;
const SIN_AVISOS: ReturnType<typeof avisosDocumento> = [];
const PERIODO_TODO: Periodo = { tipo: "todo" };

/** La ficha a pantalla completa (documento o producto). */
type Ficha = { tipo: "documento"; id: number } | { tipo: "producto"; id: number };

/** De qué ficha se saltó a la actual, para volver con un toque («Volver a …»). */
interface Origen {
  ficha: Ficha;
  etiqueta: string;
}

// Chip de filtro: 32 px a la vista, 44 de zona táctil (el contenedor mide 44 y el
// `before:` amplía el toque, ver `barraChips`).
const chipClase =
  "relative inline-flex h-8 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] font-medium text-muted-foreground transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] hover:bg-muted/50 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-muted aria-pressed:text-foreground";
const barraChips = "flex h-11 shrink-0 snap-x items-center gap-1 overflow-x-auto overscroll-x-contain no-scrollbar";

const tipoDocumento = (d: Factura) => (esAbono(d) ? "Abono" : d.tipo === "albaran" ? "Albarán" : "Factura");

/**
 * Facturas › Compras (rediseño a todo el ancho, 05/11/2026): UN buscador, tres
 * formas de mirar lo comprado (Documentos · Productos · Proveedores) con el
 * número de resultados de cada una, el local (Todos · Casa Tomás · Touza) y el
 * periodo, el resumen plegable y la lista A TODO EL ANCHO.
 *
 * Al tocar un documento o un producto su ficha ocupa toda la pestaña, con
 * «← Volver a la lista» (que la deja exactamente como estaba: la lista no se
 * desmonta, solo se oculta, y se le devuelve la posición de scroll y el foco)
 * y, si se saltó desde otra ficha, «Volver a …». Los proveedores se despliegan
 * en su propia fila (acordeón). Sin scroll de página: solo la lista y la ficha
 * se desplazan por dentro.
 */
export function TabCompras({
  onPreguntarIA,
  modoPedido,
}: {
  onPreguntarIA?: (doc: Factura, tipo: "factura" | "albarán") => void;
  /**
   * Abre Compras en ese modo (cada `clave` nueva vuelve a aplicarlo). Sin esto, Documentos.
   * `doc`: abre ese documento. `mes` (YYYY-MM): filtra ese mes. `prov`: abre ese proveedor desplegado
   * (los dos últimos, desde Facturas › Análisis).
   */
  modoPedido?: { modo: ModoCompras; clave: string; doc?: number; mes?: string; prov?: number };
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const [hoy] = useState(() => new Date());
  const [texto, setTexto] = useState("");
  const textoDiferido = useDeferredValue(texto);
  const [modo, setModo] = useState<ModoCompras>(modoPedido?.modo ?? "documentos");
  const [filtroDocs, setFiltroDocs] = useState<FiltroDocumentos>("todo");
  const [filtroProv, setFiltroProv] = useState<FiltroProveedores>("todos");
  const [local, setLocal] = useState<FiltroLocal>("todos");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_TODO);
  // El preset al que se vuelve al quitar el mes elegido en la gráfica.
  const [periodoPrevio, setPeriodoPrevio] = useState<Periodo>(PERIODO_TODO);
  const [mesPedido, setMesPedido] = useState<{ mes: string; n: number } | null>(null);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [origen, setOrigen] = useState<Origen | null>(null);
  // Lo último abierto en cada lista (se marca con `aria-current` al volver).
  const [ultimoDoc, setUltimoDoc] = useState<number | null>(null);
  const [ultimoProducto, setUltimoProducto] = useState<number | null>(null);
  const [provAbierto, setProvAbierto] = useState<number | null>(null);
  const [pedidoVerProv, setPedidoVerProv] = useState(0);
  const [editando, setEditando] = useState<Factura | null>(null);
  const [gestionando, setGestionando] = useState(false);

  const vistaListaRef = useRef<HTMLDivElement>(null);
  const volverRef = useRef<HTMLButtonElement>(null);
  /** Al abrir una ficha: scroll de cada zona de la lista y el elemento con el foco, para devolverlos al volver. */
  const recuerdoLista = useRef<{ scrolls: [Element, number, number][]; foco: HTMLElement | null } | null>(null);

  // ── Datos (react-query comparte la caché con las demás pantallas) ─────────
  const facturasQ = useFacturas();
  const albaranesQ = useAlbaranes();
  const resumenQ = useResumenProductos(TODO_EL_PERIODO);
  const categoriasQ = useCategoriasProducto();
  const proveedoresQ = useProveedores();

  const facturas = useMemo(() => facturasQ.data ?? [], [facturasQ.data]);
  const albaranes = useMemo(() => albaranesQ.data ?? [], [albaranesQ.data]);
  const documentos = useMemo(() => [...facturas, ...albaranes], [facturas, albaranes]);
  const docPorId = useMemo(() => new Map(documentos.map((d) => [d.id, d])), [documentos]);
  const productos = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const proveedores = useMemo(() => proveedoresQ.data?.proveedores ?? [], [proveedoresQ.data]);
  const mapaCategorias = useMemo(() => indexarCategorias(categoriasQ.data ?? []), [categoriasQ.data]);
  const resolver = useMemo(() => crearResolverProveedor(proveedores), [proveedores]);

  // Índice de precios por tipo (proveedor + nombre), calculado una vez sobre TODO
  // el histórico: lo usan los avisos de cada documento y el aviso de cada línea.
  const mediaPrecioFacturas = useMemo(() => indicePreciosLinea(facturas), [facturas]);
  const mediaPrecioAlbaranes = useMemo(() => indicePreciosLinea(albaranes), [albaranes]);
  const avisosPorId = useMemo(() => {
    const mapa = new Map<number, ReturnType<typeof avisosDocumento>>();
    const anomaliaFactura = indiceAnomaliasPrecio(facturas, mediaPrecioFacturas);
    const anomaliaAlbaran = indiceAnomaliasPrecio(albaranes, mediaPrecioAlbaranes);
    facturas.forEach((f) => mapa.set(f.id, avisosDocumento(f, facturas, anomaliaFactura)));
    albaranes.forEach((a) => mapa.set(a.id, avisosDocumento(a, albaranes, anomaliaAlbaran)));
    return mapa;
  }, [facturas, albaranes, mediaPrecioFacturas, mediaPrecioAlbaranes]);

  // ── Local y periodo: afectan a Documentos, Proveedores y Resumen ─────────
  const rango = useMemo(() => rangoPeriodo(periodo, hoy), [periodo, hoy]);
  const filtrosActivos = local !== "todos" || rango !== null;
  const docsLocal = useMemo(() => documentos.filter((d) => pasaLocal(d, local)), [documentos, local]);
  const docsBase = useMemo(() => (rango ? docsLocal.filter((d) => pasaPeriodo(d, rango)) : docsLocal), [docsLocal, rango]);
  const agregados = useMemo(() => agregarPorProveedor(docsBase, resolver), [docsBase, resolver]);
  const resumen = useMemo(() => resumirCompras(docsBase), [docsBase]);
  const meses = useMemo(() => mesesGrafica(docsLocal, hoy), [docsLocal, hoy]);
  const top = useMemo(() => topProveedores(agregados, 10), [agregados]);

  // ── Contadores y listas ───────────────────────────────────────────────────
  const provDelTexto = useMemo(
    () => ordenarProveedoresPorGasto(proveedoresDelTexto(proveedores, docsBase, textoDiferido, resolver), agregados, filtrosActivos),
    [proveedores, docsBase, textoDiferido, resolver, agregados, filtrosActivos],
  );
  const contadores = useMemo(() => {
    const c = contarPorModo({ texto: textoDiferido, documentos: docsBase, productos, proveedores: [], mapaCategorias, resolver });
    return { ...c, proveedores: provDelTexto.length };
  }, [textoDiferido, docsBase, productos, mapaCategorias, resolver, provDelTexto]);
  const cuentaFiltrosDocs = useMemo(
    () => contarFiltrosDocumentos(docsBase, textoDiferido, avisosPorId),
    [docsBase, textoDiferido, avisosPorId],
  );
  const docsVisibles = useMemo(
    () => filtrarDocumentos(docsBase, textoDiferido, filtroDocs, avisosPorId),
    [docsBase, textoDiferido, filtroDocs, avisosPorId],
  );
  const conSinFactura = useMemo(
    () => provDelTexto.filter((p) => (agregados.get(`#${p.id}`)?.albaranesSinFactura ?? 0) > 0),
    [provDelTexto, agregados],
  );
  const provVisibles = useMemo(() => {
    const lista = filtroProv === "albaranes_sin_factura" ? conSinFactura : provDelTexto;
    // El proveedor abierto desde una ficha o desde el top 10 se ve aunque los filtros lo escondan.
    if (provAbierto !== null && !lista.some((p) => p.id === provAbierto)) {
      const p = proveedores.find((x) => x.id === provAbierto);
      if (p) return [p, ...lista];
    }
    return lista;
  }, [filtroProv, conSinFactura, provDelTexto, provAbierto, proveedores]);

  // ── Ficha a pantalla completa ─────────────────────────────────────────────
  const etiquetaFicha = (f: Ficha | null): string | null => {
    if (!f) return null;
    if (f.tipo === "documento") {
      const d = docPorId.get(f.id);
      return d ? `${tipoDocumento(d).toLowerCase()} ${d.numero_documento}` : null;
    }
    return productos.find((p) => p.producto_id === f.id)?.nombre ?? null;
  };

  /** Abre una ficha. Desde la lista (`desdeLista`) se guarda cómo estaba; desde otra ficha, «Volver a …». */
  const abrirFicha = (destino: Ficha, desdeLista: boolean) => {
    if (desdeLista || !ficha) {
      const raiz = vistaListaRef.current;
      recuerdoLista.current = {
        // Solo las zonas con scroll propio (lista, resumen, barras de chips).
        scrolls: raiz
          ? [...raiz.querySelectorAll('[class*="overflow-"]')].filter((el) => el.scrollTop > 0 || el.scrollLeft > 0).map((el) => [el, el.scrollTop, el.scrollLeft] as [Element, number, number])
          : [],
        foco: document.activeElement instanceof HTMLElement && raiz?.contains(document.activeElement) ? document.activeElement : null,
      };
      setOrigen(null);
    } else {
      const etiqueta = etiquetaFicha(ficha);
      setOrigen(etiqueta && !(ficha.tipo === destino.tipo && ficha.id === destino.id) ? { ficha, etiqueta } : null);
    }
    if (destino.tipo === "documento") setUltimoDoc(destino.id);
    else setUltimoProducto(destino.id);
    setFicha(destino);
  };

  const volverALista = () => {
    setFicha(null);
    setOrigen(null);
  };
  const volverAOrigen = () => {
    if (!origen) return;
    setFicha(origen.ficha);
    setOrigen(null);
  };

  // Al abrir una ficha, el foco va a «Volver a la lista»; al volver, la lista
  // recupera su scroll y el foco vuelve a la fila que se tocó.
  const habiaFicha = useRef(false);
  useLayoutEffect(() => {
    if (ficha) {
      volverRef.current?.focus({ preventScroll: true });
    } else if (habiaFicha.current) {
      const r = recuerdoLista.current;
      r?.scrolls.forEach(([el, top, izquierda]) => {
        el.scrollTop = top;
        el.scrollLeft = izquierda;
      });
      // El foco, a la fila que se tocó (en táctil un toque no enfoca: se busca la marcada como abierta).
      const foco = r?.foco?.isConnected ? r.foco : vistaListaRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
      foco?.focus({ preventScroll: true });
      recuerdoLista.current = null;
    }
    habiaFicha.current = ficha !== null;
  }, [ficha]);

  const abrirDocumento = (id: number) => abrirFicha({ tipo: "documento", id }, false);
  const abrirProducto = (id: number) => abrirFicha({ tipo: "producto", id }, false);
  const abrirProductoPorNombre = (nombre: string, desdeLista: boolean) => {
    const n = normalizarBusqueda(nombre);
    const p = productos.find((x) => normalizarBusqueda(x.nombre) === n);
    if (p) abrirFicha({ tipo: "producto", id: p.producto_id }, desdeLista);
    else {
      // No está en el catálogo con ese nombre exacto: se busca en la lista de Productos.
      volverALista();
      setTexto(nombre);
      setModo("productos");
    }
  };

  /** Lleva a Proveedores con ese proveedor desplegado y a la vista. */
  const verProveedor = (id: number) => {
    volverALista();
    setModo("proveedores");
    setFiltroProv("todos");
    if (texto && !provDelTexto.some((x) => x.id === id)) setTexto("");
    setProvAbierto(id);
    setPedidoVerProv((n) => n + 1);
  };
  const abrirProveedorPorNombre = (nombre: string) => {
    const clave = resolver(nombre).clave;
    const p = proveedores.find((x) => `#${x.id}` === clave);
    if (p) verProveedor(p.id);
  };
  const abrirProveedorDelTop = (a: AgregadoProveedor) => {
    if (a.clave.startsWith("#")) verProveedor(Number(a.clave.slice(1)));
    else {
      // Proveedor sin unificar (falta la migración): sus documentos, por el nombre.
      setTexto(a.nombre);
      setModo("documentos");
    }
  };
  useEffect(() => {
    if (pedidoVerProv === 0 || provAbierto === null) return;
    const marco = requestAnimationFrame(() => {
      const fila = vistaListaRef.current?.querySelector(`[data-proveedor-id="${provAbierto}"]`);
      const sinMovimiento = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      fila?.scrollIntoView?.({ block: "start", behavior: sinMovimiento ? "auto" : "smooth" });
    });
    return () => cancelAnimationFrame(marco);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoVerProv]);

  const alternarProveedor = (id: number) => setProvAbierto((actual) => (actual === id ? null : id));

  const elegirPeriodo = (p: Periodo) => {
    setPeriodo(p);
    setMesPedido(null);
  };
  const elegirMes = (mes: string) => {
    if (periodo.tipo === "mes" && periodo.mes === mes) {
      elegirPeriodo(periodoPrevio);
      return;
    }
    if (periodo.tipo !== "mes") setPeriodoPrevio(periodo);
    setPeriodo({ tipo: "mes", mes });
    setMesPedido((m) => ({ mes, n: (m?.n ?? 0) + 1 }));
  };

  const cambiarModo = (m: ModoCompras) => {
    setModo(m);
    setOrigen(null);
  };

  // Cambiar de modo desde fuera (enlace `?tab=productos`, `?modo=`): esa lista, sin ficha.
  useEffect(() => {
    if (!modoPedido) return;
    setModo(modoPedido.modo);
    if (!modoPedido.doc) volverALista();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoPedido?.clave, modoPedido?.modo]);

  // Enlace profundo a un documento (`?doc=`): se espera a que haya datos; si no
  // está en la caché (recién subido) se refresca una vez y, si sigue sin estar,
  // se abandona. Se abre su ficha sin «Volver a …».
  const [docPendiente, setDocPendiente] = useState<number | null>(modoPedido?.doc ?? null);
  const refrescado = useRef(false);
  useEffect(() => {
    if (modoPedido?.doc) {
      refrescado.current = false;
      setDocPendiente(modoPedido.doc);
    }
  }, [modoPedido?.clave, modoPedido?.doc]);
  useEffect(() => {
    if (docPendiente === null) return;
    if (docPorId.has(docPendiente)) {
      abrirFicha({ tipo: "documento", id: docPendiente }, true);
      setDocPendiente(null);
    } else if (!facturasQ.isFetching && !albaranesQ.isFetching) {
      if (refrescado.current) setDocPendiente(null);
      else {
        refrescado.current = true;
        void facturasQ.refetch();
        void albaranesQ.refetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPendiente, docPorId, facturasQ.isFetching, albaranesQ.isFetching]);

  // Enlaces desde Análisis: `?mes=YYYY-MM` deja ese mes como periodo (al quitarlo
  // se vuelve a «Todo») y `?prov=<id>` abre ese proveedor desplegado en cuanto
  // llega la lista de proveedores (si no existe, no se hace nada).
  useEffect(() => {
    const mes = modoPedido?.mes;
    if (!mes) return;
    setPeriodoPrevio(PERIODO_TODO);
    setPeriodo({ tipo: "mes", mes });
    setMesPedido((m) => ({ mes, n: (m?.n ?? 0) + 1 }));
  }, [modoPedido?.clave, modoPedido?.mes]);
  const [provPendiente, setProvPendiente] = useState<number | null>(modoPedido?.prov ?? null);
  useEffect(() => {
    if (modoPedido?.prov) setProvPendiente(modoPedido.prov);
  }, [modoPedido?.clave, modoPedido?.prov]);
  useEffect(() => {
    if (provPendiente === null || !proveedoresQ.data) return;
    if (proveedores.some((p) => p.id === provPendiente)) verProveedor(provPendiente);
    setProvPendiente(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provPendiente, proveedoresQ.data, proveedores]);

  // ── Contenido de la ficha ─────────────────────────────────────────────────
  let contenidoFicha: ReactNode = null;
  if (ficha?.tipo === "documento") {
    const doc = docPorId.get(ficha.id);
    if (doc) {
      const esAlbaran = doc.tipo === "albaran";
      contenidoFicha = (
        <FichaDocumento
          doc={doc}
          avisos={avisosPorId.get(doc.id) ?? SIN_AVISOS}
          mediaPrecio={esAlbaran ? mediaPrecioAlbaranes : mediaPrecioFacturas}
          facturaDelAlbaran={esAlbaran && doc.facturado_en_id != null ? (docPorId.get(doc.facturado_en_id) ?? null) : null}
          albaranesDeLaFactura={esAlbaran ? [] : albaranes.filter((a) => a.facturado_en_id === doc.id)}
          onEditar={setEditando}
          onPreguntarIA={onPreguntarIA ? (d) => onPreguntarIA(d, d.tipo === "albaran" ? "albarán" : "factura") : undefined}
          onAbrirProducto={abrirProducto}
          onAbrirProveedor={abrirProveedorPorNombre}
          onAbrirDocumento={abrirDocumento}
        />
      );
    } else {
      contenidoFicha = (
        <p className="p-4 text-sm text-muted-foreground" role="status">
          No se encuentra este documento: puede que se haya borrado.
        </p>
      );
    }
  } else if (ficha?.tipo === "producto") {
    contenidoFicha = <FichaProducto productoId={ficha.id} onAbrirDocumento={abrirDocumento} />;
  }

  const hayTexto = palabrasBusqueda(textoDiferido).length > 0;
  const errorDocs = facturasQ.error ?? albaranesQ.error;
  const cargandoDocs = facturasQ.isLoading || albaranesQ.isLoading;
  // Carga escalonada: la primera tanda ya está a la vista y las anteriores siguen llegando.
  const llegandoAnteriores = Boolean((facturasQ.isFetching && facturasQ.data) || (albaranesQ.isFetching && albaranesQ.data));
  const reintentar = () => {
    void facturasQ.refetch();
    void albaranesQ.refetch();
  };
  const mensajeProveedores = proveedoresQ.data?.faltaMigracion
    ? "La lista de proveedores unificados aún no está activada: falta aplicar la migración 20261007180000_proveedores_unificados."
    : proveedoresQ.error
      ? ((proveedoresQ.error as { message?: string }).message ?? "No se han podido cargar los proveedores")
      : null;
  const conLocalYPeriodo = modo !== "productos";
  const mesElegido = periodo.tipo === "mes" ? periodo.mes : null;

  const despliegueProveedor = (p: Proveedor) => (
    <FichaProveedor
      proveedor={p}
      agregado={agregados.get(`#${p.id}`)}
      facturas={facturas}
      resolver={resolver}
      avisosPorId={avisosPorId}
      seleccionadoDocId={ultimoDoc}
      puedeEditar={puedeEditar}
      hayFiltros={filtrosActivos}
      onAbrirDocumento={(id) => abrirFicha({ tipo: "documento", id }, true)}
      onAbrirProducto={(nombre) => abrirProductoPorNombre(nombre, true)}
    />
  );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tab-compras">
      {/* ── LISTA: se oculta (sin desmontarse) mientras hay una ficha abierta ── */}
      <div ref={vistaListaRef} className={`min-h-0 flex-1 flex-col gap-2 ${ficha ? "hidden" : "flex"}`} data-testid="vista-lista">
        {/* UN buscador + qué mirar (con el nº de resultados de cada modo) */}
        <div className="flex shrink-0 flex-col gap-2 md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1" data-tour="facturas-buscar">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Producto, proveedor o documento…"
              aria-label="Buscar en compras"
              className="h-11 border-border/60 bg-background pl-9 pr-11 shadow-sm"
            />
            {texto && (
              <button
                type="button"
                onClick={() => setTexto("")}
                aria-label="Borrar la búsqueda"
                className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div role="group" aria-label="Qué mirar" data-tour="facturas-modos" className="grid shrink-0 grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1">
            {MODOS_COMPRAS.map((m) => (
              <button
                key={m.valor}
                type="button"
                aria-pressed={modo === m.valor}
                onClick={() => cambiarModo(m.valor)}
                className="flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-background aria-pressed:text-primary aria-pressed:shadow-sm min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2 sm:px-4"
              >
                {m.etiqueta}
                <span
                  className="rounded-full bg-primary/10 px-1.5 text-xs font-semibold leading-5 tabular-nums text-primary"
                  aria-label={`${contadores[m.valor]} ${contadores[m.valor] === 1 ? "resultado" : "resultados"}`}
                >
                  {contadores[m.valor]}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Local y periodo (Documentos y Proveedores; Productos tiene sus propios filtros). */}
        {conLocalYPeriodo && (
          <div className={barraChips} data-tour="facturas-local-periodo">
            <div role="group" aria-label="Local" className="flex shrink-0 items-center gap-1">
              <span className="shrink-0 pl-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
                Local
              </span>
              {FILTROS_LOCAL.map((f) => (
                <button key={f.valor} type="button" className={chipClase} aria-pressed={local === f.valor} onClick={() => setLocal(f.valor)}>
                  {f.etiqueta}
                </button>
              ))}
            </div>
            <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />
            <div role="group" aria-label="Periodo" className="flex shrink-0 items-center gap-1">
              <span className="shrink-0 pl-1 text-xs font-medium text-muted-foreground" aria-hidden="true">
                Periodo
              </span>
              {PERIODOS.map((p) => (
                <button
                  key={p.valor}
                  type="button"
                  className={chipClase}
                  aria-pressed={mismoPeriodo(periodo, { tipo: p.valor })}
                  onClick={() => elegirPeriodo({ tipo: p.valor })}
                >
                  {p.etiqueta}
                </button>
              ))}
              {mesElegido && (
                <button
                  type="button"
                  className={chipClase}
                  aria-pressed="true"
                  onClick={() => elegirPeriodo(periodoPrevio)}
                  aria-label={`Solo ${etiquetaMes(mesElegido)}: quitar`}
                >
                  {etiquetaMes(mesElegido)} <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>
        )}

        {conLocalYPeriodo && (
          <ResumenCompras
            datos={resumen}
            meses={meses}
            top={top}
            local={local}
            rango={rango}
            mesElegido={mesElegido}
            periodo={`${textoPeriodo(periodo, hoy)}${local === "todos" ? "" : ` · ${FILTROS_LOCAL.find((f) => f.valor === local)?.etiqueta}`}`}
            parcial={llegandoAnteriores}
            cargando={cargandoDocs}
            onElegirMes={elegirMes}
            onAbrirProveedor={abrirProveedorDelTop}
          />
        )}

        {/* Lista a todo el ancho */}
        <section
          aria-label={`Lista de ${modo}`}
          data-tour="facturas-lista"
          className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden rounded-xl border border-border/50 bg-card px-2 pt-1 shadow-sm"
        >
          {modo === "documentos" && (
            <>
              <div className={barraChips} role="toolbar" aria-label="Filtrar documentos" data-tour="facturas-filtros">
                {FILTROS_DOCUMENTOS.map((f) => (
                  <button key={f.valor} type="button" className={chipClase} aria-pressed={filtroDocs === f.valor} onClick={() => setFiltroDocs(f.valor)}>
                    {f.etiqueta}
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">{cuentaFiltrosDocs[f.valor]}</span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/50" data-testid="lista-documentos">
                {errorDocs ? (
                  <div className="space-y-2 p-4" role="alert">
                    <p className="text-sm text-destructive">Error al cargar los documentos: {(errorDocs as { message?: string }).message}</p>
                    <Button variant="outline" className="h-11 gap-1.5" onClick={reintentar}>
                      <RotateCw className="h-4 w-4" aria-hidden="true" /> Reintentar
                    </Button>
                  </div>
                ) : (
                  <ListaDocumentos
                    documentos={docsVisibles}
                    facturas={facturas}
                    resolver={resolver}
                    avisosPorId={avisosPorId}
                    seleccionadoId={ultimoDoc}
                    cargando={cargandoDocs}
                    hayFiltros={hayTexto || filtroDocs !== "todo" || filtrosActivos}
                    busqueda={hayTexto ? textoDiferido : ""}
                    mesPedido={mesPedido}
                    onAbrir={(id) => abrirFicha({ tipo: "documento", id }, true)}
                  />
                )}
              </div>
              <p className="shrink-0 py-1.5 text-xs text-muted-foreground" aria-live="polite">
                {plural(docsVisibles.length, "documento", "documentos")}
                {llegandoAnteriores && (
                  <span className="ml-1.5" data-testid="cargando-anteriores">
                    · cargando anteriores…
                  </span>
                )}
              </p>
            </>
          )}

          {modo === "productos" && (
            // El buscador es el de arriba; la lista, sus chips de categoría y sus
            // herramientas (categorías, avisos de precio, clasificar) son las de
            // Productos de siempre.
            <TabProductos busqueda={textoDiferido} seleccionadoId={ultimoProducto} onAbrir={(id) => abrirFicha({ tipo: "producto", id }, true)} />
          )}

          {modo === "proveedores" && (
            <>
              <div className={barraChips} role="toolbar" aria-label="Filtrar proveedores">
                {FILTROS_PROVEEDORES.map((f) => (
                  <button key={f.valor} type="button" className={chipClase} aria-pressed={filtroProv === f.valor} onClick={() => setFiltroProv(f.valor)}>
                    {f.etiqueta}
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">
                      {f.valor === "todos" ? provDelTexto.length : conSinFactura.length}
                    </span>
                  </button>
                ))}
                <Button variant="ghost" className="ml-auto h-11 shrink-0 gap-1.5 px-3" onClick={() => setGestionando(true)}>
                  <Truck className="h-4 w-4" aria-hidden="true" /> Gestionar proveedores
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-border/50" data-testid="lista-proveedores">
                <ListaProveedores
                  proveedores={provVisibles}
                  agregados={agregados}
                  abiertoId={provAbierto}
                  cargando={proveedoresQ.isLoading}
                  mensaje={mensajeProveedores}
                  hayFiltros={hayTexto || filtroProv !== "todos" || filtrosActivos}
                  onAlternar={alternarProveedor}
                  despliegue={despliegueProveedor}
                />
              </div>
              <p className="shrink-0 py-1.5 text-xs text-muted-foreground">
                {plural(provVisibles.length, "proveedor", "proveedores")} · por gasto con IVA
                {llegandoAnteriores && <span className="ml-1.5">· cargando anteriores…</span>}
              </p>
            </>
          )}
        </section>
      </div>

      {/* ── FICHA a pantalla completa (dentro de la pestaña) ── */}
      {ficha && (
        <section aria-label="Ficha" data-tour="facturas-ficha" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm">
          <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/40 px-1" data-testid="cabecera-ficha">
            <Button ref={volverRef} variant="ghost" className="h-11 shrink-0 gap-1.5 px-2" onClick={volverALista}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver a la lista
            </Button>
            {origen && (
              <Button variant="ghost" className="h-11 min-w-0 gap-1.5 px-2 text-muted-foreground" onClick={volverAOrigen}>
                <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Volver a «{origen.etiqueta}»</span>
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="ficha-compras">
            <div className="mx-auto max-w-5xl">{contenidoFicha}</div>
          </div>
        </section>
      )}

      <EditarFacturaDialog factura={editando} open={editando !== null} onOpenChange={(abierto) => !abierto && setEditando(null)} />
      {gestionando && <ProveedoresDialog puedeEditar={puedeEditar} onCerrar={() => setGestionando(false)} />}
    </div>
  );
}
