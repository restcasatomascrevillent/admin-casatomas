import { useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, FileText, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { descargarBlob } from "@/components/trafico-web/informe/pdf";
import { useResumenesMes } from "@/hooks/useServicios";
import {
  type InformeMes,
  TEXTO_FALTA,
  TEXTO_ORIGEN,
  informeMes,
  mesAnterior,
  nombreArchivoInforme,
  textoDiferenciaEur,
  textoDiferenciaPct,
  textoMes,
  textoMesCorto,
  ultimosMeses,
} from "@/lib/informeServicios";
import { type ServicioContratado, formatearEur } from "@/lib/servicios";
import { cn } from "@/lib/utils";
import { Bloque } from "./Bloque";
import { csvInformeServicios } from "./generarInformeServicios";

/** Cuántos meses se pueden elegir (las lecturas se guardan 400 días). */
export const MESES_INFORME = 12;

interface Props {
  servicios: ServicioContratado[];
  eurPorUsd: number;
  /** Meter o cambiar el coste de un servicio en el mes del informe. */
  onMeterCoste: (proveedor: string, mes: string) => void;
  hoy?: Date;
}

const TONO_ORIGEN: Record<string, string> = {
  manual: "bg-sky-50 text-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  estimado: "bg-muted text-foreground",
  falta: "bg-amber-50 text-amber-950 dark:bg-amber-950/50 dark:text-amber-100",
  gratis: "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
};

function Origen({ fila }: { fila: InformeMes["filas"][number] }) {
  const texto = fila.origen === "falta" && fila.falta ? TEXTO_FALTA[fila.falta] : TEXTO_ORIGEN[fila.origen];
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", TONO_ORIGEN[fila.origen])}>{texto}</span>;
}

function Cifra({ etiqueta, valor, detalle, tono }: { etiqueta: string; valor: string; detalle?: string | null; tono?: "sube" | "baja" | null }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{etiqueta}</p>
      <p className={cn("text-xl font-bold tabular-nums leading-tight text-foreground", tono === "sube" && "text-amber-800 dark:text-amber-300", tono === "baja" && "text-emerald-800 dark:text-emerald-300")}>
        {valor}
      </p>
      {detalle && <p className="text-xs text-muted-foreground">{detalle}</p>}
    </div>
  );
}

/**
 * Servicios › Costes › «Informe mensual» (10/11/2026): eliges el mes y sale el
 * gasto de cada servicio (lo metido a mano o la estimación), el total, la
 * comparación con el mes anterior y lo que falta por meter. Se descarga en PDF
 * o CSV (Excel). En el móvil, una tarjeta por servicio; desde sm, tabla.
 */
