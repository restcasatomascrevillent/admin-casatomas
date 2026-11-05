import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Search, Truck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { invalidarDerivadosCompras, type Factura } from "@/hooks/useFacturas";
import { useBusquedaLineas, useDocumentoCompras, useListaCompras, usePrecargarDocumento } from "@/hooks/useListaCompras";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { productoDeLinea, useCategoriasProducto, useResumenProductos } from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { formatEntero, plural, type MediaPrecioLinea } from "@/components/facturas/shared/formatters";
import { avisosCabecera, avisosFicha, crearResolverDeLista, detalleError, type CabeceraDocumento } from "@/lib/facturas/listaCompras";
import { TabProductos } from "@/components/facturas/productos/TabProductos";
import { ProveedoresDialog } from "@/components/facturas/productos/ProveedoresDialog";
import { EditarFacturaDialog } from "@/components/facturas/EditarFacturaDialog";
import { crearResolverProveedor, type Proveedor } from "@/lib/facturas/proveedores";
import { indexarCategorias, normalizarBusqueda } from "@/lib/facturas/productos";
import {
  FILTROS_DOCUMENTOS,
  FILTROS_PROVEEDORES,
  MODOS_COMPRAS,
  busquedaConFicha,
  contarFiltrosDocumentos,
  coincideDocumento,
  contarPorModo,
  estadoConFichas,
  filtrarDocumentos,
  palabrasBusqueda,
  pilaDeFichas,
  proveedoresDelTexto,
  type FichaCompras,
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
  mismoPeriodo,
  ordenarProveedoresPorGasto,
  pasaLocal,
  pasaPeriodo,
  rangoPeriodo,
  type FiltroLocal,
  type Periodo,
} from "@/lib/facturas/resumenCompras";
import { ListaDocumentos } from "./ListaDocumentos";
import { ListaProveedores } from "./ListaProveedores";
import { FichaDocumento } from "./FichaDocumento";
import { FichaProducto } from "./FichaProducto";
import { FichaProveedor } from "./FichaProveedor";
import { AvisoFranja, BARRA_CHIPS, CHIP, EstadoError, PISTA_SEGMENTOS, SEGMENTO, useDesbordeHorizontal } from "./estilo";

const TODO_EL_PERIODO = { desde: null, hasta: null, tipo: null } as const;
const PERIODO_TODO: Periodo = { tipo: "todo" };

/** La ficha a pantalla completa (documento o producto). */
type Ficha = FichaCompras;

/** Pie de la lista: recuento a la izquierda y la nota de los importes a la derecha. */
const PIE_LISTA = "flex h-9 shrink-0 items-center gap-2 border-t border-border/60 px-3 text-xs text-muted-foreground";

const tipoDocumento = (d: Pick<Factura, "total" | "tipo">) => (esAbono(d) ? "Abono" : d.tipo === "albaran" ? "Albarán" : "Factura");

const mismaFicha = (a: Ficha | null | undefined, b: Ficha | null | undefined) => !!a && !!b && a.tipo === b.tipo && a.id === b.id;

/**
 * «Hoy», que cambia solo al pasar la medianoche o al volver a la pestaña otro
 * día (QA 05/11/2026): con el panel abierto de un día para otro, «Este mes» y
 * los meses desplegados seguían siendo los del día en que se abrió.
 */
function useHoy(): Date {
  const [hoy, setHoy] = useState(() => new Date());
  useEffect(() => {
    const manana = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1).getTime();
    const t = setTimeout(() => setHoy(new Date()), Math.max(manana - Date.now() + 1000, 1000));
    const alVolver = () => {
      if (document.visibilityState !== "visible") return;
      const ahora = new Date();
      if (ahora.toDateString() !== hoy.toDateString()) setHoy(ahora);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [hoy]);
  return hoy;
}

/** Mientras llega la ficha: su cabecera (ya está en la lista) y huecos donde irán las líneas. */
function FichaCargando({ cabecera }: { cabecera: CabeceraDocumento | undefined }) {
  const huecos = Math.min(Math.max(cabecera?.n_lineas ?? 4, 3), 8);
  return (
    <div className="space-y-4 px-4 py-3 sm:px-5" role="status" aria-busy="true" data-testid="ficha-cargando">
      <p className="text-xl font-semibold leading-tight tracking-tight">
        {cabecera ? `${tipoDocumento(cabecera)} ${cabecera.numero_documento}` : "Documento"}
      </p>
      <p className="text-sm text-muted-foreground">Cargando el documento…</p>
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: huecos }, (_, i) => (
          <div key={i} className="h-9 animate-pulse rounded-md bg-muted/60 motion-reduce:animate-none" />
        ))}
      </div>
    </div>
  );
}

