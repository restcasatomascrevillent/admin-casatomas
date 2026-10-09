import { AlertTriangle, EyeOff, FileText, Receipt } from "lucide-react";
import type { Factura } from "@/hooks/useFacturas";
import { formatCurrency, formatDateCorta } from "@/components/facturas/shared/formatters";
import { esAlbaranSinFactura } from "@/lib/facturas/compras";

const ETIQUETA_TIPO: Record<string, string> = { factura: "Factura", albaran: "Albarán" };

/**
 * Compras › Documentos: lista compacta (una fila por factura o albarán). Lo
 * que antes eran dos tablas con sus columnas ahora es una sola lista corta;
 * todo el detalle, las líneas y los botones están en la ficha de la derecha.
 * Cada fila: número · tipo y total en la primera línea, proveedor · fecha en la
 * segunda, y una sola insignia (la más importante).
 */
export function ListaDocumentos({
  documentos,
  avisosPorId,
  seleccionadoId,
  cargando,
  hayFiltros,
  onAbrir,
}: {
  documentos: Factura[];
  avisosPorId: Map<number, unknown[]>;
  seleccionadoId: number | null;
  cargando: boolean;
  hayFiltros: boolean;
  onAbrir: (id: number) => void;
}) {
  if (cargando) return <p className="p-4 text-sm text-muted-foreground">Cargando documentos…</p>;
  if (documentos.length === 0) {
    return (
      <div className="p-6 text-center">
        <FileText className="mx-auto mb-2 h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
        <p className="text-sm font-medium text-muted-foreground">
          {hayFiltros ? "Ningún documento coincide" : "No hay documentos registrados"}
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border/50" aria-label="Documentos">
      {documentos.map((d) => {
        const avisos = (avisosPorId.get(d.id) ?? []).length;
        const abierto = seleccionadoId === d.id;
        // Una sola insignia visible: la más importante (avisos > sin revisar > sin factura).
        // Las demás van en el tooltip de la fila.
        const marcas: { clave: string; texto: string; icono: typeof AlertTriangle; clase: string }[] = [];
        if (avisos > 0) marcas.push({ clave: "avisos", texto: `${avisos} ${avisos === 1 ? "aviso" : "avisos"}`, icono: AlertTriangle, clase: "text-red-700 dark:text-red-400" });
        if (!d.verificada) marcas.push({ clave: "sin-revisar", texto: "Sin revisar", icono: EyeOff, clase: "text-muted-foreground" });
        if (esAlbaranSinFactura(d)) marcas.push({ clave: "sin-factura", texto: "Sin factura", icono: Receipt, clase: "text-amber-700 dark:text-amber-400" });
        const principal = marcas[0];
        const Icono = principal?.icono;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onAbrir(d.id)}
              aria-current={abierto ? "true" : undefined}
              title={marcas.length > 1 ? marcas.map((m) => m.texto).join(" · ") : undefined}
              className={`flex min-h-12 w-full items-center gap-3 px-2 py-1.5 text-left transition-colors hover:bg-muted/40 ${abierto ? "bg-muted/70" : ""}`}
            >
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0 truncate text-sm font-semibold">
                    <span data-numero>{d.numero_documento}</span>
                    <span className="font-normal text-muted-foreground"> · {ETIQUETA_TIPO[d.tipo] ?? d.tipo}</span>
                  </span>
                  {principal && Icono && (
                    <span className={`inline-flex shrink-0 items-center gap-1 text-[11px] font-medium ${principal.clase}`}>
                      <Icono className="h-3 w-3" aria-hidden="true" /> {principal.texto}
                      {marcas.length > 1 && <span className="font-normal text-muted-foreground">+{marcas.length - 1}</span>}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {d.proveedor || "Sin proveedor"} · {formatDateCorta(d.fecha)}
                  {d.productos.length > 0 && ` · ${d.productos.length} línea(s)`}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{d.total != null ? formatCurrency(d.total) : "—"}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
