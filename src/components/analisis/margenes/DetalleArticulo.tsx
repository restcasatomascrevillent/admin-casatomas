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
//   · Con IVA o sin IVA (11/11/2026, conmutador de la página): cada cifra dice
//     cuál es, con una explicación para tontos («De cada 100 € que cobras…») y
//     qué parte de cada precio es IVA.
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
  porcentaje,
  veces,
  type PlatoMargen,
  type VinoMargen,
  type ConfigMargenes,
  type ProductoBuscado,
  type UnidadEscandallo,
} from "@/lib/analisis/margenesCarta";
import {
  ETIQUETA_MODO,
  cifrasIva,
  costeIngredienteModo,
  desgloseIva,
  explicacionIva,
  precioCompraModo,
  razonIva,
  textoIvaCompra,
  type ModoIva,
} from "@/lib/analisis/margenesIva";

const fechaCorta = (f: string | null) => (f ? new Date(`${f}T00:00:00`).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "2-digit" }) : "—");

function Dato({ etiqueta, valor, rojo, detalle }: { etiqueta: string; valor: string; rojo?: boolean; detalle?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("font-semibold tabular-nums", rojo && "text-destructive")}>{valor}</dd>
      {detalle && <dd className="text-xs text-muted-foreground">{detalle}</dd>}
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
  modo = "sin",
  puedeEditar,
  onCerrar,
}: {
  articulo: PlatoMargen | VinoMargen | null;
  config: ConfigMargenes;
  /** Cuenta del conmutador de la página: sin IVA (base) o con IVA. */
  modo?: ModoIva;
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
  const c = a ? cifrasIva(a, modo, config) : null;
  const et = ETIQUETA_MODO[modo];
  const otra = modo === "sin" ? "con" : "sin";
  const cOtra = a ? cifrasIva(a, otra, config) : null;
  const varios = a?.tipo === "plato" && a.ingredientes.filter((i) => i.coste !== null).length > 1;
  // Coste de hace 6 meses en esta cuenta (con IVA, con el IVA de compra de ahora).
  const coste6m = a && c && a.coste6m !== null ? (modo === "sin" || c.costeSinIva === null || c.costeConIva === null || c.costeSinIva <= 0 ? a.coste6m : a.coste6m * (c.costeConIva / c.costeSinIva)) : null;
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
                  <span key={b} className={cn("rounded px-1.5 py-0.5 text-xs", b === "coste_alto" || b === "multiplicador_bajo" || b === "sube_coste" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                    {ETIQUETA_BANDERA[b]}
                  </span>
                ))}
              </div>
            </SheetHeader>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <p className={cn("text-sm", rojo && "text-destructive")}>{razonIva(a, config, modo)}</p>
              {c && explicacionIva(a, config, modo) && (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-sm" data-testid="explicacion-margen">{explicacionIva(a, config, modo)}</p>
              )}
              {c && cOtra && (
                <dl className="grid grid-cols-3 gap-2 text-sm" data-testid="cifras-margen">
                  <Dato
                    etiqueta={modo === "sin" ? `Precio sin IVA (quitado el ${config.ivaPct} %)` : "Precio de carta (con IVA)"}
                    valor={euros(c.precio)}
                    detalle={modo === "sin" ? `${euros(c.precioCarta)} en carta` : `${euros(c.precioBase)} sin IVA`}
                  />
                  <Dato
                    etiqueta={`Coste ${et}`}
                    valor={euros(c.coste)}
                    detalle={c.coste === null ? undefined : `${euros(cOtra.coste)} ${ETIQUETA_MODO[otra]} · ${textoIvaCompra(c, varios)}`}
                  />
                  {a.tipo === "vino" ? (
                    <Dato etiqueta={`Multiplicador ${et}`} valor={veces(c.multiplicador)} rojo={rojo} detalle={`mínimo ${veces(c.limite)}`} />
                  ) : (
                    <Dato etiqueta={`% de coste ${et}`} valor={porcentaje(c.pct)} rojo={rojo} detalle={`máximo ${porcentaje(c.limite)}`} />
                  )}
                  <Dato etiqueta={`Margen ${et}`} valor={euros(c.margen)} detalle="lo que queda de cada venta" />
                  <Dato
                    etiqueta={`Coste hace 6 meses ${et}`}
                    valor={coste6m === null ? "—" : `${euros(coste6m)}${a.variacionPct !== null ? ` (${a.variacionPct > 0 ? "+" : ""}${porcentaje(a.variacionPct)})` : ""}`}
                    rojo={a.banderas.includes("sube_coste")}
                  />
                </dl>
              )}
              {desgloseIva(a, config) && <p className="text-xs text-muted-foreground" data-testid="desglose-iva">{desgloseIva(a, config)}</p>}

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
                                {precioCompraModo(orig, modo)} → <span className="font-medium text-foreground">{euros(costeIngredienteModo(orig, modo))}</span>
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
