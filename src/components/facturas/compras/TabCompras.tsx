import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Search, Truck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAlbaranes, useFacturas, type Factura } from "@/hooks/useFacturas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useCategoriasProducto, useResumenProductos } from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { avisosDocumento } from "@/components/facturas/shared/formatters";
import { TabProductos } from "@/components/facturas/productos/TabProductos";
import { ProveedoresDialog } from "@/components/facturas/productos/ProveedoresDialog";
import { EditarFacturaDialog } from "@/components/facturas/EditarFacturaDialog";
import { crearResolverProveedor } from "@/lib/facturas/proveedores";
import { indexarCategorias, normalizarBusqueda } from "@/lib/facturas/productos";
import {
  FILTROS_DOCUMENTOS,
  FILTROS_PROVEEDORES,
  MODOS_COMPRAS,
  albaranesSinFacturaPorProveedor,
  coincideDocumento,
  contarFiltrosDocumentos,
  contarPorModo,
  documentosDeProveedor,
  filtrarDocumentos,
  filtrarProveedoresCompras,
  palabrasBusqueda,
  type FiltroDocumentos,
  type FiltroProveedores,
  type ModoCompras,
} from "@/lib/facturas/compras";
import { ListaDocumentos } from "./ListaDocumentos";
import { ListaProveedores } from "./ListaProveedores";
import { FichaDocumento } from "./FichaDocumento";
import { FichaProducto } from "./FichaProducto";
import { FichaProveedor } from "./FichaProveedor";

const TODO_EL_PERIODO = { desde: null, hasta: null, tipo: null } as const;
const SIN_AVISOS: unknown[] = [];

interface Seleccion {
  documentos: number | null;
  productos: number | null;
  proveedores: number | null;
}

/** De dónde se saltó a la ficha actual, para poder volver con un toque. */
interface Origen {
  modo: ModoCompras;
  id: number;
  etiqueta: string;
}

const chipClase =
  "inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-muted/50 aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:text-foreground";

/**
 * Facturas › Compras (rediseño del 08/10/2026): UN buscador, tres formas de
 * mirar lo comprado (Documentos · Productos · Proveedores) con el número de
 * resultados de cada una para el texto buscado, filtros en chips según el modo,
 * una lista compacta a la izquierda y la ficha a la derecha. En pantallas
 * estrechas (tablet en vertical) la ficha es un panel que se pone encima de la
 * lista. Sin scroll de página: solo la lista y la ficha se desplazan.
 */
