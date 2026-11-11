import { AlertTriangle, ChevronDown, ExternalLink, Info, Loader2, Pencil, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { iconoCategoria } from "./iconosServicio";
import {
  type LecturaServicio,
  type ServicioContratado,
  TEXTO_CATEGORIA,
  TEXTO_CICLO,
  TEXTO_ERROR,
  aEur,
  combinarMetricas,
  costeVariableDe,
  cuotaMensual,
  fechaCorta,
  formatearEur,
  haceCuanto,
  peorSemaforo,
  sinAclaracion,
  textoImporteConEur,
  textoPrecio,
} from "@/lib/servicios";
import { AvisoClave } from "./AvisoClave";
import { BarraConsumo, ChipSemaforo } from "./BarraConsumo";

interface Props {
  servicio: ServicioContratado;
  lectura: LecturaServicio | null;
  cargando: boolean;
  actualizando: boolean;
  /** No hay API razonable: el consumo se mira en el panel del proveedor. */
  sinLector?: boolean;
  eurPorUsd: number;
  onActualizar: () => void;
  onEditar: () => void;
}

const textoLista = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** La fecha de renovación con su ciclo; null si no hay fecha (gratis, por uso o sin apuntar). */
function textoRenovacion(s: ServicioContratado): string | null {
  const f = fechaCorta(s.renovacion);
  return f ? `${f} (${TEXTO_CICLO[s.ciclo] ?? s.ciclo})` : null;
}

/** «20,00 US$ al mes (≈ 17,88 €)»: el precio del plan y, si no es en euros, su equivalente. */
function textoPrecioConEur(s: ServicioContratado, eurPorUsd: number): string {
  const base = textoPrecio(s);
  const cuota = cuotaMensual(s);
  if (!cuota || cuota.importe <= 0 || cuota.moneda.toUpperCase() === "EUR") return base;
  const importe = s.ciclo === "anual" && s.precio_anual != null ? s.precio_anual : cuota.importe;
  const eur = aEur(importe, cuota.moneda, eurPorUsd);
  return eur == null ? base : `${base} (≈ ${formatearEur(eur)})`;
}

/** Dominios que da la API (Hostinger), con su caducidad. */
function dominiosDe(detalles: Record<string, unknown>): Array<{ dominio: string; caduca: string | null }> {
  const lista = Array.isArray(detalles.dominios) ? detalles.dominios : [];
  return lista.filter(esObjeto).filter((d) => typeof d.dominio === "string").map((d) => ({ dominio: String(d.dominio), caduca: fechaCorta(typeof d.caduca === "string" ? d.caduca : null) }));
}

export function TarjetaServicio({ servicio, lectura, cargando, actualizando, sinLector = false, eurPorUsd, onActualizar, onEditar }: Props) {
  const idTitulo = `servicio-${servicio.proveedor}`;
  const filas = combinarMetricas(servicio, lectura);
  const peor = peorSemaforo(filas);
  const detalles = lectura?.detalles ?? {};
  const avisos = textoLista(detalles.avisos);
  const modo = typeof detalles.modo === "string" ? detalles.modo : null;
  const planDetectado = typeof detalles.plan_detectado === "string" ? detalles.plan_detectado : null;
  const costeDetectado = esObjeto(detalles.coste_mensual_detectado) && typeof detalles.coste_mensual_detectado.importe === "number"
    ? { importe: detalles.coste_mensual_detectado.importe, moneda: String(detalles.coste_mensual_detectado.moneda ?? "EUR") }
    : null;
  const dominios = dominiosDe(detalles);
  const secretoOpcional = typeof detalles.secreto_opcional === "string" ? detalles.secreto_opcional : null;
  const faltaClave = lectura?.error === "falta_secreto";
  const otroError = lectura?.error && !faltaClave ? lectura.error : null;
  const fecha = lectura?.tomado_en ? new Date(lectura.tomado_en) : null;
  const variable = costeVariableDe(lectura);
  const categoria = TEXTO_CATEGORIA[servicio.categoria] ?? null;
  const IconoCat = iconoCategoria(servicio.categoria);
  const renovacion = textoRenovacion(servicio);
  const notasMetricas = filas.filter((f) => f.nota).map((f) => ({ clave: f.clave, texto: `${f.etiqueta}: ${f.nota}` }));
  // A la vista, solo lo que tiene dato; los límites del plan aún sin leer, en «Más detalles».
  const conDato = filas.filter((f) => f.textoValor != null);
  const sinDato = filas.filter((f) => f.textoValor == null);
  // Lo secundario va plegado en «Más detalles» (06/11/2026, «mucho texto»).
  const hayDetalles = Boolean(
    servicio.cuenta || planDetectado || costeDetectado || dominios.length || secretoOpcional || avisos.length || servicio.notas || servicio.fuente_precio || notasMetricas.length || sinDato.length,
  );

  return (
    // tabIndex -1: «Ver» del Resumen la enfoca (borde dorado) tras llevar la vista hasta ella.
    <Card
      id={`tarjeta-${servicio.proveedor}`}
      tabIndex={-1}
      className="flex min-w-0 scroll-mt-4 flex-col outline-none focus:ring-2 focus:ring-gold focus:ring-offset-2 focus:ring-offset-background"
      aria-labelledby={idTitulo}
      role="article"
    >
      <CardHeader className="space-y-2 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id={idTitulo} className="flex min-w-0 items-center gap-2 text-lg font-semibold leading-tight text-foreground">
              <IconoCat className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true">{categoria && <title>{categoria}</title>}</IconoCat>
              <span className="min-w-0 break-words">{servicio.nombre}</span>
            </h2>
            <p className="mt-0.5 break-words text-sm text-muted-foreground">
              Plan <span className="font-medium text-foreground">{servicio.plan || "sin dato"}</span> · {textoPrecioConEur(servicio, eurPorUsd)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {servicio.por_confirmar && (
              <span className="rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200">
                Por confirmar
              </span>
            )}
            {modo && (
              <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium",
                modo === "real" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-900")}>
                {modo === "real" ? "Modo real (cobra de verdad)" : modo === "prueba" ? "Modo prueba" : "Modo desconocido"}
              </span>
            )}
            {faltaClave ? (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">Falta configurar</span>
            ) : peor ? (
              <ChipSemaforo estado={peor} />
            ) : null}
          </div>
        </div>
        {(renovacion || variable) && (
          <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
            {renovacion && (
              <>
                <dt className="text-muted-foreground">Renovación</dt>
                <dd className="min-w-0 break-words">{renovacion}</dd>
              </>
            )}
            {variable && (
              <>
                <dt className="text-muted-foreground">Gasto por uso este mes</dt>
                <dd className="min-w-0 break-words">
                  <span className="font-medium tabular-nums text-foreground">{textoImporteConEur(variable, eurPorUsd)}</span>
                  {variable.origen === "estimado" && <span className="text-muted-foreground"> · en parte estimado</span>}
                </dd>
              </>
            )}
          </dl>
        )}
      </CardHeader>

      <CardContent className="flex min-w-0 flex-1 flex-col gap-3 px-4 pb-3 pt-0 sm:px-5">
        {faltaClave && lectura?.secreto && <AvisoClave secreto={lectura.secreto} />}
        {otroError && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{TEXTO_ERROR[otroError] ?? "No se pudieron leer los datos."}</span>
          </p>
        )}
        {sinLector && !lectura && (
          <p className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Sin lectura automática: el consumo se mira en su panel.</span>
          </p>
        )}
        {cargando && !lectura && !sinLector ? (
          <p className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Leyendo el consumo…
          </p>
        ) : conDato.length > 0 ? (
          <ul className="min-w-0 divide-y divide-border/60" aria-label={`Consumo de ${servicio.nombre}`}>
            {conDato.map((f) => <BarraConsumo key={f.clave} fila={f} compacto />)}
          </ul>
        ) : (
          <p className="py-2 text-sm text-muted-foreground">
            {faltaClave ? "Sin datos de consumo hasta que se configure la clave." : sinDato.length > 0 ? "Aún sin datos de consumo." : "No hay límites de uso apuntados para este servicio."}
          </p>
        )}
        {hayDetalles && (
          <details className="group min-w-0 rounded-md border bg-muted/20" data-testid={`detalles-${servicio.proveedor}`}>
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              Más detalles
              <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="min-w-0 space-y-3 border-t px-3 py-3">
              {(servicio.cuenta || planDetectado || costeDetectado || dominios.length > 0) && (
                <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                  {servicio.cuenta && (
                    <>
                      <dt className="text-muted-foreground">Cuenta</dt>
                      <dd className="min-w-0 break-words">{servicio.cuenta}</dd>
                    </>
                  )}
                  {(planDetectado || costeDetectado) && (
                    <>
                      <dt className="text-muted-foreground">Según la API</dt>
                      <dd className="min-w-0 break-words">
                        {planDetectado && <>plan {planDetectado}</>}
                        {planDetectado && costeDetectado && " · "}
                        {costeDetectado && <>renovaciones: {textoImporteConEur(costeDetectado, eurPorUsd)} al mes</>}
                      </dd>
                    </>
                  )}
                  {dominios.length > 0 && (
                    <>
                      <dt className="text-muted-foreground">Dominios</dt>
                      <dd className="min-w-0 break-words">
                        {dominios.map((d) => `${d.dominio}${d.caduca ? ` (caduca el ${d.caduca})` : ""}`).join(" · ")}
                      </dd>
                    </>
                  )}
                </dl>
              )}
              {secretoOpcional && <AvisoClave secreto={secretoOpcional} opcional />}
              {sinDato.length > 0 && (
                <p className="break-words text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Sin dato todavía:</span>{" "}
                  {sinDato.map((f) => `${sinAclaracion(f.etiqueta)}${f.textoLimite ? ` (límite ${f.textoLimite})` : ""}`).join(" · ")}
                </p>
              )}
              {(avisos.length > 0 || notasMetricas.length > 0) && (
                <ul className="space-y-1 text-xs text-muted-foreground" aria-label={`Avisos y notas de ${servicio.nombre}`}>
                  {avisos.map((a) => <li key={a}>· {a}</li>)}
                  {notasMetricas.map((n) => <li key={n.clave}>· {n.texto}</li>)}
                </ul>
              )}
              {servicio.notas && <p className="break-words text-xs text-muted-foreground">{servicio.notas}</p>}
              {servicio.fuente_precio && (
                <p className="text-xs text-muted-foreground">
                  <a href={servicio.fuente_precio} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
                    Precios oficiales de {servicio.nombre}
                    <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    <span className="sr-only">(se abre en otra pestaña)</span>
                  </a>
                </p>
              )}
            </div>
          </details>
        )}
      </CardContent>

      <CardFooter className="flex min-w-0 flex-col items-stretch gap-2 border-t p-3 sm:p-4">
        <p className="text-xs text-muted-foreground">
          {sinLector && !lectura ? (
            "Sin lectura automática"
          ) : (
            <>
              Leído{" "}
              {fecha ? (
                <time dateTime={lectura!.tomado_en} title={fecha.toLocaleString("es-ES")}>{haceCuanto(lectura!.tomado_en)}</time>
              ) : (
                "todavía ninguna"
              )}
              {lectura?.desde_cache && " · se renueva cada 15 min"}
            </>
          )}
        </p>
        <div className="flex min-w-0 flex-wrap gap-2">
          {!sinLector && (
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 gap-1.5 px-3 sm:flex-none"
              onClick={onActualizar}
              disabled={actualizando}
              aria-label={`Actualizar ahora el consumo de ${servicio.nombre}`}
            >
              <RefreshCw className={cn("h-4 w-4", actualizando && "animate-spin")} aria-hidden="true" />
              Actualizar ahora
            </Button>
          )}
          <Button type="button" variant="outline" className="h-11 flex-1 gap-1.5 px-3 sm:flex-none" onClick={onEditar} aria-label={`Editar el plan de ${servicio.nombre}`}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Editar
          </Button>
          {/* Nombres largos («Loading (dominio, correo y web antigua)»): el botón baja de línea en vez de salirse a 320 px. */}
          {servicio.panel_url && (
            <Button asChild variant="ghost" className="h-auto min-h-11 w-full gap-1.5 whitespace-normal px-3 py-2 text-center sm:ml-auto sm:w-auto">
              <a href={servicio.panel_url} target="_blank" rel="noopener noreferrer">
                <span className="min-w-0 break-words">Panel de {servicio.nombre}</span>
                <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="sr-only">(se abre en otra pestaña)</span>
              </a>
            </Button>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
