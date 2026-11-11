// Detalle de un plato o vino de «Márgenes de carta» (panel lateral).
//
//   · Arriba, el porqué y las cifras: precio, sin IVA, coste, % / multiplicador,
//     margen bruto y coste de hace 6 meses.
//   · Plato: escandallo editable (producto, cantidad en g/ml/ud de compra, nota),
//     añadir o quitar ingredientes y «Guardar» (pasa a 'manual').
//     Vino: el producto de compra que es su botella; cambiarlo o quitarlo.
//   · «Revisado» para marcar lo comprobado.
//   · «Compras»: las líneas que forman el coste de cada producto; tocar una abre
//     el original de la factura (VisorDocumento de Facturas › Análisis).
//   Sin «Editar» en Facturas, todo es de solo lectura.
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileText, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { VisorDocumento } from "@/components/facturas/analisis/VisorDocumento";
import { useBuscarProductos, useComprasProducto, useEdicionMargenes, type IngredienteEditado } from "@/hooks/useMargenesCarta";
import {
  ETIQUETA_BANDERA,
  cantidadTexto,
  euros,
  litrosTexto,
  notaIva,
  porcentaje,
  precioCompra,
  razon,
  veces,
  type PlatoMargen,
  type VinoMargen,
  type ConfigMargenes,
  type ProductoBuscado,
  type UnidadEscandallo,
} from "@/lib/analisis/margenesCarta";

const fechaCorta = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

function Dato({ etiqueta, valor, rojo }: { etiqueta: string; valor: string; rojo?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("font-semibold tabular-nums", rojo && "text-destructive")}>{valor}</dd>
    </div>
  );
}