export function TabCompras({
  onPreguntarIA,
  modoPedido,
}: {
  onPreguntarIA?: (doc: Factura, tipo: "factura" | "albarán") => void;
  /** Abre Compras en ese modo (cada `clave` nueva vuelve a aplicarlo). Sin esto, Documentos. */
  modoPedido?: { modo: ModoCompras; clave: string };
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const [texto, setTexto] = useState("");
  const textoDiferido = useDeferredValue(texto);
  const [modo, setModo] = useState<ModoCompras>(modoPedido?.modo ?? "documentos");
  useEffect(() => {
    if (modoPedido) setModo(modoPedido.modo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoPedido?.clave, modoPedido?.modo]);
  const [filtroDocs, setFiltroDocs] = useState<FiltroDocumentos>("todo");
  const [filtroProv, setFiltroProv] = useState<FiltroProveedores>("todos");
  const [seleccion, setSeleccion] = useState<Seleccion>({ documentos: null, productos: null, proveedores: null });
  const [origen, setOrigen] = useState<Origen | null>(null);
  const [editando, setEditando] = useState<Factura | null>(null);
  const [gestionando, setGestionando] = useState(false);

  // ── Datos (react-query comparte la caché con las demás pantallas) ─────────
  const facturasQ = useFacturas();
  const albaranesQ = useAlbaranes();
  const resumenQ = useResumenProductos(TODO_EL_PERIODO);
  const categoriasQ = useCategoriasProducto();
  const proveedoresQ = useProveedores();

  const facturas = useMemo(() => facturasQ.data ?? [], [facturasQ.data]);
  const albaranes = useMemo(() => albaranesQ.data ?? [], [albaranesQ.data]);
  const documentos = useMemo(() => [...facturas, ...albaranes], [facturas, albaranes]);
  const productos = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const proveedores = useMemo(() => proveedoresQ.data?.proveedores ?? [], [proveedoresQ.data]);
  const mapaCategorias = useMemo(() => indexarCategorias(categoriasQ.data ?? []), [categoriasQ.data]);
  const resolver = useMemo(() => crearResolverProveedor(proveedores), [proveedores]);

  // Los avisos se calculan una vez por documento y contra los de su mismo tipo
  // (`avisosDocumento` recorre todos los productos: dentro del render de cada
  // fila sería cuadrático).
  const avisosPorId = useMemo(() => {
    const mapa = new Map<number, ReturnType<typeof avisosDocumento>>();
    facturas.forEach((f) => mapa.set(f.id, avisosDocumento(f, facturas)));
    albaranes.forEach((a) => mapa.set(a.id, avisosDocumento(a, albaranes)));
    return mapa;
  }, [facturas, albaranes]);

  // ── Contadores y listas ───────────────────────────────────────────────────
  const contadores = useMemo(
    () => contarPorModo({ texto: textoDiferido, documentos, productos, proveedores, mapaCategorias, resolver }),
    [textoDiferido, documentos, productos, proveedores, mapaCategorias, resolver],
  );
  const cuentaFiltrosDocs = useMemo(
    () => contarFiltrosDocumentos(documentos, textoDiferido, avisosPorId),
    [documentos, textoDiferido, avisosPorId],
  );
  const docsVisibles = useMemo(
    () => filtrarDocumentos(documentos, textoDiferido, filtroDocs, avisosPorId),
    [documentos, textoDiferido, filtroDocs, avisosPorId],
  );
  const sinFacturaPorClave = useMemo(() => albaranesSinFacturaPorProveedor(documentos, resolver), [documentos, resolver]);
  const provVisibles = useMemo(
    () => filtrarProveedoresCompras(proveedores, documentos, textoDiferido, filtroProv, resolver),
    [proveedores, documentos, textoDiferido, filtroProv, resolver],
  );
  const conAlbaranesSinFactura = useMemo(
    () => proveedores.filter((p) => (sinFacturaPorClave.get(`#${p.id}`) ?? 0) > 0).length,
    [proveedores, sinFacturaPorClave],
  );

  // ── Selección y saltos entre fichas ───────────────────────────────────────
  const docSeleccionado = documentos.find((d) => d.id === seleccion.documentos) ?? null;
  const provSeleccionado = proveedores.find((p) => p.id === seleccion.proveedores) ?? null;
  const productoSeleccionado = productos.find((p) => p.producto_id === seleccion.productos) ?? null;

  const etiquetaActual = (): Origen | null => {
    const id = seleccion[modo];
    if (id === null) return null;
    if (modo === "documentos") return docSeleccionado ? { modo, id, etiqueta: `${docSeleccionado.tipo === "albaran" ? "albarán" : "factura"} ${docSeleccionado.numero_documento}` } : null;
    if (modo === "productos") return productoSeleccionado ? { modo, id, etiqueta: productoSeleccionado.nombre } : null;
    return provSeleccionado ? { modo, id, etiqueta: provSeleccionado.nombre } : null;
  };

  /** Salta a otra ficha recordando de dónde vienes («Volver a …»). */
  const saltar = (destino: ModoCompras, id: number, parche?: () => void) => {
    const desde = etiquetaActual();
    setOrigen(desde && !(desde.modo === destino && desde.id === id) ? desde : null);
    setModo(destino);
    setSeleccion((s) => ({ ...s, [destino]: id }));
    parche?.();
  };

  const abrirDocumento = (id: number) => {
    const doc = documentos.find((d) => d.id === id);
    saltar("documentos", id, () => {
      setFiltroDocs("todo");
      // Si el texto buscado no encuentra ese documento, se quita para verlo en la lista.
      if (doc && !coincideDocumento(doc, palabrasBusqueda(texto))) setTexto("");
    });
  };
  const abrirProducto = (id: number) => {
    const p = productos.find((x) => x.producto_id === id);
    saltar("productos", id, () => {
      if (p && texto && !normalizarBusqueda(p.nombre).includes(normalizarBusqueda(texto))) setTexto("");
    });
  };
  const abrirProductoPorNombre = (nombre: string) => {
    const n = normalizarBusqueda(nombre);
    const p = productos.find((x) => normalizarBusqueda(x.nombre) === n);
    if (p) abrirProducto(p.producto_id);
    else {
      // No está en el catálogo con ese nombre exacto: se busca en la lista.
      setOrigen(null);
      setTexto(nombre);
      setModo("productos");
    }
  };
  const abrirProveedorPorNombre = (nombre: string) => {
    const clave = resolver(nombre).clave;
    const p = proveedores.find((x) => `#${x.id}` === clave);
    if (p) saltar("proveedores", p.id);
  };
  const volver = () => {
    if (!origen) return;
    setModo(origen.modo);
    setSeleccion((s) => ({ ...s, [origen.modo]: origen.id }));
    setOrigen(null);
  };
  const cerrarFicha = () => {
    setSeleccion((s) => ({ ...s, [modo]: null }));
    setOrigen(null);
  };
  const cambiarModo = (m: ModoCompras) => {
    setModo(m);
    setOrigen(null);
    // Cada modo empieza sin ficha abierta (en pantallas estrechas la ficha tapa la lista).
    setSeleccion((s) => ({ ...s, [m]: null }));
  };

  // ── Ficha de la derecha ───────────────────────────────────────────────────
  let ficha: ReactNode = null;
  if (modo === "documentos" && docSeleccionado) {
    const esAlbaran = docSeleccionado.tipo === "albaran";
    ficha = (
      <FichaDocumento
        doc={docSeleccionado}
        avisos={(avisosPorId.get(docSeleccionado.id) ?? SIN_AVISOS) as ReturnType<typeof avisosDocumento>}
        mismoTipo={esAlbaran ? albaranes : facturas}
        facturaDelAlbaran={esAlbaran && docSeleccionado.facturado_en_id != null ? (facturas.find((f) => f.id === docSeleccionado.facturado_en_id) ?? null) : null}
        albaranesDeLaFactura={esAlbaran ? [] : albaranes.filter((a) => a.facturado_en_id === docSeleccionado.id)}
        onEditar={setEditando}
        onPreguntarIA={onPreguntarIA ? (d) => onPreguntarIA(d, d.tipo === "albaran" ? "albarán" : "factura") : undefined}
        onAbrirProducto={abrirProducto}
        onAbrirProveedor={abrirProveedorPorNombre}
        onAbrirDocumento={abrirDocumento}
      />
    );
  } else if (modo === "productos" && seleccion.productos !== null) {
    ficha = <FichaProducto productoId={seleccion.productos} onAbrirDocumento={abrirDocumento} />;
  } else if (modo === "proveedores" && provSeleccionado) {
    ficha = (
      <FichaProveedor
        proveedor={provSeleccionado}
        documentos={documentosDeProveedor(documentos, provSeleccionado, resolver)}
        puedeEditar={puedeEditar}
        onAbrirDocumento={abrirDocumento}
        onAbrirProducto={abrirProductoPorNombre}
      />
    );
  }
  const hayFicha = ficha !== null;
  const vacioFicha: Record<ModoCompras, string> = {
    documentos: "Elige una factura o un albarán para ver sus líneas.",
    productos: "Elige un producto para ver cómo ha cambiado su precio y en qué documentos aparece.",
    proveedores: "Elige un proveedor para ver qué le compras y cada cuánto.",
  };

  const hayTexto = palabrasBusqueda(textoDiferido).length > 0;
  const errorDocs = facturasQ.error ?? albaranesQ.error;
  const mensajeProveedores = proveedoresQ.data?.faltaMigracion
    ? "La lista de proveedores unificados aún no está activada: falta aplicar la migración 20261007180000_proveedores_unificados."
    : proveedoresQ.error
      ? ((proveedoresQ.error as { message?: string }).message ?? "No se han podido cargar los proveedores")
      : null;

  const cuenta = (m: ModoCompras) => contadores[m];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-testid="tab-compras">
      {/* UN buscador + qué mirar (con el nº de resultados de cada modo) */}
      <div className="flex shrink-0 flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Busca un producto, un proveedor o un documento…"
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
        <div role="group" aria-label="Qué mirar" className="grid shrink-0 grid-cols-3 gap-1 rounded-lg bg-muted/40 p-1">
          {MODOS_COMPRAS.map((m) => (
            <button
              key={m.valor}
              type="button"
              aria-pressed={modo === m.valor}
              onClick={() => cambiarModo(m.valor)}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-background aria-pressed:text-primary aria-pressed:shadow-sm sm:px-4"
            >
              {m.etiqueta}
              <span
                className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold leading-5 tabular-nums text-primary"
                aria-label={`${cuenta(m.valor)} ${cuenta(m.valor) === 1 ? "resultado" : "resultados"}`}
              >
                {cuenta(m.valor)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 lg:grid lg:grid-cols-[minmax(21rem,26rem)_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] lg:gap-3">
        {/* Lista compacta (izquierda) */}
        <section
          aria-label={`Lista de ${modo}`}
          className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-border/50 bg-card p-2 shadow-sm"
        >
          {modo === "documentos" && (
            <>
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 no-scrollbar" role="toolbar" aria-label="Filtrar documentos">
                {FILTROS_DOCUMENTOS.map((f) => (
                  <button key={f.valor} type="button" className={chipClase} aria-pressed={filtroDocs === f.valor} onClick={() => setFiltroDocs(f.valor)}>
                    {f.etiqueta}
                    <span className="text-xs tabular-nums text-muted-foreground">{cuentaFiltrosDocs[f.valor]}</span>
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border" data-testid="lista-documentos">
                {errorDocs ? (
                  <p className="p-4 text-sm text-destructive">Error al cargar los documentos: {(errorDocs as { message?: string }).message}</p>
                ) : (
                  <ListaDocumentos
                    documentos={docsVisibles}
                    avisosPorId={avisosPorId}
                    seleccionadoId={seleccion.documentos}
                    cargando={facturasQ.isLoading || albaranesQ.isLoading}
                    hayFiltros={hayTexto || filtroDocs !== "todo"}
                    onAbrir={(id) => {
                      setOrigen(null);
                      setSeleccion((s) => ({ ...s, documentos: id }));
                    }}
                  />
                )}
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">{docsVisibles.length} documento(s)</p>
            </>
          )}

          {modo === "productos" && (
            // El buscador es el de arriba; la lista, sus chips de categoría y sus
            // herramientas (categorías, avisos de precio, clasificar) son las de
            // Productos de siempre.
            <TabProductos
              busqueda={textoDiferido}
              seleccionadoId={seleccion.productos}
              onAbrir={(id) => {
                setOrigen(null);
                setSeleccion((s) => ({ ...s, productos: id }));
              }}
            />
          )}

          {modo === "proveedores" && (
            <>
              <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 no-scrollbar" role="toolbar" aria-label="Filtrar proveedores">
                {FILTROS_PROVEEDORES.map((f) => (
                  <button key={f.valor} type="button" className={chipClase} aria-pressed={filtroProv === f.valor} onClick={() => setFiltroProv(f.valor)}>
                    {f.etiqueta}
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {f.valor === "todos" ? contadores.proveedores : conAlbaranesSinFactura}
                    </span>
                  </button>
                ))}
                <Button variant="outline" className="h-11 shrink-0 gap-1.5" onClick={() => setGestionando(true)}>
                  <Truck className="h-4 w-4" aria-hidden="true" /> Gestionar
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-lg border" data-testid="lista-proveedores">
                <ListaProveedores
                  proveedores={provVisibles}
                  sinFacturaPorClave={sinFacturaPorClave}
                  seleccionadoId={seleccion.proveedores}
                  cargando={proveedoresQ.isLoading}
                  mensaje={mensajeProveedores}
                  hayFiltros={hayTexto || filtroProv !== "todos"}
                  onAbrir={(id) => {
                    setOrigen(null);
                    setSeleccion((s) => ({ ...s, proveedores: id }));
                  }}
                />
              </div>
              <p className="shrink-0 text-xs text-muted-foreground">{provVisibles.length} proveedor(es)</p>
            </>
          )}
        </section>

        {/* Ficha (derecha; en pantallas estrechas, un panel encima de la lista) */}
        <aside
          aria-label="Ficha"
          className={`min-h-0 flex-col overflow-hidden rounded-xl border border-border/50 bg-card shadow-sm max-lg:absolute max-lg:inset-0 max-lg:z-20 ${
            hayFicha ? "flex" : "hidden lg:flex"
          }`}
        >
          {hayFicha ? (
            <>
              <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1">
                <Button variant="ghost" className="h-11 gap-1.5 px-2 lg:hidden" onClick={cerrarFicha}>
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Lista
                </Button>
                {origen && (
                  <Button variant="ghost" className="h-11 min-w-0 gap-1.5 px-2" onClick={volver}>
                    <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">Volver a «{origen.etiqueta}»</span>
                  </Button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-testid="ficha-compras">
                {ficha}
              </div>
            </>
          ) : (
            <p className="m-auto max-w-xs p-6 text-center text-sm text-muted-foreground">{vacioFicha[modo]}</p>
          )}
        </aside>
      </div>

      <EditarFacturaDialog factura={editando} open={editando !== null} onOpenChange={(abierto) => !abierto && setEditando(null)} />
      {gestionando && <ProveedoresDialog puedeEditar={puedeEditar} onCerrar={() => setGestionando(false)} />}
    </div>
  );
}
