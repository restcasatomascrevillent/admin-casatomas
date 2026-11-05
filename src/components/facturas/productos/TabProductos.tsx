import { useMemo, useState } from "react";
import { FolderTree, Merge, Search, SlidersHorizontal, Sparkles, Truck, TrendingUp, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency, formatDateCorta, plural } from "@/components/facturas/shared/formatters";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  useCategoriasProducto,
  useClasificarConIA,
  useGastoCategorias,
  useRecategorizarProductos,
  useResumenProductos,
} from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { useProductosConSubida } from "@/hooks/useCompras";
import { crearResolverProveedor, type ResolverProveedor } from "@/lib/facturas/proveedores";
import {
  ETIQUETAS_PERIODO,
  faltaMigracionCatalogo,
  filtrarProductos,
  formatCantidades,
  indexarCategorias,
  nombresProveedores,
  normalizarBusqueda,
  proveedoresDe,
  rangoPeriodo,
  rutaCategoria,
  totalesPorRaiz,
  type FiltroCategoria,
  type Periodo,
  type ResumenProducto,
} from "@/lib/facturas/productos";
import { DetalleProductoDialog } from "./DetalleProductoDialog";
import { FusionarDialog } from "./FusionarDialog";
import { CategoriasDialog } from "./CategoriasDialog";
import { LineasSinClasificar } from "./LineasSinClasificar";
import { ProveedoresDialog } from "./ProveedoresDialog";
import { SelectorCategoria } from "./SelectorCategoria";
import { AvisosPrecio } from "./AvisosPrecio";

type Orden = "gasto" | "compras" | "nombre";
const TODOS = "__todos";
// Columnas de la lista en pantallas anchas (≥ 1024 px; en tablet vertical, nombre entero y datos debajo): casilla · producto · compras · cantidad · gasto · último precio.
const COLUMNAS = "lg:grid-cols-[2.75rem_minmax(0,2.2fr)_5.5rem_minmax(0,1.2fr)_7rem_6.5rem]";

export interface TabProductosProps {
  /**
   * Compras (08/10/2026): el texto viene del buscador único de arriba. Si se
   * pasa, esta pantalla no pinta su propio buscador.
   */
  busqueda?: string;
  /**
   * Compras: al tocar un producto se avisa aquí (la ficha vive en el panel de
   * la derecha) en lugar de abrir el diálogo. Su presencia pone la lista en
   * modo compacto: una sola columna, filtros recogidos en un desplegable.
   */
  onAbrir?: (productoId: number) => void;
  /** Producto abierto en la ficha (se resalta en la lista). */
  seleccionadoId?: number | null;
}

/**
 * Facturas › Productos (encargo del dueño, 07/10/2026): el catálogo de
 * productos canónicos con su categoría, cuánto se ha comprado y gastado, y las
 * correcciones (categoría, nombre, fusionar duplicados, mover líneas). Ocupa el
 * alto de la pestaña y solo la lista hace scroll por dentro.
 *
 * Desde el rediseño de Compras (08/10/2026) es la lista del modo «Productos»:
 * el buscador es el de Compras y la ficha del producto se abre a la derecha.
 */