export function InformeMensual({ servicios, eurPorUsd, onMeterCoste, hoy: hoyProp }: Props) {
  const [hoy] = useState(() => hoyProp ?? new Date());
  const meses = useMemo(() => ultimosMeses(hoy, MESES_INFORME), [hoy]);
  // Por defecto, el último mes cerrado (el que tiene factura).
  const [mes, setMes] = useState(meses[1] ?? meses[0]);
  const consultas = useResumenesMes([mes, mesAnterior(mes)]);
  const [actual, previa] = consultas;
  const [generandoPdf, setGenerandoPdf] = useState(false);

  const disponible = actual.data?.disponible !== false;
  const informe = useMemo(() => {
    if (!actual.data?.disponible) return null;
    const anterior = previa.data?.disponible ? previa.data.filas : null;
    return informeMes({ mes, servicios, resumen: actual.data.filas, resumenAnterior: anterior, eurPorUsd, hoy });
  }, [actual.data, previa.data, mes, servicios, eurPorUsd, hoy]);

  const descargarCsv = () => {
    if (!informe) return;
    descargarBlob(csvInformeServicios(informe), `${nombreArchivoInforme(informe.mes)}.csv`);
  };
  const descargarPdf = async () => {
    if (!informe) return;
    setGenerandoPdf(true);
    try {
      const { crearPdfInformeServicios } = await import("./informePdf");
      descargarBlob(await crearPdfInformeServicios(informe), `${nombreArchivoInforme(informe.mes)}.pdf`);
    } catch {
      toast.error("No se pudo generar el PDF.");
    } finally {
      setGenerandoPdf(false);
    }
  };

  const tonoDiferencia = informe?.diferenciaEur == null || informe.diferenciaEur === 0 ? null : informe.diferenciaEur > 0 ? "sube" : "baja";

  return (
    <Bloque
      id="informe-mensual"
      icono={<FileText />}
      titulo="Informe mensual"
      descripcion="Elige un mes: gasto por servicio, total, comparación con el mes anterior y lo que falta por meter. Se descarga en PDF o CSV."
    >
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <div className="min-w-0 flex-[1_1_12rem] space-y-1 sm:max-w-xs">
          <Label htmlFor="informe-mes">Mes</Label>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger id="informe-mes" className="h-11" aria-label="Mes del informe"><SelectValue /></SelectTrigger>
            <SelectContent>
              {meses.map((m, i) => (
                <SelectItem key={m} value={m}>{textoMesCorto(m)}{i === 0 ? " (en curso)" : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-[1_1_14rem] flex-wrap gap-2 sm:flex-none">
          <Button type="button" variant="outline" className="h-11 flex-1 gap-2 sm:flex-none" onClick={() => void descargarPdf()} disabled={!informe || generandoPdf}>
            {generandoPdf ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileDown className="h-4 w-4" aria-hidden="true" />}
            PDF
          </Button>
          <Button type="button" variant="outline" className="h-11 flex-1 gap-2 sm:flex-none" onClick={descargarCsv} disabled={!informe}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> CSV
          </Button>
        </div>
      </div>

      {!disponible ? (
        <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
          Falta aplicar en Supabase la migración 20261122153000_servicios_costes_mes: sin ella no se puede hacer el informe.
        </p>
      ) : actual.isError ? (
        <p role="alert" className="text-sm text-destructive">No se pudo cargar el mes: {actual.error instanceof Error ? actual.error.message : "error desconocido"}.</p>
      ) : !informe ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Preparando el informe de {textoMes(mes)}…
        </p>
      ) : (
        <div className="flex min-w-0 flex-col gap-3" data-testid="informe-mensual" data-mes={informe.mes}>
          <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3">
            <Cifra etiqueta={`Total de ${textoMes(informe.mes)}`} valor={formatearEur(informe.totalEur)} detalle={informe.enCurso ? "Mes en curso: hasta hoy" : null} />
            <Cifra
              etiqueta={textoMesCorto(informe.anterior)}
              valor={informe.totalAnteriorEur == null ? "Sin datos" : formatearEur(informe.totalAnteriorEur)}
            />
            <div className="col-span-2 sm:col-span-1">
              <Cifra
                etiqueta="Frente al mes anterior"
                valor={textoDiferenciaEur(informe.diferenciaEur) ?? "—"}
                detalle={textoDiferenciaPct(informe.diferenciaPct)}
                tono={tonoDiferencia}
              />
            </div>
          </div>

          {/* Móvil: tarjetas. */}
          <ul className="min-w-0 space-y-2 sm:hidden" aria-label={`Gasto por servicio en ${textoMes(informe.mes)}`}>
            {informe.filas.map((f) => (
              <li key={f.proveedor} className="min-w-0 rounded-lg border p-3" data-fila-informe={f.proveedor}>
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <p className="min-w-0 break-words text-sm font-semibold text-foreground">{f.nombre}</p>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-foreground">{formatearEur(f.totalEur)}</p>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Origen fila={f} />
                  {f.anteriorEur != null && <span className="tabular-nums">{textoMesCorto(informe.anterior)}: {formatearEur(f.anteriorEur)}</span>}
                  {f.manualNota && <span className="break-words">{f.manualNota}</span>}
                </div>
                {f.origen !== "gratis" && (
                  <Button type="button" variant="ghost" size="sm" className="mt-1 h-10 gap-1.5 px-2" onClick={() => onMeterCoste(f.proveedor, informe.mes)}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> {f.origen === "manual" ? "Cambiar coste" : "Meter coste"}
                    <span className="sr-only"> de {f.nombre}</span>
                  </Button>
                )}
              </li>
            ))}
          </ul>

          {/* Desde sm: tabla. */}
          <div className="hidden min-w-0 overflow-x-auto rounded-md border sm:block">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Gasto por servicio en {textoMes(informe.mes)}</caption>
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Servicio</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Cuota</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Por uso</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">{textoMesCorto(informe.anterior)}</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Origen</th>
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {informe.filas.map((f) => (
                  <tr key={f.proveedor} data-fila-informe={f.proveedor}>
                    <th scope="row" className="px-3 py-2 text-left font-medium text-foreground">
                      {f.nombre}
                      {f.manualNota && <span className="block text-xs font-normal text-muted-foreground">{f.manualNota}</span>}
                    </th>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{f.fijoEur == null ? "—" : formatearEur(f.fijoEur)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{f.usoEur == null ? "—" : formatearEur(f.usoEur)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-foreground">{formatearEur(f.totalEur)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{f.anteriorEur == null ? "—" : formatearEur(f.anteriorEur)}</td>
                    <td className="px-3 py-2"><Origen fila={f} /></td>
                    <td className="px-3 py-2 text-right">
                      {f.origen !== "gratis" && (
                        <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 px-2" onClick={() => onMeterCoste(f.proveedor, informe.mes)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          <span className="sr-only">{f.origen === "manual" ? "Cambiar" : "Meter"} el coste de {f.nombre}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t bg-muted/30">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">Total</th>
                  <td />
                  <td />
                  <td className="px-3 py-2 text-right font-bold tabular-nums">{formatearEur(informe.totalEur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{informe.totalAnteriorEur == null ? "—" : formatearEur(informe.totalAnteriorEur)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>

          {informe.faltan.length > 0 ? (
            <p className="break-words rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100" data-testid="informe-faltan">
              <span className="font-semibold">Falta por meter ({informe.faltan.length}):</span> {informe.faltan.map((f) => f.nombre).join(", ")}. No suman al total: pulsa el lápiz de cada uno para meter su coste.
            </p>
          ) : (
            <p className="text-sm text-emerald-800 dark:text-emerald-300" data-testid="informe-completo">No falta ningún coste por meter en {textoMes(informe.mes)}.</p>
          )}
          <p className="text-xs text-muted-foreground">
            Si se ha metido a mano el coste de un servicio ese mes, cuenta ese; si no, la cuota del plan (precio actual) más lo gastado por uso según la última lectura del mes.
          </p>
        </div>
      )}
    </Bloque>
  );
}
