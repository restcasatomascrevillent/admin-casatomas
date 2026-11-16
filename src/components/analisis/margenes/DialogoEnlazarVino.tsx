// Enlazar un vino de la carta con el producto que se compra (vino_producto), desde
// «Coste vinos». Propone candidatos del catálogo por parecido de nombre (RPC
// vinos_coste_candidatos: pg_trgm) con su última compra; se confirma uno, se cambia
// o se quita el enlace. Guardar es margenes_guardar_vino (origen «manual»), que
// exige «Editar» en Facturas: sin ese permiso el diálogo es solo de lectura.
import { useState } from "react";
import { AlertTriangle, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useBuscarProductos, useCandidatosVino, useEdicionMargenes } from "@/hooks/useMargenesCarta";
import { euros, eurosCarta, fechaFactura, fmt } from "@/lib/analisis/margenesCarta";
import { formatoTexto, type VinoCoste } from "@/lib/analisis/costeVinos";

function Opcion({
  nombre,
  detalle,
  avisos,
  actual,
  puedeEditar,
  guardando,
  onElegir,
}: {
  nombre: string;
  detalle: string;
  avisos: string[];
  actual: boolean;
  puedeEditar: boolean;
  guardando: boolean;
  onElegir: () => void;
}) {
  return (
    <li className="flex items-start gap-2 py-2" data-testid="candidato-vino">
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium leading-snug">{nombre}</span>
        <span className="block break-words text-xs tabular-nums text-muted-foreground">{detalle}</span>
        {avisos.length > 0 && (
          <span className="mt-0.5 flex flex-wrap gap-1">
            {avisos.map((a) => (
              <span key={a} className="rounded border border-amber-500/50 px-1 text-[11px] text-amber-900 dark:text-amber-200">{a}</span>
            ))}
          </span>
        )}
      </span>
      {actual ? (
        <span className="mt-1 shrink-0 rounded bg-primary/10 px-2 py-1 text-xs font-medium text-primary">Enlazado</span>
      ) : (
        puedeEditar && (
          <Button size="sm" variant="outline" className="min-h-10 shrink-0 pointer-coarse:min-h-11" disabled={guardando} onClick={onElegir}>
            Enlazar
          </Button>
        )
      )}
    </li>
  );
}

export function DialogoEnlazarVino({ vino, hoy, puedeEditar, onCerrar }: { vino: VinoCoste | null; hoy: string | null; puedeEditar: boolean; onCerrar: () => void }) {
  const candidatos = useCandidatosVino(vino?.id ?? null);
  const [texto, setTexto] = useState("");
  const busqueda = useBuscarProductos(texto);
  const { vino: guardar } = useEdicionMargenes();

  const cerrar = () => {
    setTexto("");
    onCerrar();
  };
  const enlazar = (productoId: number | null) => {
    if (!vino) return;
    guardar.mutate(
      { vinoId: vino.id, productoId },
      {
        onSuccess: () => {
          toast.success(productoId === null ? "Enlace quitado" : "Vino enlazado con su producto de compra");
          cerrar();
        },
        onError: (e) => toast.error(e.message),
      },
    );
  };

  return (
    <Dialog open={vino !== null} onOpenChange={(abierto) => !abierto && cerrar()}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle className="break-words pr-6 text-base">{vino?.nombre ?? "Enlazar vino"}</DialogTitle>
          <DialogDescription>
            {vino ? `En carta a ${eurosCarta(vino.precio)} · ${formatoTexto(vino.litros)}. Elige el producto de las facturas que es esta botella.` : ""}
          </DialogDescription>
        </DialogHeader>
        {vino && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-1">
            <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm">
              {vino.productoId === null ? (
                <p className="text-muted-foreground">Ahora no está enlazado con ningún producto.</p>
              ) : (
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 break-words">
                    Enlazado a <strong>{vino.producto}</strong>
                    <span className="block text-xs text-muted-foreground">{vino.origen === "manual" ? "Puesto a mano" : "Enlace estimado (sin confirmar)"}</span>
                  </p>
                  {puedeEditar && (
                    <Button variant="ghost" size="sm" className="min-h-10 shrink-0 pointer-coarse:min-h-11" disabled={guardar.isPending} onClick={() => enlazar(null)}>
                      Quitar enlace
                    </Button>
                  )}
                </div>
              )}
            </div>
            {!puedeEditar && <p className="text-xs text-muted-foreground">Para cambiar el enlace hace falta el permiso «Editar» en Facturas.</p>}
            <section aria-label="Productos parecidos">
              <h3 className="text-xs font-medium text-muted-foreground">Productos de las facturas que se parecen por nombre</h3>
              {candidatos.isLoading ? (
                <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Buscando…
                </p>
              ) : candidatos.isError ? (
                <p className="flex items-center gap-2 py-3 text-sm text-destructive" role="alert">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> {candidatos.error instanceof Error ? candidatos.error.message : "No se han podido buscar"}
                </p>
              ) : (candidatos.data ?? []).length === 0 ? (
                <p className="py-3 text-sm text-muted-foreground">No hay ningún producto comprado con un nombre parecido. Búscalo abajo.</p>
              ) : (
                <ul className="divide-y divide-border/50">
                  {(candidatos.data ?? []).map((c) => (
                    <Opcion
                      key={c.id}
                      nombre={c.nombre}
                      detalle={
                        `Parecido ${fmt(c.similitud * 100, 0)} % · ` +
                        (c.factura
                          ? `última compra ${fechaFactura(c.factura.fecha, hoy)}, ${c.factura.proveedor}${c.costeBotella !== null ? ` · ${euros(c.costeBotella)} la botella` : ""}`
                          : "sin compras")
                      }
                      avisos={[
                        ...(c.formatoDistinto ? [`Otro formato: ${formatoTexto(c.litros)}`] : []),
                        ...(c.dudoso ? ["Dato dudoso: cuesta más que la carta o es precio de caja"] : []),
                        ...(c.enlazadoA.length ? [`Ya enlazado a ${c.enlazadoA.join(", ")}`] : []),
                      ]}
                      actual={c.id === vino.productoId}
                      puedeEditar={puedeEditar}
                      guardando={guardar.isPending}
                      onElegir={() => enlazar(c.id)}
                    />
                  ))}
                </ul>
              )}
            </section>
            {puedeEditar && (
              <section aria-label="Buscar otro producto">
                <label className="relative block">
                  <span className="sr-only">Buscar otro producto del catálogo</span>
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Buscar otro producto del catálogo" className="h-10 pl-8 pointer-coarse:h-11" type="search" />
                </label>
                {texto.trim().length >= 2 && (
                  <ul className="divide-y divide-border/50">
                    {busqueda.isLoading && <li className="py-2 text-sm text-muted-foreground">Buscando…</li>}
                    {(busqueda.data ?? []).slice(0, 8).map((p) => (
                      <Opcion
                        key={p.id}
                        nombre={p.nombre}
                        detalle={`${p.categoria ?? "Sin categoría"} · ${p.lineas ? `${p.lineas} compras, la última ${fechaFactura(p.ultima, hoy)}` : "sin compras"}`}
                        avisos={[]}
                        actual={p.id === vino.productoId}
                        puedeEditar
                        guardando={guardar.isPending}
                        onElegir={() => enlazar(p.id)}
                      />
                    ))}
                    {busqueda.data && busqueda.data.length === 0 && <li className="py-2 text-sm text-muted-foreground">Nada con ese nombre.</li>}
                  </ul>
                )}
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