export function TabProductos({ busqueda: busquedaExterna, onAbrir, seleccionadoId = null }: TabProductosProps = {}) {
  const compacto = onAbrir !== undefined;
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const [busquedaPropia, setBusquedaPropia] = useState("");
  const busqueda = busquedaExterna ?? busquedaPropia;
  const [soloSubidas, setSoloSubidas] = useState(false);
  const [categoria, setCategoria] = useState<FiltroCategoria>("todas");
  const [proveedor, setProveedor] = useState("");
  const [periodo, setPeriodo] = useState<Periodo>("todo");
  const [tipo, setTipo] = useState<string>(TODOS);
  const [orden, setOrden] = useState<Orden>("gasto");
  const [vista, setVista] = useState<"productos" | "pendientes">("productos");
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [detalle, setDetalle] = useState<number | null>(null);
  const [fusionando, setFusionando] = useState(false);
  const [editandoCategorias, setEditandoCategorias] = useState(false);
  const [viendoProveedores, setViendoProveedores] = useState(false);

  const filtroPeriodo = useMemo(() => ({ ...rangoPeriodo(periodo), tipo: tipo === TODOS ? null : tipo }), [periodo, tipo]);
  const categoriasQ = useCategoriasProducto();
  const resumenQ = useResumenProductos(filtroPeriodo);
  const gastoQ = useGastoCategorias(filtroPeriodo);
  const recategorizar = useRecategorizarProductos();
  const clasificar = useClasificarConIA();
  // Proveedores unificados (20261007180000): el filtro y la lista usan el
  // proveedor canónico. Sin la migración, el texto del documento como antes.
  const proveedoresQ = useProveedores();
  const subidasQ = useProductosConSubida(true);
  const nombresSubida = subidasQ.data ?? null;
  const resolver = useMemo(() => crearResolverProveedor(proveedoresQ.data?.proveedores), [proveedoresQ.data]);

  const categorias = useMemo(() => categoriasQ.data ?? [], [categoriasQ.data]);
  const mapa = useMemo(() => indexarCategorias(categorias), [categorias]);
  const productos = useMemo(() => resumenQ.data ?? [], [resumenQ.data]);
  const totales = useMemo(() => totalesPorRaiz(gastoQ.data ?? [], mapa), [gastoQ.data, mapa]);
  const proveedores = useMemo(() => proveedoresDe(productos, resolver), [productos, resolver]);

  const visibles = useMemo(() => {
    const lista = filtrarProductos(
      productos,
      { busqueda, categoria, proveedor, soloConCompras: periodo !== "todo" || tipo !== TODOS },
      mapa,
      resolver,
    );
    const ordenada = (soloSubidas && nombresSubida ? lista.filter((p) => nombresSubida.has(normalizarBusqueda(p.nombre))) : lista).slice();
    if (orden === "nombre") ordenada.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    else if (orden === "compras") ordenada.sort((a, b) => b.compras - a.compras || b.gasto - a.gasto);
    else ordenada.sort((a, b) => b.gasto - a.gasto || a.nombre.localeCompare(b.nombre, "es"));
    return ordenada;
  }, [productos, busqueda, categoria, proveedor, periodo, tipo, orden, mapa, resolver, soloSubidas, nombresSubida]);

  const gastoTotal = totales.reduce((a, t) => a + t.gasto, 0);
  const gastoVisible = visibles.reduce((a, p) => a + p.gasto, 0);
  const pendientes = totales.find((t) => t.clave === "pendiente")?.lineas ?? 0;
  const seleccionados = productos.filter((p) => seleccion.has(p.producto_id));
  const productoDetalle = productos.find((p) => p.producto_id === detalle) ?? null;

  const error = resumenQ.error ?? categoriasQ.error ?? gastoQ.error;
  if (error) {
    const sinMigrar = faltaMigracionCatalogo(error as { code?: string; message?: string });
    return (
      <div className="flex h-full items-center justify-center rounded-xl border bg-card p-6 text-center">
        <div className="max-w-md space-y-2">
          <p className="font-semibold">{sinMigrar ? "El catálogo de productos aún no está activado" : "No se ha podido cargar el catálogo"}</p>
          <p className="text-sm text-muted-foreground">
            {sinMigrar
              ? "Falta aplicar la migración 20261007160000_productos_catalogo_categorias en la base de datos."
              : (error as { message?: string }).message}
          </p>
        </div>
      </div>
    );
  }

  const alternar = (id: number) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const elegirChip = (c: FiltroCategoria | "pendiente") => {
    if (c === "pendiente") {
      setVista("pendientes");
      return;
    }
    setVista("productos");
    setCategoria(c);
  };
  const chipActivo = (c: FiltroCategoria | "pendiente") =>
    c === "pendiente" ? vista === "pendientes" : vista === "productos" && categoria === c;

  const filtrosSelects = (
    <>
      <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
        <SelectTrigger className={compacto ? "h-11 w-full" : "w-[9.5rem]"} aria-label="Periodo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(ETIQUETAS_PERIODO) as Periodo[]).map((p) => (
            <SelectItem key={p} value={p}>{ETIQUETAS_PERIODO[p]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={tipo} onValueChange={setTipo}>
        <SelectTrigger className={compacto ? "h-11 w-full" : "w-[9.5rem]"} aria-label="Tipo de documento">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={TODOS}>Facturas y albaranes</SelectItem>
          <SelectItem value="factura">Solo facturas</SelectItem>
          <SelectItem value="albaran">Solo albaranes</SelectItem>
        </SelectContent>
      </Select>
      <Select value={proveedor || TODOS} onValueChange={(v) => setProveedor(v === TODOS ? "" : v)}>
        <SelectTrigger className={compacto ? "h-11 w-full" : "w-[11rem]"} aria-label="Proveedor">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[60vh]">
          <SelectItem value={TODOS}>Todos los proveedores</SelectItem>
          {proveedores.map((p) => (
            <SelectItem key={p.clave} value={p.clave}>{p.nombre}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={orden} onValueChange={(v) => setOrden(v as Orden)}>
        <SelectTrigger className={compacto ? "h-11 w-full" : "w-[9rem]"} aria-label="Ordenar por">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="gasto">Más gasto</SelectItem>
          <SelectItem value="compras">Más compras</SelectItem>
          <SelectItem value="nombre">Nombre</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
  const selectorSubcategoria = (
    <SelectorCategoria
      categorias={categorias}
      valor={typeof categoria === "number" ? categoria : null}
      onCambiar={(c) => setCategoria(c === null ? "todas" : c)}
      etiqueta="Filtrar por categoría o subcategoría"
      className={compacto ? "h-11 w-full" : "w-[14rem]"}
      textoNinguna="Todas las categorías"
    />
  );
  const filtrosActivos =
    (periodo !== "todo" ? 1 : 0) + (tipo !== TODOS ? 1 : 0) + (proveedor ? 1 : 0) + (orden !== "gasto" ? 1 : 0) + (typeof categoria === "number" ? 1 : 0);

  return (
    <div
      className={
        compacto
          ? "flex h-full min-h-0 flex-col gap-0.5"
          : "flex h-full min-h-0 flex-col gap-2 rounded-xl border border-border/50 bg-card p-2 shadow-sm sm:p-3"
      }
    >
      {/* Herramientas: en Compras, botones de icono con etiqueta accesible (nada se corta a 1280). */}
      <div className={`flex shrink-0 items-center ${compacto ? "gap-0.5" : "flex-wrap gap-2"}`}>
        {busquedaExterna === undefined && (
          <div className="relative min-w-[12rem] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={busquedaPropia}
              onChange={(e) => setBusquedaPropia(e.target.value)}
              placeholder="Buscar producto o categoría"
              aria-label="Buscar producto"
              className="pl-9"
            />
          </div>
        )}
        {compacto ? (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" className="h-11 shrink-0 gap-1.5 px-3" aria-label="Filtros" title="Filtrar y ordenar">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
                <span>Filtros</span>
                {filtrosActivos > 0 && (
                  <span className="rounded-full bg-muted px-1.5 text-[11px] pointer-coarse:text-xs font-semibold leading-5 text-foreground tabular-nums">
                    {filtrosActivos}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(18rem,calc(100vw-2rem))] space-y-2">
              <p className="text-sm font-semibold">Filtrar y ordenar productos</p>
              {filtrosSelects}
              {selectorSubcategoria}
            </PopoverContent>
          </Popover>
        ) : (
          filtrosSelects
        )}
        {!compacto && (
          <Button variant="outline" onClick={() => setViendoProveedores(true)}>
            <Truck className="mr-1 h-4 w-4" aria-hidden="true" /> Proveedores
          </Button>
        )}
        {puedeEditar &&
          (compacto ? (
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Categorías" title="Categorías" onClick={() => setEditandoCategorias(true)}>
              <FolderTree className="h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setEditandoCategorias(true)}>
              <FolderTree className="mr-1 h-4 w-4" aria-hidden="true" /> Categorías
            </Button>
          ))}
        <AvisosPrecio puedeEditar={puedeEditar} soloIcono={compacto} />
        {puedeEditar &&
          pendientes > 0 &&
          (compacto ? (
            <Button
              variant="ghost"
              className="h-11 shrink-0 gap-1.5 px-3 text-primary"
              disabled={clasificar.isPending}
              onClick={() => clasificar.mutate()}
              aria-label={clasificar.isPending ? "Clasificando…" : `Clasificar ${pendientes} con IA`}
              title={`Clasificar ${plural(pendientes, "línea", "líneas")} con IA`}
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              <span className="tabular-nums">{pendientes}</span>
            </Button>
          ) : (
            <Button variant="outline" disabled={clasificar.isPending} onClick={() => clasificar.mutate()}>
              <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
              {clasificar.isPending ? "Clasificando…" : `Clasificar ${pendientes} con IA`}
            </Button>
          ))}
      </div>

      {/* Gasto por categoría (clic = filtrar): una sola fila de chips, con scroll horizontal sin barra */}
      <div
        className={`flex shrink-0 overflow-x-auto no-scrollbar ${compacto ? "h-11 items-center gap-1" : "gap-2 pb-1"}`}
        role="toolbar"
        aria-label="Gasto por categoría"
      >
        <button
          type="button"
          onClick={() => elegirChip("todas")}
          aria-pressed={chipActivo("todas")}
          className={chipCategoria(compacto, "")}
          title="Gasto sin IVA (importes de línea)"
        >
          <span className="font-semibold">Todas</span>
          <span className="whitespace-nowrap tabular-nums text-muted-foreground">
            {formatCurrency(gastoTotal)} <span className="text-[11px] pointer-coarse:text-xs">sin IVA</span>
          </span>
        </button>
        {totales.map((t) => (
          <button
            key={String(t.clave)}
            type="button"
            onClick={() => elegirChip(t.clave)}
            aria-pressed={chipActivo(t.clave)}
            title="Gasto sin IVA (importes de línea)"
            className={chipCategoria(compacto, t.clave === "pendiente" ? "!border-amber-400/70 bg-amber-50 dark:bg-amber-950/30" : "")}
          >
            <span className="whitespace-nowrap font-semibold">{t.nombre}</span>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {t.clave === "pendiente" ? `${plural(t.lineas, "línea", "líneas")} · ${formatCurrency(t.gasto)}` : formatCurrency(t.gasto)}
            </span>
          </button>
        ))}
        {/* Productos cuya última compra es más cara que su referencia (umbral de Avisos de precio). */}
        {nombresSubida && (
          <button
            type="button"
            onClick={() => {
              setVista("productos");
              setSoloSubidas((v) => !v);
            }}
            aria-pressed={soloSubidas}
            className={chipCategoria(compacto, "!border-red-200 aria-pressed:!border-red-500 aria-pressed:bg-red-50 dark:!border-red-900 dark:aria-pressed:bg-red-950/30")}
          >
            <span className="flex items-center gap-1 whitespace-nowrap font-semibold">
              <TrendingUp className="h-3.5 w-3.5 text-red-600" aria-hidden="true" /> Subieron de precio
            </span>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">{plural(nombresSubida.size, "producto", "productos")}</span>
          </button>
        )}
      </div>

      {vista === "productos" && (!compacto || categoria !== "todas" || (puedeEditar && seleccion.size > 0)) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {/* En Compras este selector va dentro de «Filtros» (la lista es estrecha y el alto, justo). */}
          {!compacto && selectorSubcategoria}
          {categoria !== "todas" && (
            <Button variant="ghost" size="sm" className={compacto ? "h-11" : undefined} onClick={() => setCategoria("todas")}>
              <X className="mr-1 h-4 w-4" aria-hidden="true" /> Quitar filtro
            </Button>
          )}
          {puedeEditar && seleccion.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/50 px-2 py-1" aria-label="Acciones sobre la selección">
              <span className="text-sm font-medium">{seleccion.size} seleccionado(s)</span>
              <SelectorCategoria
                categorias={categorias}
                valor={undefined}
                placeholder="Cambiar categoría…"
                etiqueta="Cambiar la categoría de los seleccionados"
                className="w-[12rem]"
                disabled={recategorizar.isPending}
                onCambiar={(c) => recategorizar.mutate({ ids: [...seleccion], categoriaId: c }, { onSuccess: () => setSeleccion(new Set()) })}
              />
              <Button size="sm" className={compacto ? "h-11" : undefined} disabled={seleccion.size < 2} onClick={() => setFusionando(true)}>
                <Merge className="mr-1 h-4 w-4" aria-hidden="true" /> Fusionar
              </Button>
              <Button size="sm" variant="ghost" className={compacto ? "h-11" : undefined} onClick={() => setSeleccion(new Set())}>
                Quitar selección
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lista (scroll por dentro) */}
      <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${compacto ? "border-t border-border/50" : "rounded-lg border"}`} data-testid="lista-productos">
        {vista === "pendientes" ? (
          <LineasSinClasificar catalogo={productos} categorias={categorias} puedeEditar={puedeEditar} />
        ) : resumenQ.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando productos…</p>
        ) : visibles.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Ningún producto coincide con los filtros.</p>
        ) : (
          <>
            {!compacto && (
              <div
                className={`sticky top-0 z-10 hidden gap-2 border-b bg-muted/60 px-2 py-2 text-xs font-semibold text-muted-foreground backdrop-blur lg:grid ${COLUMNAS}`}
              >
                <span />
                <span>Producto</span>
                <span className="text-right">Compras</span>
                <span className="text-right">Cantidad</span>
                <span className="text-right">Gasto</span>
                <span className="text-right">Último precio</span>
              </div>
            )}
            <ul className="divide-y divide-border/50">
              {visibles.map((p) => (
                <FilaResumen
                  key={p.producto_id}
                  p={p}
                  ruta={rutaCategoria(mapa, p.categoria_id)}
                  resolver={resolver}
                  seleccionado={seleccion.has(p.producto_id)}
                  conCasilla={puedeEditar}
                  compacta={compacto}
                  abierto={seleccionadoId === p.producto_id}
                  subio={!!nombresSubida?.has(normalizarBusqueda(p.nombre))}
                  onAlternar={() => alternar(p.producto_id)}
                  onAbrir={() => (onAbrir ? onAbrir(p.producto_id) : setDetalle(p.producto_id))}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        {vista === "productos"
          ? `${plural(visibles.length, "producto", "productos")} · ${formatCurrency(gastoVisible)}`
          : `${plural(pendientes, "línea", "líneas")} sin clasificar`}{" "}
        · importes de línea sin IVA
      </p>

      {!compacto && productoDetalle && (
        <DetalleProductoDialog
          producto={productoDetalle}
          catalogo={productos}
          categorias={categorias}
          puedeEditar={puedeEditar}
          onCerrar={() => setDetalle(null)}
        />
      )}
      {fusionando && seleccionados.length >= 2 && (
        <FusionarDialog
          productos={seleccionados}
          onCerrar={() => setFusionando(false)}
          onHecho={() => {
            setFusionando(false);
            setSeleccion(new Set());
          }}
        />
      )}
      {editandoCategorias && <CategoriasDialog categorias={categorias} onCerrar={() => setEditandoCategorias(false)} />}
      {viendoProveedores && <ProveedoresDialog puedeEditar={puedeEditar} onCerrar={() => setViendoProveedores(false)} />}
    </div>
  );
}

/**
 * Chip de categoría. En Compras es de una sola línea (nombre + importe en gris),
 * visualmente de 32 px pero con zona táctil de 44 (el contenedor mide 44 y el
 * `before:` amplía el toque); fuera de Compras, la tarjeta de dos líneas de siempre.
 */
const chipCategoria = (compacto: boolean, extra: string) =>
  compacto
    ? `relative flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3 text-xs before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[''] aria-pressed:bg-muted aria-pressed:text-foreground hover:bg-muted/50 ${extra}`
    : `flex min-h-11 shrink-0 flex-col justify-center rounded-lg border px-3 py-1 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10 ${extra}`;

function FilaResumen({
  p,
  ruta,
  resolver,
  seleccionado,
  conCasilla,
  compacta,
  abierto,
  subio,
  onAlternar,
  onAbrir,
}: {
  p: ResumenProducto;
  ruta: string | null;
  resolver: ResolverProveedor;
  seleccionado: boolean;
  conCasilla: boolean;
  /** Compras: una sola columna (nombre + gasto, datos debajo) también en pantallas anchas. */
  compacta: boolean;
  /** Es el producto que está abierto en la ficha. */
  abierto: boolean;
  /** Su última compra es más cara que su referencia. */
  subio: boolean;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const nombresProv = nombresProveedores(p, resolver);
  // `lg:` solo en la lista ancha de siempre; en Compras la lista es una columna estrecha.
  const lg = (clases: string) => (compacta ? "" : clases);
  if (compacta) {
    // Compras: dos líneas como mucho. Nombre (truncado, con tooltip) + importe
    // arriba; «Categoría · Proveedor · N compras · kg · últ. €» truncado debajo.
    const detalle = [
      ruta ?? "Sin categoría",
      nombresProv.length > 0 ? nombresProv.join(", ") : null,
      plural(p.compras, "compra", "compras"),
      formatCantidades(p.cantidades),
      p.ultimo_precio !== null ? `últ. ${formatCurrency(p.ultimo_precio)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li
        className={`flex items-center gap-1 px-2 py-1 ${abierto ? "bg-muted/70" : seleccionado ? "bg-primary/5" : ""}`}
        aria-current={abierto ? "true" : undefined}
      >
        {conCasilla && (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center">
            <Checkbox checked={seleccionado} onCheckedChange={onAlternar} aria-label={`Seleccionar ${p.nombre}`} />
          </div>
        )}
        <button type="button" onClick={onAbrir} className="min-h-11 min-w-0 flex-1 rounded-md px-1 py-0.5 text-left hover:bg-muted/40">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-sm font-medium" title={p.nombre}>
              {p.nombre}
            </span>
            {subio && (
              <TrendingUp className="h-3.5 w-3.5 shrink-0 text-red-600" role="img" aria-label="Ha subido de precio">
                <title>Su última compra es más cara que el precio de referencia</title>
              </TrendingUp>
            )}
            {p.origen === "ia" && (
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-amber-600" role="img" aria-label="Clasificado por la IA, sin revisar">
                <title>Clasificado por la IA; nadie lo ha corregido todavía</title>
              </Sparkles>
            )}
            <span className="ml-auto shrink-0 pl-2 text-sm font-semibold tabular-nums">{formatCurrency(p.gasto)}</span>
          </span>
          <span className="block truncate text-xs text-muted-foreground" title={detalle}>
            {detalle}
          </span>
        </button>
      </li>
    );
  }
  return (
    <li
      className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-2 py-1.5 ${lg(COLUMNAS)} ${
        abierto ? "bg-muted/70" : seleccionado ? "bg-primary/5" : ""
      }`}
      aria-current={abierto ? "true" : undefined}
    >
      <div className="flex h-11 w-11 items-center justify-center">
        {conCasilla && <Checkbox checked={seleccionado} onCheckedChange={onAlternar} aria-label={`Seleccionar ${p.nombre}`} />}
      </div>
      <button type="button" onClick={onAbrir} className="min-h-11 min-w-0 rounded-md px-1 py-1 text-left hover:bg-muted/40">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={`min-w-0 break-words font-medium ${lg("lg:truncate")}`}>{p.nombre}</span>
          {subio && (
            <TrendingUp className="h-3.5 w-3.5 shrink-0 text-red-600" role="img" aria-label="Ha subido de precio">
              <title>Su última compra es más cara que el precio de referencia</title>
            </TrendingUp>
          )}
          {p.origen === "ia" && (
            <Sparkles
              className="h-3.5 w-3.5 shrink-0 text-amber-600"
              role="img"
              aria-label="Clasificado por la IA, sin revisar"
            >
              <title>Clasificado por la IA; nadie lo ha corregido todavía</title>
            </Sparkles>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {ruta ?? "Sin categoría"}
          {nombresProv.length > 0 && ` · ${nombresProv.join(", ")}`}
        </span>
      </button>
      {/* Móvil, tablet y Compras: gasto a la derecha; el resto debajo. lg+ (lista ancha): columnas. */}
      <span className={`text-right font-semibold tabular-nums ${lg("lg:hidden")}`}>{formatCurrency(p.gasto)}</span>
      <span className={`col-start-2 col-end-4 text-xs text-muted-foreground ${lg("lg:hidden")}`}>
        {plural(p.compras, "compra", "compras")} · {formatCantidades(p.cantidades)}
        {p.ultimo_precio !== null && ` · últ. ${formatCurrency(p.ultimo_precio)}`}
      </span>
      {!compacta && (
        <>
          <span className="hidden text-right text-sm tabular-nums lg:block">{p.compras}</span>
          <span className="hidden truncate text-right text-sm tabular-nums lg:block" title={formatCantidades(p.cantidades)}>
            {formatCantidades(p.cantidades)}
          </span>
          <span className="hidden text-right text-sm font-semibold tabular-nums lg:block">{formatCurrency(p.gasto)}</span>
          <span className="hidden text-right text-sm tabular-nums lg:block" title={p.ultima_fecha ? `Última compra ${formatDateCorta(p.ultima_fecha)}` : undefined}>
            {p.ultimo_precio === null ? "—" : formatCurrency(p.ultimo_precio)}
          </span>
        </>
      )}
    </li>
  );
}
