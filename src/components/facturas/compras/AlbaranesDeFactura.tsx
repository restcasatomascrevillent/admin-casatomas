import { useDeferredValue, useState, type MouseEvent, type ReactNode } from "react";
import { AlertTriangle, Link2, Plus, Search, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Factura } from "@/hooks/useFacturas";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  useAlbaranesCandidatos,
  useCotejoFactura,
  useDesvincularAlbaran,
  useVincularAlbaran,
} from "@/hooks/useCotejoAlbaranes";
import { formatCurrency, formatDate } from "@/components/facturas/shared/formatters";
import { CLASE_TONO, tonoDiferencia, type Cotejo } from "@/lib/facturas/cotejo";
import { ResumenImportes, TablaCotejo } from "./TablaCotejo";

/** Enlace a la ficha de otro documento: `?doc=<id>` (se puede abrir en otra pestaña) y, con un toque, salto dentro de Compras. */
export function EnlaceDocumento({
  id,
  onAbrir,
  className,
  children,
  etiqueta,
}: {
  id: number;
  onAbrir: (id: number) => void;
  className?: string;
  children: ReactNode;
  etiqueta?: string;
}) {
  const alPulsar = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onAbrir(id);
  };
  return (
    <a href={`?tab=compras&modo=documentos&doc=${id}`} onClick={alPulsar} className={className} aria-label={etiqueta}>
      {children}
    </a>
  );
}

const CHIP = "inline-flex h-6 shrink-0 items-center rounded px-1.5 text-xs font-medium";
const CHIP_CITADO = `${CHIP} bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300`;
const CHIP_NEUTRO = `${CHIP} bg-muted text-muted-foreground`;
const CHIP_AVISO = `${CHIP} bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300`;
const CAJA_AVISO =
  "flex gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200";

