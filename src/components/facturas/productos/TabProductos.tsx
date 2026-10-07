import { useMemo, useState } from "react";
import { FolderTree, Merge, Search, Sparkles, Truck, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDateCorta } from "@/components/facturas/shared/formatters";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  useCategoriasProducto,
  useClasificarConIA,
  useGastoCategorias,
  useRecategorizarProductos,
  useResumenProductos,
} from "@/hooks/useProductosCatalogo";
import { useProveedores } from "@/hooks/useProveedores";
import { crearResolverProveedor, type ResolverProveedor } from "@/lib/facturas/proveedores";
import {
  ETIQUETAS_PERIODO,
  faltaMigracionCatalogo,
  filtrarProductos,
  formatCantidades,
  indexarCategorias,
  nombresProveedores,
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

/**
 * Facturas › Productos (encargo del dueño, 07/10/2026): el catálogo de
 * productos canónicos con su categoría, cuánto se ha comprado y gastado, y las
 * correcciones (categoría, nombre, fusionar duplicados, mover líneas). Ocupa el
 * alto de la pestaña y solo la lista hace scroll por dentro.
 */
export function TabProductos() {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const [busqueda, setBusqueda] = useState("");
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
    const ordenada = [...lista];
    if (orden === "nombre") ordenada.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    else if (orden === "compras") ordenada.sort((a, b) => b.compras - a.compras || b.gasto - a.gasto);
    else ordenada.sort((a, b) => b.gasto - a.gasto || a.nombre.localeCompare(b.nombre, "es"));
    return ordenada;
  }, [productos, busqueda, categoria, proveedor, periodo, tipo, orden, mapa, resolver]);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 rounded-xl border border-border/50 bg-card p-2 shadow-sm sm:p-3">
      {/* Filtros */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar producto o categoría"
            aria-label="Buscar producto"
            className="pl-9"
          />
        </div>
        <Select value={periodo} onValueChange={(v) => setPeriodo(v as Periodo)}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Periodo">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ETIQUETAS_PERIODO) as Periodo[]).map((p) => (
              <SelectItem key={p} value={p}>{ETIQUETAS_PERIODO[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipo} onValueChange={setTipo}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Tipo de documento">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={TODOS}>Facturas y albaranes</SelectItem>
            <SelectItem value="factura">Solo facturas</SelectItem>
            <SelectItem value="albaran">Solo albaranes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={proveedor || TODOS} onValueChange={(v) => setProveedor(v === TODOS ? "" : v)}>
          <SelectTrigger className="w-[11rem]" aria-label="Proveedor">
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
          <SelectTrigger className="w-[9rem]" aria-label="Ordenar por">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gasto">Más gasto</SelectItem>
            <SelectItem value="compras">Más compras</SelectItem>
            <SelectItem value="nombre">Nombre</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={() => setViendoProveedores(true)}>
          <Truck className="mr-1 h-4 w-4" aria-hidden="true" /> Proveedores
        </Button>
        {puedeEditar && (
          <Button variant="outline" onClick={() => setEditandoCategorias(true)}>
            <FolderTree className="mr-1 h-4 w-4" aria-hidden="true" /> Categorías
          </Button>
        )}
        <AvisosPrecio puedeEditar={puedeEditar} />
        {puedeEditar && pendientes > 0 && (
          <Button variant="outline" disabled={clasificar.isPending} onClick={() => clasificar.mutate()}>
            <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
            {clasificar.isPending ? "Clasificando…" : `Clasificar ${pendientes} con IA`}
          </Button>
        )}
      </div>

      {/* Gasto por categoría (clic = filtrar) */}
      <div className="flex shrink-0 gap-2 overflow-x-auto pb-1 no-scrollbar" role="toolbar" aria-label="Gasto por categoría">
        <button
          type="button"
          onClick={() => elegirChip("todas")}
          aria-pressed={chipActivo("todas")}
          className="flex min-h-11 shrink-0 flex-col justify-center rounded-lg border px-3 py-1 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10"
        >
          <span className="font-semibold">Todas</span>
          <span className="tabular-nums text-muted-foreground">{formatCurrency(gastoTotal)}</span>
        </button>
        {totales.map((t) => (
          <button
            key={String(t.clave)}
            type="button"
            onClick={() => elegirChip(t.clave)}
            aria-pressed={chipActivo(t.clave)}
            className={`flex min-h-11 shrink-0 flex-col justify-center rounded-lg border px-3 py-1 text-left text-xs aria-pressed:border-primary aria-pressed:bg-primary/10 ${
              t.clave === "pendiente" ? "border-amber-400/70 bg-amber-50 dark:bg-amber-950/30" : ""
            }`}
          >
            <span className="whitespace-nowrap font-semibold">{t.nombre}</span>
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">
              {t.clave === "pendiente" ? `${t.lineas} línea(s) · ${formatCurrency(t.gasto)}` : formatCurrency(t.gasto)}
            </span>
          </button>
        ))}
      </div>

      {vista === "productos" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SelectorCategoria
            categorias={categorias}
            valor={typeof categoria === "number" ? categoria : null}
            onCambiar={(c) => setCategoria(c === null ? "todas" : c)}
            etiqueta="Filtrar por categoría o subcategoría"
            className="w-[14rem]"
            textoNinguna="Todas las categorías"
          />
          {categoria !== "todas" && (
            <Button variant="ghost" size="sm" onClick={() => setCategoria("todas")}>
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
              <Button size="sm" disabled={seleccion.size < 2} onClick={() => setFusionando(true)}>
                <Merge className="mr-1 h-4 w-4" aria-hidden="true" /> Fusionar
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSeleccion(new Set())}>
                Quitar selección
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Lista (scroll por dentro) */}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border" data-testid="lista-productos">
        {vista === "pendientes" ? (
          <LineasSinClasificar catalogo={productos} categorias={categorias} puedeEditar={puedeEditar} />
        ) : resumenQ.isLoading ? (
          <p className="p-4 text-sm text-muted-foreground">Cargando productos…</p>
        ) : visibles.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Ningún producto coincide con los filtros.</p>
        ) : (
          <>
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
            <ul className="divide-y">
              {visibles.map((p) => (
                <FilaResumen
                  key={p.producto_id}
                  p={p}
                  ruta={rutaCategoria(mapa, p.categoria_id)}
                  resolver={resolver}
                  seleccionado={seleccion.has(p.producto_id)}
                  conCasilla={puedeEditar}
                  onAlternar={() => alternar(p.producto_id)}
                  onAbrir={() => setDetalle(p.producto_id)}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <p className="shrink-0 text-xs text-muted-foreground">
        {vista === "productos"
          ? `${visibles.length} producto(s) · ${formatCurrency(gastoVisible)}`
          : `${pendientes} línea(s) sin clasificar`}{" "}
        · importes de línea sin IVA
      </p>

      {productoDetalle && (
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

function FilaResumen({
  p,
  ruta,
  resolver,
  seleccionado,
  conCasilla,
  onAlternar,
  onAbrir,
}: {
  p: ResumenProducto;
  ruta: string | null;
  resolver: ResolverProveedor;
  seleccionado: boolean;
  conCasilla: boolean;
  onAlternar: () => void;
  onAbrir: () => void;
}) {
  const nombresProv = nombresProveedores(p, resolver);
  return (
    <li className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-2 py-1.5 ${COLUMNAS} ${seleccionado ? "bg-primary/5" : ""}`}>
      <div className="flex h-11 w-11 items-center justify-center">
        {conCasilla && <Checkbox checked={seleccionado} onCheckedChange={onAlternar} aria-label={`Seleccionar ${p.nombre}`} />}
      </div>
      <button type="button" onClick={onAbrir} className="min-h-11 min-w-0 rounded-md px-1 py-1 text-left hover:bg-muted/40">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 break-words font-medium lg:truncate">{p.nombre}</span>
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
      {/* Móvil y tablet vertical: gasto a la derecha; el resto debajo. lg+: columnas. */}
      <span className="text-right font-semibold tabular-nums lg:hidden">{formatCurrency(p.gasto)}</span>
      <span className="col-start-2 col-end-4 text-xs text-muted-foreground lg:hidden">
        {p.compras} compra(s) · {formatCantidades(p.cantidades)}
        {p.ultimo_precio !== null && ` · últ. ${formatCurrency(p.ultimo_precio)}`}
      </span>
      <span className="hidden text-right text-sm tabular-nums lg:block">{p.compras}</span>
      <span className="hidden truncate text-right text-sm tabular-nums lg:block" title={formatCantidades(p.cantidades)}>
        {formatCantidades(p.cantidades)}
      </span>
      <span className="hidden text-right text-sm font-semibold tabular-nums lg:block">{formatCurrency(p.gasto)}</span>
      <span className="hidden text-right text-sm tabular-nums lg:block" title={p.ultima_fecha ? `Última compra ${formatDateCorta(p.ultima_fecha)}` : undefined}>
        {p.ultimo_precio === null ? "—" : formatCurrency(p.ultimo_precio)}
      </span>
    </li>
  );
}
