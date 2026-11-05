import { useState, type ReactNode } from "react";
import { Merge, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Factura } from "@/hooks/useFacturas";
import { useFichaProveedor } from "@/hooks/useCompras";
import { formatCurrency, formatDate, formatImporte, plural } from "@/components/facturas/shared/formatters";
import { EditorProveedor, ProveedoresDialog } from "@/components/facturas/productos/ProveedoresDialog";
import { textoFrecuencia } from "@/lib/facturas/compras";
import type { Proveedor, ResolverProveedor } from "@/lib/facturas/proveedores";
import type { AgregadoProveedor } from "@/lib/facturas/resumenCompras";
import { ListaDocumentos } from "./ListaDocumentos";

/** Cuántos productos de «Qué le compras» se enseñan en el despliegue. */
const PRODUCTOS_RESUMIDOS = 5;

/** Un dato de la línea de datos: etiqueta gris y valor, en línea. */
const Dato = ({ etiqueta, children }: { etiqueta: string; children: ReactNode }) => (
  <div className="flex min-w-0 items-baseline gap-1.5">
    <dt className="shrink-0 text-xs font-medium text-muted-foreground">{etiqueta}</dt>
    <dd className="min-w-0 text-sm font-semibold tabular-nums">{children}</dd>
  </div>
);

/**
 * Compras › Proveedores › despliegue (rediseño del 05/11/2026): lo que se ve al
 * tocar un proveedor en la lista, debajo de su fila. Una línea de datos (CIF,
 * cada cuánto pide, último pedido, regalado y abonos), qué le compras resumido
 * (RPC `ficha_proveedor_agente`; cada producto abre su ficha), las acciones de
 * siempre (editar nombre/CIF, fusionar) y SUS DOCUMENTOS por meses con el
 * subtotal de cada mes, igual que en Documentos. Todo respeta el local y el
 * periodo elegidos (`agregado` viene ya filtrado).
 */
