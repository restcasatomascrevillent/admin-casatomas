import { useState } from "react";
import { Merge, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Factura } from "@/hooks/useFacturas";
import { useFichaProveedor } from "@/hooks/useCompras";
import { formatCurrency, formatDate, formatDateCorta, formatEntero } from "@/components/facturas/shared/formatters";
import { EditorProveedor, ProveedoresDialog } from "@/components/facturas/productos/ProveedoresDialog";
import { esAlbaranSinFactura, textoFrecuencia } from "@/lib/facturas/compras";
import type { Proveedor } from "@/lib/facturas/proveedores";

/** Una cifra de la fila de resumen: etiqueta gris encima (corta; `titulo` trae la larga), valor debajo, sin marco. */
const dato = (etiqueta: string, valor: string | null, titulo?: string) =>
  valor ? (
    <div className="min-w-0">
      <dt className="truncate text-[11px] pointer-coarse:text-xs font-medium text-muted-foreground" title={titulo ?? etiqueta}>
        {etiqueta}
      </dt>
      <dd className="truncate text-[13px] font-semibold tabular-nums" title={valor}>
        {valor}
      </dd>
    </div>
  ) : null;

/**
 * Compras › Proveedores › ficha: qué le compras, cada cuánto y cuándo fue el
 * último pedido (RPC `ficha_proveedor_agente`), sus documentos, y las acciones
 * de siempre sobre proveedores: editar nombre/CIF y fusionar con otro.
 */