/** Buscador de productos del catálogo (para el escandallo o el vino). */
function BuscadorProducto({ onElegir, onCancelar, etiqueta }: { onElegir: (p: ProductoBuscado) => void; onCancelar: () => void; etiqueta: string }) {
  const [texto, setTexto] = useState("");
  const q = useBuscarProductos(texto);
  return (
    <div className="space-y-1 rounded-md border border-border/70 p-2">
      <div className="flex items-center gap-1.5">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Busca en el catálogo (p. ej. percebe)" aria-label={etiqueta} className="h-10" />
        <Button variant="ghost" size="icon" onClick={onCancelar} aria-label="Cancelar la búsqueda"><X className="h-4 w-4" /></Button>
      </div>
      {q.isFetching && <p className="px-1 text-xs text-muted-foreground">Buscando…</p>}
      {q.data && q.data.length === 0 && <p className="px-1 text-xs text-muted-foreground">Ningún producto con ese nombre.</p>}
      <ul className="max-h-48 overflow-y-auto">
        {(q.data ?? []).map((p) => (
          <li key={p.id}>
            <button type="button" className="flex w-full min-h-10 items-center justify-between gap-2 rounded px-2 text-left text-sm hover:bg-muted/60" onClick={() => onElegir(p)}>
              <span className="min-w-0 truncate">{p.nombre}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{p.categoria ?? "—"} · {p.lineas} compras</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Compras que forman el coste de un producto, con su documento. */
function ComprasProducto({ productoId, onCerrar }: { productoId: number; onCerrar: () => void }) {
  const q = useComprasProducto(productoId);
  const navigate = useNavigate();
  const [visor, setVisor] = useState<number | null>(null);
  const filas = q.data ?? [];
  return (
    <div className="space-y-1 rounded-md border border-border/70 bg-muted/20 p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium">Últimas compras (las que cuentan: Casa Tomás, sin IVA, sin albaranes facturados)</p>
        <Button variant="ghost" size="icon" onClick={onCerrar} aria-label="Cerrar las compras"><X className="h-4 w-4" /></Button>
      </div>
      {q.isLoading && <p className="text-xs text-muted-foreground">Cargando…</p>}
      {q.isError && <p className="text-xs text-destructive">No se han podido cargar las compras.</p>}
      {!q.isLoading && filas.length === 0 && <p className="text-xs text-muted-foreground">No hay compras de este producto.</p>}
      <ul className="max-h-56 overflow-y-auto text-xs">
        {filas.map((c, i) => (
          <li key={c.lineaId}>
            <button type="button" className="flex w-full min-h-10 items-center gap-2 rounded px-1 text-left hover:bg-muted/60" onClick={() => setVisor(i)} title="Abrir el documento">
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="w-16 shrink-0 tabular-nums">{fechaCorta(c.fecha)}</span>
              <span className="min-w-0 flex-1 truncate">{c.proveedor} · {c.nombreLinea}</span>
              <span className="shrink-0 tabular-nums">
                {c.eurBase !== null ? `${euros(c.eurBase)}/${c.medida}` : `${euros(c.eurUd)}/${c.unidad ?? "ud"}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <VisorDocumento
        documentos={filas}
        indice={visor}
        onIndice={setVisor}
        onCerrar={() => setVisor(null)}
        total={filas.length}
        onAbrirEnCompras={(enlace) => navigate(`/facturas${enlace}`)}
      />
    </div>
  );
}

export function DetalleArticulo({
  articulo,
  config,
  tiendaActiva = false,
  conIva = false,
  puedeEditar,
  onCerrar,
}: {
  articulo: PlatoMargen | VinoMargen | null;
  config: ConfigMargenes;
  /** configuracion_tienda.activa: el margen de tienda se enseña igual, avisando si está desactivada. */
  tiendaActiva?: boolean;
  /** Interruptor «Con IVA» de la pantalla: enseña también el coste con el IVA de las compras. */
  conIva?: boolean;
  puedeEditar: boolean;
  onCerrar: () => void;
}) {
  const { escandallo, vino, revisado } = useEdicionMargenes();
  const [ings, setIngs] = useState<(IngredienteEditado & { producto: string })[]>([]);
  const [cambiado, setCambiado] = useState(false);
  const [buscando, setBuscando] = useState<"nuevo" | number | "vino" | null>(null);
  const [compras, setCompras] = useState<number | null>(null);

  useEffect(() => {
    setBuscando(null);
    setCompras(null);
    setCambiado(false);
    setIngs(
      articulo?.tipo === "plato"
        ? articulo.ingredientes.map((i) => ({ productoId: i.productoId, producto: i.producto, cantidad: i.cantidad, unidad: i.unidad, nota: i.nota }))
        : [],
    );
  }, [articulo]);

  const a = articulo;
  const rojo = !!a && (a.banderas.includes("coste_alto") || a.banderas.includes("multiplicador_bajo"));
  const cambiar = (i: number, parche: Partial<IngredienteEditado & { producto: string }>) => {
    setIngs((xs) => xs.map((x, j) => (j === i ? { ...x, ...parche } : x)));
    setCambiado(true);
  };
  const elegirProducto = (p: ProductoBuscado) => {
    if (buscando === "vino" && a) {
      vino.mutate({ vinoId: a.id, productoId: p.id }, { onSuccess: () => toast.success("Vino asociado al producto"), onError: (e) => toast.error(e.message) });
    } else if (buscando === "nuevo") {
      if (ings.some((x) => x.productoId === p.id)) return toast.error("Ese producto ya está en el escandallo");
      setIngs((xs) => [...xs, { productoId: p.id, producto: p.nombre, cantidad: 100, unidad: "g", nota: null }]);
      setCambiado(true);
    } else if (typeof buscando === "number") {
      cambiar(buscando, { productoId: p.id, producto: p.nombre });
    }
    setBuscando(null);
  };
  const guardar = () => {
    if (!a) return;
    if (ings.some((x) => !(x.cantidad > 0))) return toast.error("Todas las cantidades tienen que ser mayores que 0");
    escandallo.mutate(
      { platoId: a.id, ingredientes: ings },
      { onSuccess: () => { toast.success("Escandallo guardado"); setCambiado(false); }, onError: (e) => toast.error(e.message) },
    );
  };

  return (
    <Sheet open={!!a} onOpenChange={(o) => !o && onCerrar()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-testid="detalle-margen">
        {a && (
          <>
            <SheetHeader className="shrink-0 space-y-1 border-b border-border/70 px-4 pb-3 pt-4 pr-12 text-left">
              <SheetTitle className="text-base sm:text-lg">{a.nombre}</SheetTitle>
              <SheetDescription className="text-xs sm:text-sm">
                {a.categoria}
                {a.tipo === "plato" && a.unidad ? ` · se vende por ${a.unidad}` : ""}
              </SheetDescription>
              <div className="flex flex-wrap gap-1 pt-1">
                {a.banderas.map((b) => (
                  <span key={b} className={cn("rounded px-1.5 py-0.5 text-xs", b === "coste_alto" || b === "multiplicador_bajo" || b === "sube_coste" || b === "tienda_bajo" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                    {ETIQUETA_BANDERA[b]}
                  </span>
                ))}
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <p className={cn("text-sm", rojo && "text-destructive")}>{razon(a, config)}</p>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <Dato etiqueta="Precio de carta" valor={euros(a.precio)} />
                <Dato etiqueta={`Sin IVA (${config.ivaPct} %)`} valor={euros(a.venta)} />
                <Dato etiqueta="Coste actual" valor={euros(a.coste)} />
                {a.tipo === "vino" ? (
                  <Dato etiqueta="Multiplicador" valor={veces(a.multiplicador)} rojo={rojo} />
                ) : (
                  <Dato etiqueta="% de coste" valor={porcentaje(a.pct)} rojo={rojo} />
                )}
                <Dato etiqueta="Margen bruto" valor={euros(a.margen)} />
                <Dato
                  etiqueta="Coste hace 6 meses"
                  valor={a.coste6m === null ? "—" : `${euros(a.coste6m)}${a.variacionPct !== null ? ` (${a.variacionPct > 0 ? "+" : ""}${porcentaje(a.variacionPct)})` : ""}`}
                  rojo={a.banderas.includes("sube_coste")}
                />
                {conIva && <Dato etiqueta="Coste con IVA" valor={euros(a.costeIva)} />}
              </dl>
              {conIva && notaIva(a) && <p className="text-xs text-muted-foreground">{notaIva(a)}.</p>}
              {a.tipo === "vino" && a.formatoDistinto && (
                <p className="text-xs text-muted-foreground" data-testid="nota-formato">
                  Coste estimado desde la botella de {litrosTexto(a.litrosProducto)}: la carta es de {litrosTexto(a.litros)}.
                </p>
              )}
              {a.tipo === "vino" && a.enTienda && (
                <section className="space-y-1" aria-label="Margen en la tienda" data-testid="margen-tienda">
                  <h3 className="text-sm font-medium">
                    En la tienda{tiendaActiva ? "" : <span className="font-normal text-muted-foreground"> (tienda desactivada: cálculo informativo)</span>}
                  </h3>
                  <dl className="grid grid-cols-3 gap-2 text-sm">
                    <Dato etiqueta="Precio de tienda" valor={euros(a.precioTienda)} />
                    <Dato etiqueta={`Sin IVA (${config.ivaTiendaPct} %)`} valor={euros(a.ventaTienda)} />
                    <Dato
                      etiqueta={`Multiplicador (mín. ${veces(config.multiplicadorMinTienda)})`}
                      valor={veces(a.multiplicadorTienda)}
                      rojo={a.banderas.includes("tienda_bajo")}
                    />
                    <Dato etiqueta="Margen bruto" valor={euros(a.margenTienda)} />
                  </dl>
                </section>
              )}

              {a.tipo === "plato" ? (
                <section className="space-y-2" aria-label="Escandallo">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium">Ingredientes principales</h3>
                    {a.origen && <span className="text-xs text-muted-foreground">{a.origen === "estimado" ? "Estimado por Claude: corrígelo si no cuadra" : "Corregido a mano"}</span>}
                  </div>
                  {a.motivo && ings.length === 0 && <p className="text-xs text-muted-foreground">{a.motivo}</p>}
                  <ul className="space-y-2">
                    {ings.map((x, i) => {
                      const orig = a.ingredientes.find((o) => o.productoId === x.productoId);
                      return (
                        <li key={`${x.productoId}-${i}`} className="space-y-1.5 rounded-md border border-border/70 p-2">
                          <div className="flex items-start gap-2">
                            <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{x.producto}</p>
                            {orig && (
                              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                {precioCompra(orig)} → <span className="font-medium text-foreground">{euros(orig.coste)}</span>
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min={0}
                              step="any"
                              value={Number.isFinite(x.cantidad) ? x.cantidad : ""}
                              onChange={(e) => cambiar(i, { cantidad: Number(e.target.value) })}
                              disabled={!puedeEditar}
                              className="h-10 w-24 tabular-nums"
                              aria-label={`Cantidad de ${x.producto}`}
                            />
                            <select
                              value={x.unidad}
                              onChange={(e) => cambiar(i, { unidad: e.target.value as UnidadEscandallo })}
                              disabled={!puedeEditar}
                              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
                              aria-label={`Unidad de ${x.producto}`}
                            >
                              <option value="g">g</option>
                              <option value="ml">ml</option>
                              <option value="ud">ud de compra</option>
                            </select>
                            <Button variant="outline" size="sm" className="min-h-10" onClick={() => setCompras(x.productoId)}>Compras</Button>
                            {puedeEditar && (
                              <>
                                <Button variant="ghost" size="sm" className="min-h-10" onClick={() => setBuscando(i)}>Cambiar producto</Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Quitar ${x.producto}`}
                                  onClick={() => { setIngs((xs) => xs.filter((_, j) => j !== i)); setCambiado(true); }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                          {puedeEditar ? (
                            <Input
                              value={x.nota ?? ""}
                              onChange={(e) => cambiar(i, { nota: e.target.value || null })}
                              placeholder="Nota (p. ej. medio bogavante por ración)"
                              className="h-9 text-xs"
                              aria-label={`Nota de ${x.producto}`}
                              maxLength={300}
                            />
                          ) : (
                            x.nota && <p className="text-xs text-muted-foreground">{x.nota}</p>
                          )}
                          {orig && !puedeEditar && <p className="text-xs text-muted-foreground">{cantidadTexto(orig)}</p>}
                          {buscando === i && <BuscadorProducto etiqueta="Buscar el producto nuevo" onElegir={elegirProducto} onCancelar={() => setBuscando(null)} />}
                          {compras === x.productoId && <ComprasProducto productoId={x.productoId} onCerrar={() => setCompras(null)} />}
                        </li>
                      );
                    })}
                  </ul>
                  {puedeEditar && (buscando === "nuevo" ? (
                    <BuscadorProducto etiqueta="Buscar un ingrediente" onElegir={elegirProducto} onCancelar={() => setBuscando(null)} />
                  ) : (
                    <Button variant="outline" size="sm" className="min-h-10" onClick={() => setBuscando("nuevo")} disabled={ings.length >= 12}>
                      <Plus className="mr-1 h-4 w-4" aria-hidden /> Añadir ingrediente
                    </Button>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Cantidad por unidad de venta. «ud de compra» es la unidad de las facturas (lata, cubeta, docena, caja): 0,05 = un 5 % de una cubeta.
                  </p>
                </section>
              ) : (
                <section className="space-y-2" aria-label="Producto de compra">
                  <h3 className="text-sm font-medium">Botella de compra</h3>
                  {a.producto ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 p-2">
                      <p className="min-w-0 flex-1 text-sm">
                        {a.producto}
                        <span className="block text-xs text-muted-foreground">
                          {a.lineas ?? 0} compras · última {fechaCorta(a.ultima)}
                          {a.nota ? ` · ${a.nota}` : ""}
                        </span>
                      </p>
                      {a.productoId !== null && <Button variant="outline" size="sm" className="min-h-10" onClick={() => setCompras(a.productoId)}>Compras</Button>}
                      {puedeEditar && (
                        <Button variant="ghost" size="sm" className="min-h-10" onClick={() => vino.mutate({ vinoId: a.id, productoId: null }, { onError: (e) => toast.error(e.message) })}>
                          Quitar
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">{a.motivo ?? "Sin producto de compra asociado."}</p>
                  )}
                  {compras !== null && <ComprasProducto productoId={compras} onCerrar={() => setCompras(null)} />}
                  {puedeEditar && (buscando === "vino" ? (
                    <BuscadorProducto etiqueta="Buscar la botella" onElegir={elegirProducto} onCancelar={() => setBuscando(null)} />
                  ) : (
                    <Button variant="outline" size="sm" className="min-h-10" onClick={() => setBuscando("vino")}>
                      {a.producto ? "Cambiar la botella" : "Asociar una botella"}
                    </Button>
                  ))}
                </section>
              )}
            </div>
            <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border/70 px-4 py-3">
              <label className={cn("flex min-h-10 items-center gap-2 text-sm", !puedeEditar && "opacity-60")}>
                <Checkbox
                  checked={a.revisado}
                  disabled={!puedeEditar || revisado.isPending}
                  onCheckedChange={(v) => revisado.mutate({ tipo: a.tipo, id: a.id, valor: v === true }, { onError: (e) => toast.error(e.message) })}
                />
                Revisado
              </label>
              {a.tipo === "plato" && puedeEditar && (
                <Button className="ml-auto min-h-10" onClick={guardar} disabled={!cambiado || escandallo.isPending}>
                  {escandallo.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />} Guardar escandallo
                </Button>
              )}
            </footer>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