/** Mientras el servidor busca en las líneas y aún no hay nada que enseñar (QA C-07: no «Ningún documento coincide»). */
const BuscandoEnLineas = () => (
  <div className="flex flex-col items-center px-6 py-12 text-center" role="status" data-testid="buscando-en-lineas">
    <Loader2 className="mb-3 h-6 w-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden="true" />
    <p className="text-sm font-semibold text-foreground">Buscando en las líneas…</p>
    <p className="mt-1 max-w-sm text-sm text-muted-foreground">Miramos también los productos de cada documento.</p>
  </div>
);

/** Recuento de un chip: «…» mientras no se sabe (QA F11) y con punto de miles (C-18). */
const Cuenta = ({ n }: { n: number | null }) => (
  <span className="text-xs font-normal tabular-nums text-muted-foreground">{n === null ? "…" : formatEntero(n)}</span>
);

/**
 * Facturas › Compras (rediseño a todo el ancho, 05/11/2026): UN buscador, tres
 * formas de mirar lo comprado (Documentos · Productos · Proveedores) con el
 * número de resultados de cada una, el local (Todos · Casa Tomás · Touza) y el
 * periodo y la lista A TODO EL ANCHO. El resumen y las gráficas están en Análisis
 * (decisión del dueño, 05/11/2026: Compras es solo «los documentos, como un Drive mejor»).
 *
 * Al tocar un documento o un producto su ficha ocupa toda la pestaña, con
 * «← Volver a la lista» (que la deja exactamente como estaba: la lista no se
 * desmonta, solo se oculta, y se le devuelve la posición de scroll y el foco)
 * y, si se saltó desde otra ficha, «Volver a …». Cada ficha es una entrada del
 * historial (`?doc=` / `?producto=`, QA C-12): «Atrás» del navegador retrocede
 * una ficha o vuelve a la lista en vez de salir de Facturas. Los proveedores se
 * despliegan en su propia fila (acordeón). Sin scroll de página: solo la lista y
 * la ficha se desplazan por dentro.
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
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const hoy = useHoy();
  const [texto, setTexto] = useState("");
  const textoDiferido = useDeferredValue(texto);
  const [modo, setModo] = useState<ModoCompras>(modoPedido?.modo ?? "documentos");
  // Productos se monta la primera vez que se mira y luego se queda (oculto): sus filtros no se pierden al cambiar de modo.
  const [productosVisto, setProductosVisto] = useState(modo === "productos");
  if (modo === "productos" && !productosVisto) setProductosVisto(true);
  const [filtroDocs, setFiltroDocs] = useState<FiltroDocumentos>("todo");
  const [filtroProv, setFiltroProv] = useState<FiltroProveedores>("todos");
  const [local, setLocal] = useState<FiltroLocal>("todos");
  const [periodo, setPeriodo] = useState<Periodo>(PERIODO_TODO);
  // El preset al que se vuelve al quitar el mes elegido en la gráfica.
  const [periodoPrevio, setPeriodoPrevio] = useState<Periodo>(PERIODO_TODO);
  const [mesPedido, setMesPedido] = useState<{ mes: string; n: number } | null>(null);
  // Lo último abierto en cada lista (se marca con `aria-current` al volver).
  const [ultimoDoc, setUltimoDoc] = useState<number | null>(null);
  const [ultimoProducto, setUltimoProducto] = useState<number | null>(null);
  const [provAbierto, setProvAbierto] = useState<number | null>(null);
  const [editando, setEditando] = useState<Factura | null>(null);
  const [gestionando, setGestionando] = useState(false);
  const [refLocalPeriodo, difLocalPeriodo] = useDesbordeHorizontal();
  const [refChipsDocs, difChipsDocs] = useDesbordeHorizontal();
  const [refChipsProv, difChipsProv] = useDesbordeHorizontal();

  // ── Ficha abierta: la dice el historial (state de la navegación) ──────────
  const pila = useMemo(() => pilaDeFichas(location.state), [location.state]);
  const ficha: Ficha | null = pila.length > 0 ? pila[pila.length - 1] : null;
  const claveFicha = ficha ? `${ficha.tipo}:${ficha.id}` : null;

  const vistaListaRef = useRef<HTMLDivElement>(null);
  const volverRef = useRef<HTMLButtonElement>(null);
  /** Al abrir una ficha: scroll de cada zona de la lista y el elemento con el foco, para devolverlos al volver. */
  const recuerdoLista = useRef<{ scrolls: [Element, number, number][]; foco: HTMLElement | null } | null>(null);
  /** Al pedir ver un proveedor desde una ficha: se lleva a la vista cuando la lista vuelve a verse. */
  const provPorEnsenar = useRef<number | null>(null);

  // ── Datos ─────────────────────────────────────────────────────────────────
  // La lista son solo CABECERAS (`documentos_lista()`: una petición, con avisos,
  // regalado y nº de líneas calculados en el servidor); las líneas llegan al
  // abrir la ficha y la búsqueda por producto la hace el servidor. Productos,
  // categorías y proveedores se piden cuando la lista ya está (no compiten con
  // ella) o en cuanto hacen falta (otro modo o texto buscado).
  const listaQ = useListaCompras();
  const precargar = usePrecargarDocumento();
  const hayTexto = palabrasBusqueda(textoDiferido).length > 0;
  const pedirResto = modo !== "documentos" || hayTexto || listaQ.isError || (listaQ.isSuccess && !listaQ.isFetching);
  const resumenQ = useResumenProductos(TODO_EL_PERIODO, { enabled: pedirResto });
  const categoriasQ = useCategoriasProducto({ enabled: pedirResto });
  const proveedoresQ = useProveedores({ enabled: pedirResto });

  const documentos = useMemo(() => listaQ.data?.cabeceras ?? [], [listaQ.data]);
  // Sin la migración 20261105190000 la lista trae además los documentos completos (la carga de antes).
  const completos = listaQ.data?.completos ?? null;
  const albaranes = useMemo(() => documentos.filter((d) => d.tipo === "albaran"), [documentos]);
  const facturas = useMemo(() => documentos.filter((d) => d.tipo !== "albaran"), [documentos]);
  const docPorId = useMemo(() => new Map(documentos.map((d) => [d.id, d])), [documentos]);
  const productos = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const proveedores = useMemo(() => proveedoresQ.data?.proveedores ?? [], [proveedoresQ.data]);
  const mapaCategorias = useMemo(() => indexarCategorias(categoriasQ.data ?? []), [categoriasQ.data]);
  // El proveedor unificado de cada documento sale de la propia lista (su `proveedor_id`); lo demás, como siempre.
  const resolver = useMemo(() => crearResolverDeLista(documentos, crearResolverProveedor(proveedores)), [documentos, proveedores]);
  // Avisos de cada fila: los guardados y el de precio atípico (calculado en el servidor).
  const avisosPorId = useMemo(() => new Map(documentos.map((d) => [d.id, avisosCabecera(d)])), [documentos]);

  // Han entrado o salido documentos (una subida que termina, un borrado): lo
  // calculado con ellos (productos, gráficas, proveedores) también cambia (QA C-11).
  const firmaLista = useMemo(() => {
    let max = 0;
    let suma = 0;
    for (const d of documentos) {
      if (d.id > max) max = d.id;
      suma += d.id;
    }
    return `${documentos.length}:${max}:${suma}`;
  }, [documentos]);
  const firmaPrevia = useRef<string | null>(null);
  useEffect(() => {
    if (firmaPrevia.current !== null && firmaPrevia.current !== firmaLista && listaQ.data) invalidarDerivadosCompras(qc);
    firmaPrevia.current = firmaLista;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firmaLista]);

  // Búsqueda por producto/línea: ids que casan según el servidor (o, con la
  // carga de antes, según las líneas que ya hay). Se suman a lo que casa en la
  // cabecera (número, proveedor, CIF), que sale al instante.
  const busquedaLineas = useBusquedaLineas(textoDiferido, completos === null && listaQ.isSuccess);
  const casanEnLineas = useMemo(() => {
    if (!completos) return busquedaLineas.ids;
    const palabras = palabrasBusqueda(textoDiferido);
    if (palabras.length === 0) return null;
    return new Set([...completos.values()].filter((d) => coincideDocumento(d, palabras)).map((d) => d.id));
  }, [completos, busquedaLineas.ids, textoDiferido]);
  // Buscando en las líneas (servidor): lo que casa en la cabecera ya está a la vista.
  const buscandoLineas = hayTexto && busquedaLineas.buscando;
  const errorBusqueda = hayTexto && busquedaLineas.error ? busquedaLineas.error : null;

  // ── Local y periodo: afectan a Documentos y Proveedores (el resumen vive en Análisis) ─────────
  const rango = useMemo(() => rangoPeriodo(periodo, hoy), [periodo, hoy]);
  const filtrosActivos = local !== "todos" || rango !== null;
  const docsLocal = useMemo(() => documentos.filter((d) => pasaLocal(d, local)), [documentos, local]);
  const docsBase = useMemo(() => (rango ? docsLocal.filter((d) => pasaPeriodo(d, rango)) : docsLocal), [docsLocal, rango]);
  const agregados = useMemo(() => agregarPorProveedor(docsBase, resolver), [docsBase, resolver]);

  // ── Contadores y listas ───────────────────────────────────────────────────
  const provDelTexto = useMemo(
    () =>
      ordenarProveedoresPorGasto(proveedoresDelTexto(proveedores, docsBase, textoDiferido, resolver, casanEnLineas), agregados, filtrosActivos),
    [proveedores, docsBase, textoDiferido, resolver, agregados, filtrosActivos, casanEnLineas],
  );
  // null = aún no se sabe (su lista no ha llegado o se está buscando en las líneas): el selector enseña «…».
  const contadores = useMemo((): Record<ModoCompras, number | null> => {
    const c = contarPorModo({ texto: textoDiferido, documentos: docsBase, productos, proveedores: [], mapaCategorias, resolver, extra: casanEnLineas });
    return {
      documentos: listaQ.data && !buscandoLineas ? c.documentos : null,
      productos: resumenQ.data ? c.productos : null,
      proveedores: proveedoresQ.data && listaQ.data && !buscandoLineas ? provDelTexto.length : null,
    };
  }, [textoDiferido, docsBase, productos, mapaCategorias, resolver, provDelTexto, casanEnLineas, listaQ.data, resumenQ.data, proveedoresQ.data, buscandoLineas]);
  const cuentaFiltrosDocs = useMemo(
    () => contarFiltrosDocumentos(docsBase, textoDiferido, avisosPorId, casanEnLineas),
    [docsBase, textoDiferido, avisosPorId, casanEnLineas],
  );
  const docsVisibles = useMemo(
    () => filtrarDocumentos(docsBase, textoDiferido, filtroDocs, avisosPorId, casanEnLineas),
    [docsBase, textoDiferido, filtroDocs, avisosPorId, casanEnLineas],
  );
  const conSinFactura = useMemo(
    () => provDelTexto.filter((p) => (agregados.get(`#${p.id}`)?.albaranesSinFactura ?? 0) > 0),
    [provDelTexto, agregados],
  );
  // El proveedor abierto desde una ficha o desde Análisis se ve aunque los filtros lo escondan (rotulado).
  const provFueraDeFiltros = useMemo(() => {
    if (provAbierto === null) return null;
    const lista = filtroProv === "albaranes_sin_factura" ? conSinFactura : provDelTexto;
    return lista.some((p) => p.id === provAbierto) ? null : provAbierto;
  }, [filtroProv, conSinFactura, provDelTexto, provAbierto]);
  const provVisibles = useMemo(() => {
    const lista = filtroProv === "albaranes_sin_factura" ? conSinFactura : provDelTexto;
    if (provFueraDeFiltros !== null) {
      const p = proveedores.find((x) => x.id === provFueraDeFiltros);
      if (p) return [p, ...lista];
    }
    return lista;
  }, [filtroProv, conSinFactura, provDelTexto, provFueraDeFiltros, proveedores]);

  // ── Ficha a pantalla completa ─────────────────────────────────────────────
  const etiquetaFicha = (f: Ficha | null | undefined): string | null => {
    if (!f) return null;
    if (f.tipo === "documento") {
      const d = docPorId.get(f.id);
      return d ? `${tipoDocumento(d).toLowerCase()} ${d.numero_documento}` : null;
    }
    return productos.find((p) => p.producto_id === f.id)?.nombre ?? null;
  };

  /**
   * Abre una ficha: una entrada nueva del historial. Desde la lista
   * (`desdeLista`) se guarda cómo estaba la lista y la pila empieza de nuevo;
   * desde otra ficha, se apila («Volver a …»). `limpiarEnlace`: el enlace
   * profundo (`?doc=` de Cargar) se sustituye antes por la lista, para que
   * «Atrás» vuelva a ella y al recargar no se reabra.
   */
  const abrirFicha = (destino: Ficha, desdeLista: boolean, { limpiarEnlace = false }: { limpiarEnlace?: boolean } = {}) => {
    if (mismaFicha(ficha, destino)) return;
    const empiezaPila = desdeLista || !ficha;
    if (empiezaPila) {
      const raiz = vistaListaRef.current;
      recuerdoLista.current = {
        // Solo las zonas con scroll propio (lista, barras de chips).
        scrolls: raiz
          ? [...raiz.querySelectorAll('[class*="overflow-"]')].filter((el) => el.scrollTop > 0 || el.scrollLeft > 0).map((el) => [el, el.scrollTop, el.scrollLeft] as [Element, number, number])
          : [],
        foco: document.activeElement instanceof HTMLElement && raiz?.contains(document.activeElement) ? document.activeElement : null,
      };
    }
    if (destino.tipo === "documento") setUltimoDoc(destino.id);
    else setUltimoProducto(destino.id);
    if (limpiarEnlace) navigate({ pathname: location.pathname, search: busquedaConFicha(location.search, null) }, { replace: true });
    const nuevaPila = empiezaPila ? [destino] : [...pila, destino];
    // Desde la lista con una ficha ya abierta (no debería pasar): se sustituye, para no dejar fichas huérfanas en el historial.
    navigate(
      { pathname: location.pathname, search: busquedaConFicha(location.search, destino) },
      { state: estadoConFichas(nuevaPila), replace: desdeLista && pila.length > 0 },
    );
  };

  /** Cierra todas las fichas: vuelve en el historial a la entrada de la lista. */
  const volverALista = () => {
    if (pila.length > 0) navigate(-pila.length);
  };
  /** Una ficha atrás («Volver a …» y «Atrás» del navegador). */
  const volverAOrigen = () => {
    if (pila.length > 1) navigate(-1);
  };

  // Al abrir una ficha, el foco va a «Volver a la lista»; al volver, la lista
  // recupera su scroll y el foco vuelve a la fila que se tocó.
  const habiaFicha = useRef(false);
  useLayoutEffect(() => {
    if (claveFicha) {
      volverRef.current?.focus({ preventScroll: true });
    } else if (habiaFicha.current) {
      const r = recuerdoLista.current;
      r?.scrolls.forEach(([el, top, izquierda]) => {
        el.scrollTop = top;
        el.scrollLeft = izquierda;
      });
      // El foco, a la fila que se tocó (en táctil un toque no enfoca: se busca la marcada como abierta).
      const foco = r?.foco?.isConnected ? r.foco : vistaListaRef.current?.querySelector<HTMLElement>('[aria-current="true"]');
      if (provPorEnsenar.current === null) foco?.focus({ preventScroll: true });
      recuerdoLista.current = null;
    }
    habiaFicha.current = claveFicha !== null;
  }, [claveFicha]);

  const abrirDocumento = (id: number) => abrirFicha({ tipo: "documento", id }, false);
  const abrirProducto = (id: number) => abrirFicha({ tipo: "producto", id }, false);
  /**
   * «Qué le compras» de un proveedor (QA C-01): trae el nombre de la LÍNEA, no
   * el del catálogo. Se busca el producto del catálogo con ese nombre; si no,
   * el producto de las líneas que se llaman así (todas tienen `producto_id`);
   * y si aun así no hay, los documentos con ese texto (la búsqueda mira las líneas).
   */
  const abrirProductoPorNombre = async (nombre: string, desdeLista: boolean) => {
    const n = normalizarBusqueda(nombre);
    const exacto = productos.find((x) => normalizarBusqueda(x.nombre) === n);
    if (exacto) {
      abrirFicha({ tipo: "producto", id: exacto.producto_id }, desdeLista);
      return;
    }
    let id: number | null = null;
    try {
      id = await productoDeLinea(nombre);
    } catch {
      id = null;
    }
    if (id !== null) {
      abrirFicha({ tipo: "producto", id }, desdeLista);
      return;
    }
    volverALista();
    setFiltroDocs("todo");
    setModo("documentos");
    setTexto(nombre);
  };

  /** Lleva a Proveedores con ese proveedor desplegado y a la vista. */
  const verProveedor = (id: number) => {
    volverALista();
    setModo("proveedores");
    setFiltroProv("todos");
    if (texto && !provDelTexto.some((x) => x.id === id)) setTexto("");
    setProvAbierto(id);
    provPorEnsenar.current = id;
  };
  const abrirProveedorPorNombre = (nombre: string) => {
    const clave = resolver(nombre).clave;
    const p = proveedores.find((x) => `#${x.id}` === clave);
    if (p) verProveedor(p.id);
  };
  // El proveedor pedido, a la vista en cuanto la lista se ve (si venía de una ficha, al cerrarse).
  useEffect(() => {
    const id = provPorEnsenar.current;
    if (id === null || claveFicha !== null || modo !== "proveedores") return;
    const marco = requestAnimationFrame(() => {
      const fila = vistaListaRef.current?.querySelector(`[data-proveedor-id="${id}"]`);
      const sinMovimiento = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      fila?.scrollIntoView?.({ block: "start", behavior: sinMovimiento ? "auto" : "smooth" });
      provPorEnsenar.current = null;
    });
    return () => cancelAnimationFrame(marco);
  }, [claveFicha, modo, provAbierto, provVisibles]);

  const alternarProveedor = (id: number) => setProvAbierto((actual) => (actual === id ? null : id));

  const elegirPeriodo = (p: Periodo) => {
    setPeriodo(p);
    setMesPedido(null);
  };
  const cambiarModo = (m: ModoCompras) => setModo(m);

  // Cambiar de modo desde fuera (enlace `?tab=productos`, `?modo=`): esa lista.
  // (La ficha la dice el historial: un enlace nuevo ya llega sin ficha.)
  useEffect(() => {
    if (!modoPedido) return;
    setModo(modoPedido.modo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoPedido?.clave, modoPedido?.modo]);

  // Enlace profundo a un documento (`?doc=`): se espera a que haya datos; si no
  // está en la caché (recién subido) se refresca una vez y, si sigue sin estar,
  // se avisa y se queda la lista. Se abre su ficha sin «Volver a …».
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
      abrirFicha({ tipo: "documento", id: docPendiente }, true, { limpiarEnlace: true });
      setDocPendiente(null);
    } else if (!listaQ.isFetching) {
      if (refrescado.current || listaQ.isError) {
        if (!listaQ.isError) toast.error("No se encuentra ese documento", { description: "Puede que se haya borrado. Te dejamos la lista de documentos." });
        setDocPendiente(null);
      } else {
        refrescado.current = true;
        void listaQ.refetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docPendiente, docPorId, listaQ.isFetching]);

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
  // El documento con sus líneas se pide al abrirlo (o antes, al pasar o pulsar su fila).
  const fichaDocQ = useDocumentoCompras(ficha?.tipo === "documento" ? ficha.id : null);
  let contenidoFicha: ReactNode = null;
  if (ficha?.tipo === "documento") {
    const doc = fichaDocQ.data;
    if (fichaDocQ.isPending) {
      contenidoFicha = <FichaCargando cabecera={docPorId.get(ficha.id)} />;
    } else if (fichaDocQ.isError) {
      contenidoFicha = (
        <EstadoError titulo="No se ha podido abrir el documento" detalle={detalleError(fichaDocQ.error)} onReintentar={() => void fichaDocQ.refetch()} />
      );
    } else if (doc) {
      const esAlbaran = doc.tipo === "albaran";
      // La media de referencia de cada línea viene calculada con la ficha.
      const medias = new Map(doc.productos.map((p) => [p.id, p.media_referencia ?? undefined]));
      const mediaPrecio: MediaPrecioLinea = (linea) => medias.get(linea.id);
      contenidoFicha = (
        <FichaDocumento
          doc={doc}
          avisos={avisosFicha(doc)}
          mediaPrecio={mediaPrecio}
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

  // Lista de documentos: sin datos y con error → error a pantalla completa; con
  // datos (la copia del dispositivo) y un refresco fallido → franja (QA C-03).
  const sinDatosDocs = !listaQ.data;
  const errorDocsSinDatos = listaQ.isError && sinDatosDocs;
  const errorDocsConDatos = listaQ.isError && !sinDatosDocs;
  const cargandoDocs = listaQ.isPending;
  const reintentar = () => void listaQ.refetch();
  const conLocalYPeriodo = modo !== "productos";
  const mesElegido = periodo.tipo === "mes" ? periodo.mes : null;
  const cargandoProveedores = (!proveedoresQ.data && !proveedoresQ.isError) || (cargandoDocs && !listaQ.isError);
  // Sin la lista de proveedores o sin la de documentos no hay recuento que dar («…» y «Sin datos», no «0»).
  const sinDatosProveedores = !proveedoresQ.data || sinDatosDocs;
  const firmaFiltros =
    filtroDocs !== "todo" || filtrosActivos ? `${filtroDocs}|${local}|${periodo.tipo}|${periodo.tipo === "mes" ? periodo.mes : ""}` : "";

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
      hoy={hoy}
      onAbrirDocumento={(id) => abrirFicha({ tipo: "documento", id }, true)}
      onPrecargarDocumento={precargar}
      onAbrirProducto={(nombre) => void abrirProductoPorNombre(nombre, true)}
    />
  );

  const quitarFiltrosDocs = () => {
    setTexto("");
    setFiltroDocs("todo");
    setLocal("todos");
    elegirPeriodo(PERIODO_TODO);
  };
  const quitarFiltrosProv = () => {
    setTexto("");
    setFiltroProv("todos");
    setLocal("todos");
    elegirPeriodo(PERIODO_TODO);
  };

  // Franjas de aviso de la lista (Documentos y Proveedores): lo de abajo se sigue viendo.
  const franjas = (
    <>
      {errorDocsConDatos && (
        <AvisoFranja testId="aviso-refresco" detalle={detalleError(listaQ.error)} onReintentar={reintentar}>
          No se ha podido actualizar la lista: ves la última copia guardada.
        </AvisoFranja>
      )}
      {errorBusqueda !== null && (
        <AvisoFranja testId="aviso-busqueda" detalle={detalleError(errorBusqueda)} onReintentar={busquedaLineas.reintentar}>
          No se ha podido buscar dentro de las líneas: solo salen los que coinciden por número, proveedor o CIF.
        </AvisoFranja>
      )}
    </>
  );

  const origenEtiqueta = pila.length > 1 ? (etiquetaFicha(pila[pila.length - 2]) ?? (pila[pila.length - 2].tipo === "documento" ? "el documento" : "el producto")) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tab-compras">
      {/* ── LISTA: se oculta (sin desmontarse) mientras hay una ficha abierta ── */}
      <div ref={vistaListaRef} className={`min-h-0 flex-1 flex-col gap-2 ${ficha ? "hidden" : "flex"}`} data-testid="vista-lista">
        {/* Barra superior: UN buscador + qué mirar (con el nº de resultados de cada modo).
            Por debajo de 1024 px (tablet en vertical) el buscador va a todo el ancho y los modos debajo (QA M5). */}
        <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 lg:flex-1" data-tour="facturas-buscar">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Producto, proveedor o documento…"
              aria-label="Buscar en compras"
              className="h-12 rounded-lg border-border/80 bg-background pl-10 pr-11 text-base md:text-sm [&::-webkit-search-cancel-button]:hidden"
            />
            {texto && (
              <button
                type="button"
                onClick={() => setTexto("")}
                aria-label="Borrar la búsqueda"
                className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div role="group" aria-label="Qué mirar" data-tour="facturas-modos" className="grid shrink-0 grid-cols-3 gap-0.5 rounded-lg bg-muted/45 p-0.5">
            {MODOS_COMPRAS.map((m) => (
              <button
                key={m.valor}
                type="button"
                aria-pressed={modo === m.valor}
                onClick={() => cambiarModo(m.valor)}
                className="group/modo flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm motion-reduce:transition-none min-[420px]:flex-row min-[420px]:gap-1.5 min-[420px]:px-2 sm:px-4"
              >
                {m.etiqueta}
                <span
                  className="min-w-6 rounded-full bg-foreground/[0.07] px-1.5 text-center text-xs font-semibold leading-5 tabular-nums text-muted-foreground group-aria-pressed/modo:bg-primary group-aria-pressed/modo:text-primary-foreground"
                  aria-label={contadores[m.valor] === null ? "contando" : `${formatEntero(contadores[m.valor] as number)} ${contadores[m.valor] === 1 ? "resultado" : "resultados"}`}
                >
                  {contadores[m.valor] === null ? "…" : formatEntero(contadores[m.valor] as number)}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Local y periodo (Documentos y Proveedores; Productos tiene sus propios filtros): dos controles segmentados. */}
        {conLocalYPeriodo && (
          <div
            ref={refLocalPeriodo}
            className={`flex h-11 shrink-0 items-center gap-x-4 overflow-x-auto overscroll-x-contain pr-6 no-scrollbar ${difLocalPeriodo}`}
            data-tour="facturas-local-periodo"
          >
            <div role="group" aria-label="Local" className="flex shrink-0 items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground" aria-hidden="true">
                Local
              </span>
              <span className={PISTA_SEGMENTOS}>
                {FILTROS_LOCAL.map((f) => (
                  <button key={f.valor} type="button" className={SEGMENTO} aria-pressed={local === f.valor} onClick={() => setLocal(f.valor)}>
                    {f.etiqueta}
                  </button>
                ))}
              </span>
            </div>
            <div role="group" aria-label="Periodo" className="flex shrink-0 items-center gap-2">
              <span className="shrink-0 text-xs font-medium text-muted-foreground" aria-hidden="true">
                Periodo
              </span>
              <span className={PISTA_SEGMENTOS}>
                {PERIODOS.map((p) => (
                  <button
                    key={p.valor}
                    type="button"
                    className={SEGMENTO}
                    aria-pressed={mismoPeriodo(periodo, { tipo: p.valor })}
                    onClick={() => elegirPeriodo({ tipo: p.valor })}
                  >
                    {p.etiqueta}
                  </button>
                ))}
                {mesElegido && (
                  <button
                    type="button"
                    className={SEGMENTO}
                    aria-pressed="true"
                    onClick={() => elegirPeriodo(periodoPrevio)}
                    aria-label={`Solo ${etiquetaMes(mesElegido)}: quitar`}
                  >
                    {etiquetaMes(mesElegido)} <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </span>
            </div>
          </div>
        )}

        {/* El explorador: filtros del modo, lista a todo el ancho y pie con el recuento. */}
        <section
          aria-label={`Lista de ${modo}`}
          data-tour="facturas-lista"
          className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card"
        >
          {modo === "documentos" && (
            <>
              <div
                ref={refChipsDocs}
                className={`${BARRA_CHIPS} border-b border-border/60 px-2 pr-6 ${difChipsDocs}`}
                role="toolbar"
                aria-label="Filtrar documentos"
                data-tour="facturas-filtros"
              >
                {FILTROS_DOCUMENTOS.map((f) => (
                  <button key={f.valor} type="button" className={CHIP} aria-pressed={filtroDocs === f.valor} onClick={() => setFiltroDocs(f.valor)}>
                    {f.etiqueta}
                    <Cuenta n={sinDatosDocs || buscandoLineas ? null : cuentaFiltrosDocs[f.valor]} />
                  </button>
                ))}
              </div>
              {franjas}
              {/* `relative`: lo posicionado por dentro (textos solo para lector de pantalla) no estira la página. */}
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="lista-documentos">
                {errorDocsSinDatos ? (
                  <EstadoError titulo="No se han podido cargar los documentos" detalle={detalleError(listaQ.error)} onReintentar={reintentar} />
                ) : buscandoLineas && docsVisibles.length === 0 ? (
                  <BuscandoEnLineas />
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
                    filtros={firmaFiltros}
                    hoy={hoy}
                    mesPedido={mesPedido}
                    onAbrir={(id) => abrirFicha({ tipo: "documento", id }, true)}
                    onPrecargar={precargar}
                    onQuitarFiltros={quitarFiltrosDocs}
                  />
                )}
              </div>
              <p className={PIE_LISTA} aria-live="polite">
                {errorDocsSinDatos ? "Sin datos" : cargandoDocs ? "Cargando…" : plural(docsVisibles.length, "documento", "documentos")}
                {buscandoLineas && (
                  <span className="ml-1.5" data-testid="buscando-lineas">
                    · buscando en las líneas…
                  </span>
                )}
                <span className="ml-auto">importes con IVA</span>
              </p>
            </>
          )}

          {/* Productos: el buscador es el de arriba; la lista, sus chips de categoría y sus
              herramientas son las de Productos de siempre. Se queda montado (oculto) al
              cambiar de modo: sus filtros no se pierden. */}
          {productosVisto && (
            <div className={modo === "productos" ? "flex min-h-0 flex-1 flex-col" : "hidden"} data-testid="modo-productos">
              <TabProductos busqueda={textoDiferido} seleccionadoId={ultimoProducto} onAbrir={(id) => abrirFicha({ tipo: "producto", id }, true)} />
            </div>
          )}

          {modo === "proveedores" && (
            <>
              <div ref={refChipsProv} className={`${BARRA_CHIPS} border-b border-border/60 px-2 ${difChipsProv}`} role="toolbar" aria-label="Filtrar proveedores">
                {FILTROS_PROVEEDORES.map((f) => (
                  <button key={f.valor} type="button" className={CHIP} aria-pressed={filtroProv === f.valor} onClick={() => setFiltroProv(f.valor)}>
                    {f.etiqueta}
                    <Cuenta n={sinDatosProveedores || buscandoLineas ? null : f.valor === "todos" ? provDelTexto.length : conSinFactura.length} />
                  </button>
                ))}
                <Button variant="ghost" className="ml-auto h-11 shrink-0 gap-1.5 px-3 text-sm" onClick={() => setGestionando(true)}>
                  <Truck className="h-4 w-4" aria-hidden="true" /> Gestionar proveedores
                </Button>
              </div>
              {franjas}
              <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="lista-proveedores">
                {/* Sin la lista de documentos no hay importes: ni «0 €» ni lista a medias (QA C-08). */}
                {errorDocsSinDatos ? (
                  <EstadoError titulo="No se han podido cargar los importes de los proveedores" detalle={detalleError(listaQ.error)} onReintentar={reintentar} />
                ) : proveedoresQ.isError && !proveedoresQ.data ? (
                  <EstadoError
                    titulo="No se han podido cargar los proveedores"
                    detalle={detalleError(proveedoresQ.error)}
                    onReintentar={() => void proveedoresQ.refetch()}
                  />
                ) : buscandoLineas && provVisibles.length === 0 ? (
                  <BuscandoEnLineas />
                ) : (
                  <ListaProveedores
                    proveedores={provVisibles}
                    agregados={agregados}
                    abiertoId={provAbierto}
                    cargando={cargandoProveedores}
                    mensaje={
                      proveedoresQ.data?.faltaMigracion
                        ? "La lista de proveedores unificados aún no está activada: falta aplicar la migración 20261007180000_proveedores_unificados."
                        : null
                    }
                    hayFiltros={hayTexto || filtroProv !== "todos" || filtrosActivos}
                    onAlternar={alternarProveedor}
                    despliegue={despliegueProveedor}
                    onQuitarFiltros={quitarFiltrosProv}
                    fueraDeFiltros={provFueraDeFiltros}
                  />
                )}
              </div>
              <p className={PIE_LISTA}>
                {cargandoProveedores
                  ? "Cargando…"
                  : sinDatosProveedores
                    ? "Sin datos"
                    : `${plural(provVisibles.length, "proveedor", "proveedores")} · por gasto con IVA`}
                {buscandoLineas && <span className="ml-1.5">· buscando en las líneas…</span>}
              </p>
            </>
          )}
        </section>
      </div>

      {/* ── FICHA a pantalla completa (dentro de la pestaña) ── */}
      {ficha && (
        <section aria-label="Ficha" data-tour="facturas-ficha" className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/70 bg-card">
          <div className="flex h-12 shrink-0 items-center gap-1 overflow-hidden border-b border-border/60 px-1.5" data-testid="cabecera-ficha">
            <Button ref={volverRef} variant="ghost" className="h-11 shrink-0 gap-1.5 px-2.5 text-sm font-medium" onClick={volverALista}>
              <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Volver a la lista
            </Button>
            {origenEtiqueta && (
              <>
                <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
                <Button variant="ghost" className="h-11 min-w-0 gap-1.5 px-2.5 text-sm text-muted-foreground" onClick={volverAOrigen}>
                  <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">Volver a «{origenEtiqueta}»</span>
                </Button>
                {pila.length > 2 && (
                  <span className="shrink-0 pr-1 text-xs tabular-nums text-muted-foreground" aria-label={`${pila.length - 1} fichas atrás`}>
                    +{pila.length - 2}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="ficha-compras">
            {/* El documento usa todo el ancho (su original va al lado); el producto, una columna cómoda. */}
            <div className={ficha.tipo === "documento" ? "h-full" : "mx-auto max-w-5xl"}>{contenidoFicha}</div>
          </div>
        </section>
      )}

      <EditarFacturaDialog factura={editando} open={editando !== null} onOpenChange={(abierto) => !abierto && setEditando(null)} />
      {gestionando && <ProveedoresDialog puedeEditar={puedeEditar} onCerrar={() => setGestionando(false)} />}
    </div>
  );
}