export function FichaProveedor({
  proveedor,
  documentos,
  puedeEditar,
  onAbrirDocumento,
  onAbrirProducto,
}: {
  proveedor: Proveedor;
  /** Sus facturas y albaranes, el más reciente primero. */
  documentos: Factura[];
  puedeEditar: boolean;
  onAbrirDocumento: (id: number) => void;
  /** Busca ese producto en el modo Productos (por su nombre). */
  onAbrirProducto: (nombre: string) => void;
}) {
  const fichaQ = useFichaProveedor(proveedor.nombre);
  const [editando, setEditando] = useState(false);
  const [fusionando, setFusionando] = useState(false);
  const ficha = fichaQ.data && "proveedor" in fichaQ.data ? fichaQ.data : null;
  const sinFactura = documentos.filter(esAlbaranSinFactura);
  const otrasFormas = proveedor.variantes.filter((v) => v !== proveedor.nombre);
  const frecuencia = textoFrecuencia(ficha?.intervalo_medio_dias ?? null);

  return (
    <div className="space-y-3 p-3 sm:p-4">
      <header className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Proveedor</p>
        <h2 className="break-words text-lg font-semibold leading-tight">
          {proveedor.nombre}
          {proveedor.nombre_comercial && <span className="font-normal text-muted-foreground"> · «{proveedor.nombre_comercial}»</span>}
        </h2>
        <p className="text-sm text-muted-foreground">
          {proveedor.cif ? `CIF ${proveedor.cif}` : "Sin CIF"}
          {proveedor.cifs_extra.length > 0 && ` (también ${proveedor.cifs_extra.join(", ")})`}
        </p>
        {otrasFormas.length > 0 && (
          <p className="text-xs text-muted-foreground">Llega como: {otrasFormas.map((v) => `«${v}»`).join(", ")}</p>
        )}
        {puedeEditar && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setEditando((v) => !v)} aria-expanded={editando}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Editar datos
            </Button>
            <Button variant="outline" className="h-11 gap-1.5" onClick={() => setFusionando(true)}>
              <Merge className="h-4 w-4" aria-hidden="true" /> Fusionar con otro proveedor
            </Button>
          </div>
        )}
        {editando && <EditorProveedor p={proveedor} onCerrar={() => setEditando(false)} />}
      </header>

      <section aria-label="Resumen del proveedor" className="space-y-2">
        {fichaQ.isLoading && (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando la ficha…
          </p>
        )}
        {fichaQ.isError && (
          <p className="text-sm text-muted-foreground" role="status">
            No se ha podido leer la ficha: {(fichaQ.error as { message?: string })?.message ?? "error desconocido"}.
          </p>
        )}
        {fichaQ.data && !ficha && (
          <p className="text-sm text-muted-foreground" role="status">
            No hay compras registradas de este proveedor todavía.
          </p>
        )}
        <dl className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Cifras del proveedor">
          {dato("Documentos", `${formatEntero(proveedor.facturas)} fact. · ${formatEntero(proveedor.albaranes)} alb.`)}
          {/* Respaldo mientras carga la ficha: el mismo total que la lista (sin albaranes ya facturados desde 20261105130000). */}
          {dato("Gasto con IVA", formatCurrency(ficha?.gasto ?? proveedor.total_facturas + proveedor.total_albaranes), "Gasto con IVA: facturas + albaranes sin factura")}
          {dato("Último pedido", ficha?.ultima ? formatDate(ficha.ultima) : proveedor.ultima_fecha ? formatDate(proveedor.ultima_fecha) : null)}
          {dato("Cada cuánto", frecuencia ? `Pide ${frecuencia}` : null)}
          {dato("Sin factura", formatEntero(sinFactura.length), "Albaranes sin factura")}
        </dl>
        {ficha?.reparto && (
          <p className="text-xs text-muted-foreground">
            En facturas {formatCurrency(ficha.reparto.en_facturas)} · en albaranes sin factura {formatCurrency(ficha.reparto.en_albaranes_sin_factura)} · con IVA
          </p>
        )}
        {ficha && ficha.otros_parecidos.length > 0 && (
          <p className="text-xs text-muted-foreground">Otros con nombre parecido: {ficha.otros_parecidos.join(", ")}.</p>
        )}
      </section>

      {ficha && ficha.top_productos.length > 0 && (
        <section aria-label="Qué le compras" className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Qué le compras <span className="font-normal normal-case tracking-normal">· último precio sin IVA</span>
          </h3>
          <ul className="divide-y divide-border/50 border-y border-border/50">
            {ficha.top_productos.map((t) => (
              <li key={`${t.producto}|${t.unidad ?? ""}`}>
                <button
                  type="button"
                  onClick={() => onAbrirProducto(t.producto)}
                  className="flex min-h-11 w-full items-center gap-3 px-1 py-1.5 text-left hover:bg-muted/40"
                  aria-label={`Ver el producto ${t.producto}`}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.producto}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {t.ultimo_precio !== null ? `${formatCurrency(t.ultimo_precio)}${t.unidad ? `/${t.unidad}` : ""}` : "—"}
                    {t.ultima_fecha ? ` · ${formatDateCorta(t.ultima_fecha)}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Documentos del proveedor" className="space-y-1">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Documentos ({formatEntero(documentos.length)}) <span className="font-normal normal-case tracking-normal">· importes con IVA</span>
        </h3>
        {documentos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ningún documento cargado.</p>
        ) : (
          <ul className="divide-y divide-border/50 border-y border-border/50">
            {documentos.map((d) => (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => onAbrirDocumento(d.id)}
                  className="flex min-h-11 w-full items-center gap-3 px-1 py-1.5 text-left hover:bg-muted/40"
                  aria-label={`Abrir ${d.tipo === "albaran" ? "el albarán" : "la factura"} ${d.numero_documento}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      {d.numero_documento}{" "}
                      <span className="font-normal text-muted-foreground">· {d.tipo === "albaran" ? "Albarán" : "Factura"}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDateCorta(d.fecha)}
                      {esAlbaranSinFactura(d) && " · sin factura"}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">{d.total != null ? formatCurrency(d.total) : "—"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {fusionando && <ProveedoresDialog puedeEditar={puedeEditar} seleccionInicial={[proveedor.id]} onCerrar={() => setFusionando(false)} />}
    </div>
  );
}
