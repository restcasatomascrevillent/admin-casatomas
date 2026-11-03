import { useState } from "react";
import { FileText, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Factura } from "@/hooks/useFacturas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  useCotejoFactura,
  useDesvincularAlbaran,
  useFacturasCandidatas,
  useVincularAlbaran,
} from "@/hooks/useCotejoAlbaranes";
import { formatCurrency, formatDate } from "@/components/facturas/shared/formatters";
import { tonoDiferencia } from "@/lib/facturas/cotejo";
import { EnlaceDocumento } from "./AlbaranesDeFactura";
import { ResumenImportes, TablaCotejo } from "./TablaCotejo";

/** «Asociar a factura»: facturas del mismo proveedor (la que cita el albarán primero). */
function AsociarFactura({ albaranId }: { albaranId: number }) {
  const [abierto, setAbierto] = useState(false);
  const facturasQ = useFacturasCandidatas(albaranId, abierto);
  const vincular = useVincularAlbaran();
  const facturas = facturasQ.data ?? [];
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Button type="button" variant="link" className="h-11 px-1.5">
          Asociar a factura
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-1 p-2">
        <p className="px-1 text-sm font-semibold">Facturas del mismo proveedor</p>
        <div className="max-h-72 overflow-y-auto" role="list" aria-label="Facturas candidatas">
          {facturasQ.isLoading ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">Buscando…</p>
          ) : facturasQ.isError ? (
            <p role="alert" className="px-1 py-3 text-sm text-destructive">No se han podido cargar las facturas.</p>
          ) : facturas.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">No hay facturas de este proveedor.</p>
          ) : (
            facturas.map((f) => (
              <button
                key={f.id}
                type="button"
                role="listitem"
                disabled={vincular.isPending}
                onClick={() => vincular.mutate({ albaranId, facturaId: f.id }, { onSuccess: () => setAbierto(false) })}
                className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium">Factura {f.numero_documento}</span>
                <span className="text-xs text-muted-foreground">{formatDate(f.fecha)}</span>
                <span className="ml-auto tabular-nums">{formatCurrency(f.base)}</span>
                {f.cita_albaran && (
                  <span className="inline-flex h-6 w-full items-center text-[11px] pointer-coarse:text-xs font-medium text-emerald-700 dark:text-emerald-300">
                    Cita este albarán
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Mini-cotejo: las líneas de ESTE albarán contra lo que cobra la factura. */
function MiniCotejo({ facturaId, albaranId }: { facturaId: number; albaranId: number }) {
  const cotejoQ = useCotejoFactura(facturaId, albaranId);
  const cotejo = cotejoQ.data?.disponible ? cotejoQ.data.cotejo : null;
  if (!cotejo) return null;
  const r = cotejo.resumen;
  return (
    <section aria-label="Cotejo del albarán con la factura" className="space-y-1.5 rounded-md border p-2.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cotejo con la factura (sin IVA)</h4>
      <ResumenImportes
        etiquetaAlbaranes="Este albarán"
        sumaAlbaranes={r.suma_albaranes}
        etiquetaFactura="En la factura"
        baseFactura={r.total_factura_base}
        diferencia={r.diferencia}
        tono={tonoDiferencia(r.diferencia, r.suma_albaranes)}
      />
      {cotejo.modo === "por_producto" && (
        <p className="text-xs text-muted-foreground">
          La factura no cita este albarán en sus líneas: se compara con los mismos productos de la factura.
        </p>
      )}
      <TablaCotejo productos={cotejo.productos} etiquetaAlbaranes="Albarán" />
    </section>
  );
}

/**
 * Ficha de ALBARÁN: «Facturado en F-xxx · Ver» (y mini-cotejo de sus líneas
 * con la factura) o «Sin factura · Asociar a factura».
 */
export function FacturaDelAlbaran({
  albaran,
  factura,
  onAbrirDocumento,
}: {
  albaran: Factura;
  /** La factura que lo recoge, si está cargada en la lista. */
  factura: Factura | null;
  onAbrirDocumento: (id: number) => void;
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const desvincular = useDesvincularAlbaran();
  // Solo se ofrece asociar/quitar si la migración del cotejo está (la RPC responde).
  const facturaId = albaran.facturado_en_id ?? null;
  const sondaQ = useCotejoFactura(facturaId, facturaId !== null ? albaran.id : null);
  const disponible = facturaId === null || sondaQ.data?.disponible !== false;

  if (facturaId === null) {
    return (
      <p className="flex min-h-11 flex-wrap items-center gap-x-1.5 rounded-md border px-3 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-muted-foreground">Sin factura</span>
        {puedeEditar && (
          <>
            <span aria-hidden="true" className="text-muted-foreground/60">·</span>
            <AsociarFactura albaranId={albaran.id} />
          </>
        )}
      </p>
    );
  }

  const numero = factura?.numero_documento ?? `#${facturaId}`;
  return (
    <div className="space-y-2">
      <p className="flex min-h-11 flex-wrap items-center gap-x-1.5 rounded-md border pl-3 text-sm">
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>
          Facturado en <span className="font-medium">{numero}</span>
        </span>
        <span aria-hidden="true" className="text-muted-foreground/60">·</span>
        <EnlaceDocumento
          id={facturaId}
          onAbrir={onAbrirDocumento}
          etiqueta={`Ver la factura ${numero}`}
          className="inline-flex min-h-11 items-center px-1.5 font-medium text-primary underline-offset-2 hover:underline"
        >
          Ver
        </EnlaceDocumento>
        {puedeEditar && disponible && (
          <Button
            type="button"
            variant="ghost"
            className="ml-auto h-11 px-3 text-sm text-muted-foreground hover:text-destructive"
            disabled={desvincular.isPending}
            onClick={() => desvincular.mutate(albaran.id)}
            aria-label={`Quitar el vínculo con la factura ${numero}`}
          >
            Quitar
          </Button>
        )}
      </p>
      <MiniCotejo facturaId={facturaId} albaranId={albaran.id} />
    </div>
  );
}