export function FichaProveedor({
  proveedor,
  agregado,
  facturas,
  resolver,
  avisosPorId,
  seleccionadoDocId,
  puedeEditar,
  hayFiltros,
  onAbrirDocumento,
  onAbrirProducto,
}: {
  proveedor: Proveedor;
  /** Lo suyo con el local y el periodo elegidos (undefined = ningún documento). */
  agregado: AgregadoProveedor | undefined;
  /** Todas las facturas, para «Incluido en F-xxx». */
  facturas: Factura[];
  resolver: ResolverProveedor;
  avisosPorId: Map<number, unknown[]>;
  seleccionadoDocId: number | null;
  puedeEditar: boolean;
  /** Hay local o periodo elegidos (para el texto de «ningún documento»). */
  hayFiltros: boolean;
  onAbrirDocumento: (id: number) => void;
  /** Abre ese producto (por su nombre). */
  onAbrirProducto: (nombre: string) => void;
}) {
  const fichaQ = useFichaProveedor(proveedor.nombre);
  const [editando, setEditando] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const ficha = fichaQ.data && "proveedor" in fichaQ.data ? fichaQ.data : null;
  const otrasFormas = proveedor.variantes.filter((v) => v !== proveedor.nombre);
  const frecuencia = textoFrecuencia(ficha?.intervalo_medio_dias ?? null);
  const ultimo = ficha?.ultima ?? proveedor.ultima_fecha;
  const documentos = agregado?.documentos ?? [];

  return (
    <div className="space-y-2 border-l-2 border-primary/40 bg-muted/20 px-3 pb-2 pt-2 sm:px-4" data-testid="despliegue-proveedor">
      <dl className="flex flex-wrap gap-x-5 gap-y-1" aria-label="Datos del proveedor">
        <Dato etiqueta="CIF">
          {proveedor.cif ?? "sin CIF"}
          {proveedor.cifs_extra.length > 0 && <span className="font-normal text-muted-foreground"> (también {proveedor.cifs_extra.join(", ")})</span>}
        </Dato>
        {frecuencia && <Dato etiqueta="Pide">{frecuencia}</Dato>}
        {ultimo && <Dato etiqueta="Último pedido">{formatDate(ultimo)}</Dato>}
        {agregado && agregado.regalado > 0 && (
          <Dato etiqueta="Regalado / descuentos">
            {formatCurrency(agregado.regalado)}
            <span className="font-normal text-muted-foreground"> sin IVA{agregado.regaladoEstimado ? " · estimado" : ""}</span>
          </Dato>
        )}
        {agregado && agregado.nAbonos > 0 && (
          <Dato etiqueta={agregado.nAbonos === 1 ? "Abono" : "Abonos"}>
            <span className="text-emerald-700 dark:text-emerald-400">{formatImporte(agregado.abonos)}</span>
            <span className="font-normal text-muted-foreground"> ({plural(agregado.nAbonos, "documento", "documentos")})</span>
          </Dato>
        )}
      </dl>

      {fichaQ.isLoading && (
        <p className="text-sm text-muted-foreground" role="status">
          Cargando qué le compras…
        </p>
      )}
      {fichaQ.isError && (
        <p className="text-sm text-muted-foreground" role="status">
          No se ha podido leer qué le compras: {(fichaQ.error as { message?: string })?.message ?? "error desconocido"}.
        </p>
      )}
      {ficha && ficha.top_productos.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Qué le compras">
          <span className="text-xs font-medium text-muted-foreground">Qué le compras:</span>
          {ficha.top_productos.slice(0, PRODUCTOS_RESUMIDOS).map((t) => (
            <button
              key={`${t.producto}|${t.unidad ?? ""}`}
              type="button"
              onClick={() => onAbrirProducto(t.producto)}
              aria-label={`Ver el producto ${t.producto}`}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-sm hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              <span className="font-medium">{t.producto}</span>
              {t.ultimo_precio !== null && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(t.ultimo_precio)}
                  {t.unidad ? `/${t.unidad}` : ""}
                </span>
              )}
            </button>
          ))}
          {ficha.top_productos.length > PRODUCTOS_RESUMIDOS && (
            <span className="text-xs text-muted-foreground">y {ficha.top_productos.length - PRODUCTOS_RESUMIDOS} más · último precio sin IVA</span>
          )}
        </div>
      )}

      {(otrasFormas.length > 0 || proveedor.nombre_comercial) && (
        <p className="text-xs text-muted-foreground">
          {proveedor.nombre_comercial && <>Nombre comercial «{proveedor.nombre_comercial}». </>}
          {otrasFormas.length > 0 && <>Llega como: {otrasFormas.map((v) => `«${v}»`).join(", ")}</>}
        </p>
      )}

      {puedeEditar && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEditando((v) => !v)} aria-expanded={editando}>
            <Pencil className="h-4 w-4" aria-hidden="true" /> Editar datos
          </Button>
          <Button variant="outline" className="h-11 gap-1.5" onClick={() => setFusionando(true)}>
            <Merge className="h-4 w-4" aria-hidden="true" /> Fusionar con otro proveedor
          </Button>
        </div>
      )}
      {editando && <EditorProveedor p={proveedor} onCerrar={() => setEditando(false)} />}

      <div className="overflow-hidden rounded-lg border border-border/60 bg-card">
        <ListaDocumentos
          documentos={documentos}
          facturas={facturas}
          resolver={resolver}
          avisosPorId={avisosPorId}
          seleccionadoId={seleccionadoDocId}
          cargando={false}
          hayFiltros={hayFiltros}
          onAbrir={onAbrirDocumento}
          conProveedor={false}
          recordar={false}
          cabecerasFijas={false}
          etiqueta={`Documentos de ${proveedor.nombre}`}
        />
      </div>

      {fusionando && <ProveedoresDialog puedeEditar={puedeEditar} seleccionInicial={[proveedor.id]} onCerrar={() => setFusionando(false)} />}
    </div>
  );
}
