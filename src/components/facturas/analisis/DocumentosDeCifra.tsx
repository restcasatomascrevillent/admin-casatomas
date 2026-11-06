// «Ver documentos»: panel lateral con los documentos que forman una cifra del
// tablero o del explorador (RPC `documentos_de_cifra`).
//
//   · Arriba, la cifra y cuántos documentos; si se conoce la cifra tocada, si
//     CUADRA (debe: la RPC lee la misma tabla de hechos que el explorador).
//   · Lista por fecha (la más reciente primero): fecha, proveedor, nº, tipo,
//     local e importe que aporta (en medidas de línea, el de sus líneas que
//     cuentan). 50 por página con «Cargar más».
//   · Tocar uno abre el visor con su PDF (VisorDocumento), con anterior/siguiente.
import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, FileText, Loader2, TriangleAlert } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatEntero, formatImporte, formatNumero } from "@/components/facturas/shared/formatters";
import { useDocumentosDeCifra } from "@/hooks/useExplorarCompras";
import { formatoValor, infoMedida } from "@/lib/facturas/explorador";
import { textoRango } from "@/lib/facturas/periodoAnalisis";
import { fechaCorta, nombreCorto } from "@/lib/facturas/tableroCompras";
import { cuadra, ETIQUETA_LOCAL, ETIQUETA_TIPO, type PeticionDocumentos } from "@/lib/facturas/documentosCifra";
import { EstadoError, EstadoVacio, Marca } from "@/components/facturas/compras/estilo";
import { VisorDocumento } from "./VisorDocumento";
import { FOCO } from "./piezas";
import { useFocoAlCerrar } from "./desplazar";

// Las marcas de Compras (compras/estilo.tsx): mismo lenguaje visual en las dos pestañas.
const TONO_TIPO = { factura: "neutro", albaran: "sinFactura", abono: "abono" } as const;