/** «Añadir albarán»: candidatos de la RPC (citados primero) y buscador por número o proveedor. */
function AnadirAlbaran({ facturaId }: { facturaId: number }) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const buscado = useDeferredValue(texto);
  const candidatosQ = useAlbaranesCandidatos(facturaId, buscado, abierto);
  const vincular = useVincularAlbaran();
  const candidatos = candidatosQ.data ?? [];
  return (
    <Popover
      open={abierto}
      onOpenChange={(v) => {
        setAbierto(v);
        if (!v) setTexto("");
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" className="h-11 gap-1.5 px-2.5 text-sm font-medium text-primary">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Añadir albarán
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] space-y-2 p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Buscar albarán por número o proveedor"
            placeholder="Número o proveedor…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            className="h-11 pl-9 text-base"
          />
        </div>
        <p className="px-1 text-xs text-muted-foreground">
          {texto.trim()
            ? "Albaranes sin factura que coinciden (de cualquier proveedor)."
            : "Albaranes sin factura del mismo proveedor, de hasta 60 días antes."}
        </p>
        <div className="max-h-72 overflow-y-auto" role="list" aria-label="Albaranes candidatos">
          {candidatosQ.isLoading ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">Buscando…</p>
          ) : candidatosQ.isError ? (
            <p role="alert" className="px-1 py-3 text-sm text-destructive">No se han podido cargar los albaranes.</p>
          ) : candidatos.length === 0 ? (
            <p className="px-1 py-3 text-sm text-muted-foreground">
              {texto.trim() ? "Ningún albarán sin factura coincide." : "No hay albaranes sin factura de este proveedor por estas fechas. Busca por número."}
            </p>
          ) : (
            candidatos.map((c) => (
              <button
                key={c.id}
                type="button"
                role="listitem"
                disabled={vincular.isPending}
                onClick={() =>
                  vincular.mutate(
                    { albaranId: c.id, facturaId, forzar: !c.mismo_proveedor },
                    { onSuccess: () => setAbierto(false) },
                  )
                }
                className="flex min-h-11 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1 text-left text-sm hover:bg-muted disabled:opacity-50"
              >
                <span className="font-medium">Albarán {c.numero_documento}</span>
                <span className="text-xs text-muted-foreground">{formatDate(c.fecha)}</span>
                <span className="ml-auto tabular-nums">{formatCurrency(c.base)}</span>
                <span className="flex w-full flex-wrap gap-1">
                  {c.citado_en_factura && <span className={CHIP_CITADO}>Citado en la factura</span>}
                  {!c.mismo_proveedor && <span className={CHIP_AVISO}>Otro proveedor: {c.proveedor ?? "—"}</span>}
                  <span className={CHIP_NEUTRO}>
                    {c.lineas} {c.lineas === 1 ? "línea" : "líneas"}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function BloqueCotejo({ cotejo }: { cotejo: Cotejo }) {
  const r = cotejo.resumen;
  const conCitados = (r.base_citada_sin_albaran ?? 0) !== 0;
  // Si parte de la factura es de albaranes sin subir, el color lo pone lo que queda sin explicar.
  const tono = tonoDiferencia(conCitados ? r.diferencia_sin_explicar : r.diferencia, r.total_factura_base);
  return (
    <section aria-label="Cotejo de albaranes y factura" className="space-y-1.5 rounded-md border p-2.5">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cotejo (sin IVA)</h4>
      <ResumenImportes
        etiquetaAlbaranes="Albaranes"
        sumaAlbaranes={r.suma_albaranes}
        etiquetaFactura="Factura"
        baseFactura={r.total_factura_base}
        diferencia={r.diferencia}
        tono={conCitados ? null : tono}
      />
      {conCitados && (
        <p className="text-xs text-muted-foreground">
          {formatCurrency(r.base_citada_sin_albaran)} son de albaranes citados sin subir · sin explicar{" "}
          <span className={`font-semibold tabular-nums ${CLASE_TONO[tono]}`} data-tono={tono}>
            {formatCurrency(r.diferencia_sin_explicar)}
          </span>
        </p>
      )}
      <TablaCotejo productos={cotejo.productos} />
    </section>
  );
}

/**
 * Ficha de FACTURA › «Albaranes (N)»: los albaranes que recoge (citado o no en
 * sus líneas, quitar vínculo), «Añadir albarán», aviso de los citados que no
 * están subidos y el cotejo por producto. Sin la migración 20261010110000 se
 * queda en la lista de siempre (facturado_en_id).
 */
export function AlbaranesDeFactura({
  factura,
  albaranesCargados,
  onAbrirDocumento,
}: {
  factura: Factura;
  /** Los albaranes con facturado_en_id = esta factura que ya tiene la lista (por si la RPC no está). */
  albaranesCargados: Factura[];
  onAbrirDocumento: (id: number) => void;
}) {
  const { canAccess: puedeEditar } = useCanAccessSection("facturas", "edit");
  const cotejoQ = useCotejoFactura(factura.id);
  const desvincular = useDesvincularAlbaran();
  const vincular = useVincularAlbaran();
  const disponible = cotejoQ.data?.disponible === true;
  const cotejo = cotejoQ.data?.disponible ? cotejoQ.data.cotejo : null;

  const filas = cotejo
    ? cotejo.albaranes
    : albaranesCargados.map((a) => ({
        id: a.id,
        numero: a.numero_documento,
        fecha: a.fecha,
        base: a.subtotal,
        citado_en_factura: null as boolean | null,
      }));
  const n = filas.length;

  // Sin migración y sin albaranes: nada que enseñar (como antes).
  if (!disponible && n === 0) return null;

  return (
    <section aria-label="Albaranes de la factura" className="space-y-2">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Truck className="h-3.5 w-3.5" aria-hidden="true" /> Albaranes ({n})
        </h3>
        {disponible && puedeEditar && <AnadirAlbaran facturaId={factura.id} />}
      </div>

      {n === 0 ? (
        <p className="text-sm text-muted-foreground">Ningún albarán vinculado a esta factura.</p>
      ) : (
        <ul className="space-y-1">
          {filas.map((a) => (
            <li key={a.id} className="flex min-h-11 items-center rounded-md border">
              <EnlaceDocumento
                id={a.id}
                onAbrir={onAbrirDocumento}
                className="flex min-h-11 min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1 text-sm hover:bg-muted/40"
              >
                <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium">Albarán {a.numero}</span>
                <span className="text-xs text-muted-foreground">{formatDate(a.fecha)}</span>
                {a.citado_en_factura !== null && (
                  <span className={a.citado_en_factura ? CHIP_CITADO : CHIP_NEUTRO}>
                    {a.citado_en_factura ? "Citado" : "No citado"}
                  </span>
                )}
                <span className="ml-auto tabular-nums">{formatCurrency(a.base)}</span>
              </EnlaceDocumento>
              {disponible && puedeEditar && (
                <Button
                  type="button"
                  variant="ghost"
                  className="h-11 w-11 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  aria-label={`Quitar el albarán ${a.numero} de esta factura`}
                  title="Quitar el vínculo (el albarán queda sin factura)"
                  disabled={desvincular.isPending}
                  onClick={() => desvincular.mutate(a.id)}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {cotejo && cotejo.albaranes_no_subidos.length > 0 && (
        <div role="note" className={CAJA_AVISO}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p>
            La factura cita {cotejo.albaranes_no_subidos.length}{" "}
            {cotejo.albaranes_no_subidos.length === 1 ? "albarán que no está subido" : "albaranes que no están subidos"}:{" "}
            <span className="font-medium">{cotejo.albaranes_no_subidos.map((c) => c.numero).join(", ")}</span>{" "}
            <span className="tabular-nums">
              ({formatCurrency(cotejo.albaranes_no_subidos.reduce((s, c) => s + (c.importe ?? 0), 0))})
            </span>
          </p>
        </div>
      )}

      {cotejo && cotejo.albaranes_sin_vincular.length > 0 && (
        <div role="note" className={CAJA_AVISO}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p>Citados en la factura, subidos pero sin vincular a ella:</p>
            <ul className="flex flex-wrap gap-1">
              {cotejo.albaranes_sin_vincular.map((s) => (
                <li key={s.id} className="flex items-center">
                  <EnlaceDocumento id={s.id} onAbrir={onAbrirDocumento} className="inline-flex min-h-11 items-center px-1 font-medium underline-offset-2 hover:underline">
                    {s.numero}
                  </EnlaceDocumento>
                  {puedeEditar && (
                    <Button
                      type="button"
                      variant="link"
                      className="h-11 px-1.5"
                      disabled={vincular.isPending}
                      onClick={() => vincular.mutate({ albaranId: s.id, facturaId: factura.id })}
                      aria-label={`Vincular el albarán ${s.numero} a esta factura`}
                    >
                      Vincular
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {cotejo && cotejo.albaranes.length > 0 && <BloqueCotejo cotejo={cotejo} />}
    </section>
  );
}