export function DocumentosDeCifra({
  peticion,
  onCerrar,
  onIrA,
}: {
  peticion: PeticionDocumentos | null;
  onCerrar: () => void;
  onIrA?: (enlace: string) => void;
}) {
  const q = useDocumentosDeCifra(peticion);
  const [visor, setVisor] = useState<number | null>(null);
  const paginas = q.data?.pages;
  const primera = paginas?.[0];
  const documentos = useMemo(() => (paginas ?? []).flatMap((p) => p.filas), [paginas]);
  const medida = peticion ? infoMedida(peticion.medida) : null;
  const unidad = primera?.unidad ?? null;
  const ok = peticion && primera ? cuadra(peticion.cifra, primera.cifra) : null;
  const rotulo = medida ? `${medida.etiqueta}${medida.iva ? ` ${medida.iva}` : ""}` : "";
  const porLineas = primera?.porLineas ?? false;
  // Se abre por código (sin Trigger): al cerrar, el foco vuelve a la cifra tocada.
  const focoAlCerrar = useFocoAlCerrar(!!peticion);
  // Abonos con «−», como en el resto de Análisis (la RPC los da en positivo).
  const importe = (n: number) => formatImporte(peticion?.medida === "abonos" ? -Math.abs(n) : n);

  const cerrar = (o: boolean) => {
    if (!o) {
      setVisor(null);
      onCerrar();
    }
  };

  return (
    <>
      <Sheet open={!!peticion} onOpenChange={cerrar}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-xl" data-testid="documentos-de-cifra" onCloseAutoFocus={focoAlCerrar}>
          <SheetHeader className="shrink-0 space-y-1 border-b border-border/70 px-4 pb-3 pt-4">
            <SheetTitle className="text-base sm:text-lg">{peticion?.titulo ?? "Documentos"}</SheetTitle>
            <SheetDescription className="text-xs sm:text-sm">
              {peticion?.detalle ? `${peticion.detalle} · ` : ""}
              {peticion?.desde && peticion?.hasta ? textoRango(peticion.desde, peticion.hasta) : "Todo el histórico"}
            </SheetDescription>
            {primera && peticion && (
              <div className="flex flex-wrap items-end gap-x-4 gap-y-1 pt-1">
                <p>
                  <span className="block text-xs text-muted-foreground">{rotulo}</span>
                  <span className="text-2xl font-semibold tabular-nums">{formatoValor(primera.cifra, peticion.medida, unidad)}</span>
                </p>
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium tabular-nums text-foreground">{formatEntero(primera.documentos)}</span>{" "}
                  {primera.documentos === 1 ? "documento" : "documentos"}
                  {peticion.medida === "precio" && primera.cantidadTotal !== null && (
                    <> · {formatImporte(primera.importeTotal)} / {formatNumero(primera.cantidadTotal)} {unidad}</>
                  )}
                </p>
                {ok !== null && (
                  <p
                    className={cn(
                      "flex items-center gap-1 text-xs font-medium",
                      ok ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400",
                    )}
                    role="status"
                  >
                    {ok ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <TriangleAlert className="h-3.5 w-3.5" aria-hidden />}
                    {ok ? "Cuadra con la cifra tocada" : `La cifra tocada era ${formatoValor(peticion.cifra ?? null, peticion.medida, unidad)}`}
                  </p>
                )}
              </div>
            )}
            {porLineas && (
              <p className="text-xs text-muted-foreground">Importe de cada documento = el de sus líneas que entran en la cifra (sin IVA).</p>
            )}
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
            {q.isLoading && (
              <ul className="space-y-1" aria-busy="true" aria-label="Cargando documentos">
                {Array.from({ length: 8 }, (_, i) => (
                  <li key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
                ))}
              </ul>
            )}
            {q.isError && (
              <EstadoError titulo="No se han podido leer los documentos" detalle={(q.error as Error)?.message} onReintentar={() => void q.refetch()} />
            )}
            {primera && documentos.length === 0 && (
              <EstadoVacio icono={<FileText />} titulo="Ningún documento forma esta cifra" texto="Prueba con otro periodo o quita algún filtro." />
            )}
            {documentos.length > 0 && (
              <ol className="space-y-0.5" aria-label="Documentos de la cifra">
                {documentos.map((d, i) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setVisor(i)}
                      className={cn("flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-muted/60", FOCO)}
                      aria-label={`${ETIQUETA_TIPO[d.tipo]} ${d.numero ?? "sin número"} de ${d.proveedor}, ${d.fecha ? fechaCorta(d.fecha) : "sin fecha"}, ${ETIQUETA_LOCAL[d.local]}: aporta ${importe(d.aporta)}. Ver el original`}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="w-[4.5rem] shrink-0 text-xs tabular-nums text-muted-foreground">{d.fecha ? fechaCorta(d.fecha) : "—"}</span>
                      <span className="min-w-0 flex-1">
                        {/* Dos líneas en vez de cortar: en táctil no hay `title` (QA 05/11/2026). */}
                        <span className="line-clamp-2 break-words text-sm font-medium">{nombreCorto(d.proveedor)}</span>
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Marca tono={TONO_TIPO[d.tipo]}>{ETIQUETA_TIPO[d.tipo]}</Marca>
                          {d.local === "touza" && <Marca tono="touza">Touza</Marca>}
                          <span className="truncate">nº {d.numero ?? "—"}</span>
                          {d.cantidad !== null && unidad && <span className="tabular-nums">· {formatNumero(d.cantidad)} {unidad}</span>}
                        </span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block text-sm font-semibold tabular-nums">{importe(d.aporta)}</span>
                        {porLineas && d.total !== null && (
                          <span className="block text-xs tabular-nums text-muted-foreground">de {formatImporte(d.total)}</span>
                        )}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    </button>
                  </li>
                ))}
              </ol>
            )}
            {q.hasNextPage && (
              <div className="flex justify-center p-2">
                <Button type="button" variant="outline" className="h-11" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage}>
                  {q.isFetchingNextPage && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />}
                  Cargar más ({(primera?.documentos ?? 0) - documentos.length} quedan)
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
      <VisorDocumento
        documentos={documentos}
        indice={visor}
        onIndice={(i) => {
          setVisor(i);
          if (i >= documentos.length - 3 && q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        onCerrar={() => setVisor(null)}
        total={primera?.documentos ?? documentos.length}
        onAbrirEnCompras={
          onIrA
            ? (enlace) => {
                setVisor(null);
                onCerrar();
                onIrA(enlace);
              }
            : undefined
        }
      />
    </>
  );
}
