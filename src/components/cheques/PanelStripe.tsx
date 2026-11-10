import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Loader2, CreditCard, CheckCircle2, XCircle, ExternalLink, Receipt, Wallet, Hash, TrendingUp, AlertTriangle, FileBarChart2, ChevronDown, Ticket,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { VERSION_APP } from "@/lib/version";
import { fechasDeRango, hoyLocal, RANGOS, rangoAnterior, serieIngresos, variacionPct, type ClaveRango } from "./stripe/calculos";

// Informe en diapositivas (y su PDF): solo se descarga al abrirlo.
const InformeChequesDialog = lazy(() => import("./informe/InformeChequesDialog"));

const db = supabase as unknown as SupabaseClient;
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const TOOLTIP = { backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px", fontSize: 12 };

interface EstadoStripe {
  configurado: boolean; modo?: "test" | "live"; pais?: string | null; moneda_por_defecto?: string | null;
  cobros_activos?: boolean; payouts_activos?: boolean; detalles_completos?: boolean; nombre_negocio?: string | null; error?: string;
}
interface Metricas {
  pagos: number; bruto_eur: number; comision_eur: number; neto_eur: number; comision_incompleta: boolean;
  // Desde la migración de gastos de gestión; ausentes con el RPC anterior.
  valor_cheques_eur?: number; gastos_gestion_eur?: number; pagos_con_gastos?: number;
  por_hora: { hora: number; pagos: number }[]; por_dia: { dia: string; pagos: number; bruto_eur: number }[];
}

async function mensajeDeError(error: unknown): Promise<string> {
  const e = error as { context?: { json?: () => Promise<{ error?: string }> }; message?: string };
  const cuerpo = await e?.context?.json?.().catch(() => null);
  return cuerpo?.error || e?.message || "No se pudo completar la petición.";
}

async function cargarMetricas(desde: string, hasta: string): Promise<Metricas> {
  const { data, error } = await db.rpc("metricas_cheques_regalo", { p_desde: desde, p_hasta: hasta });
  if (error) throw error;
  return data as Metricas;
}

function FilaEstado({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border p-3 text-sm font-medium ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

/** «+12 %» / «−5 %» frente al periodo anterior (nada si no hay con qué comparar). */
function Variacion({ actual, anterior, invertir = false }: { actual: number; anterior: number | null | undefined; invertir?: boolean }) {
  const v = variacionPct(actual, anterior);
  if (v === null) return null;
  const redondeada = Math.round(v);
  const bueno = invertir ? redondeada < 0 : redondeada > 0;
  const malo = invertir ? redondeada > 0 : redondeada < 0;
  return (
    <p className={`mt-1 text-xs font-medium ${bueno ? "text-emerald-700" : malo ? "text-amber-700" : "text-muted-foreground"}`} title="Frente al periodo anterior de la misma duración">
      {redondeada > 0 ? "+" : redondeada < 0 ? "−" : ""}{Math.abs(redondeada)} % vs. anterior
    </p>
  );
}

function Kpi({ icono, etiqueta, valor, anterior, actual, destacado = false, invertir = false }: {
  icono: React.ReactNode; etiqueta: string; valor: string; actual: number; anterior?: number | null; destacado?: boolean; invertir?: boolean;
}) {
  return (
    <div className={`min-w-0 rounded-xl p-4 ${destacado ? "bg-emerald-50" : "bg-[#faf7f1]"}`}>
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground"><span className="mt-0.5 shrink-0">{icono}</span><span className="min-w-0">{etiqueta}</span></div>
      <p className={`mt-1 truncate text-xl font-semibold sm:text-2xl ${destacado ? "text-emerald-700" : ""}`}>{valor}</p>
      <Variacion actual={actual} anterior={anterior} invertir={invertir} />
    </div>
  );
}

/** De dónde sale lo cobrado y si los gastos de gestión cubren lo que se lleva Stripe. */
function DesgloseGastos({ metricas }: { metricas: Metricas }) {
  const gastos = metricas.gastos_gestion_eur ?? 0;
  const saldo = Math.round((gastos - metricas.comision_eur) * 100) / 100;
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Valor de los cheques vendidos</p><p className="mt-1 text-xl font-semibold">{euro(metricas.valor_cheques_eur ?? 0)}</p></div>
        <div className="rounded-xl border p-4"><p className="text-xs text-muted-foreground">Gastos de gestión cobrados</p><p className="mt-1 text-xl font-semibold">{euro(gastos)}</p><p className="text-xs text-muted-foreground mt-1">{metricas.pagos_con_gastos ?? 0} de {metricas.pagos} pagos</p></div>
        <div className={`rounded-xl border p-4 ${saldo < 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}><p className="text-xs text-muted-foreground">Gastos de gestión − comisión</p><p className={`mt-1 text-xl font-semibold ${saldo < 0 ? "text-amber-800" : "text-emerald-700"}`}>{saldo > 0 ? "+" : ""}{euro(saldo)}</p><p className="text-xs text-muted-foreground mt-1">{saldo < 0 ? "La comisión no la cubren del todo los gastos" : "Los gastos cubren la comisión"}</p></div>
      </div>
      <p className="text-xs text-muted-foreground">Cobrado = valor de los cheques + gastos de gestión. Ganancia neta = cobrado − lo que se lleva Stripe.</p>
    </div>
  );
}

const PASOS_ACTIVACION = [
  { titulo: "Activar la cuenta de Stripe", detalle: "Razón social, NIF/CIF, representante y actividad del negocio.", url: "https://dashboard.stripe.com/settings/account" },
  { titulo: "Cuenta bancaria (IBAN) para los pagos", detalle: "A dónde transfiere Stripe el dinero cobrado.", url: "https://dashboard.stripe.com/settings/payouts" },
  { titulo: "Claves de API en modo Live", detalle: "Sustituyen a las de test (sk_test_… / rk_test_…) en Supabase.", url: "https://dashboard.stripe.com/apikeys" },
  { titulo: "Webhook nuevo en modo Live", detalle: "Mismos eventos que en test, apuntando a stripe-webhook-cheques-regalo.", url: "https://dashboard.stripe.com/webhooks" },
];

function PasosActivacion() {
  return (
    <div className="space-y-3">
      {PASOS_ACTIVACION.map((paso) => (
        <a key={paso.titulo} href={paso.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-lg border border-[#eee7dc] p-3 hover:bg-[#faf7f1] transition-colors">
          <div className="min-w-0"><p className="text-sm font-medium">{paso.titulo}</p><p className="text-xs text-muted-foreground mt-0.5 break-words">{paso.detalle}</p></div>
          <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
        </a>
      ))}
      <p className="text-xs text-muted-foreground pt-1">Esto se hace en el Dashboard de Stripe, no aquí: por seguridad, el CIF, el IBAN y los datos bancarios no se guardan en este panel. El NIF/CIF de tus propias facturas se revisa en «Plantilla de factura».</p>
    </div>
  );
}

/**
 * Cheques › Stripe. Estado de la cuenta (función `stripe-estado-cuenta`, la clave solo vive en el servidor), métricas
 * de los cobros por Stripe con comparación frente al periodo anterior y botón «Generar informe».
 *
 * Arreglos del 10/11/2026 (los cheques ya cobran de verdad en producción):
 *   · El rango se calcula en hora local; antes salía de `toISOString()` (UTC) y de madrugada dejaba fuera el día de hoy.
 *   · Las fechas ya no se salen de la tarjeta en el móvil y hay rangos rápidos (este mes, mes pasado, 30/90 días, año).
 *   · Con la cuenta en producción y todo activo, los «Pasos para pasar a producción» se recogen en un desplegable.
 *   · La gráfica de ingresos enseña todos los días del rango (también los que no hubo ventas) y agrupa por semana o
 *     por mes en rangos largos; antes solo pintaba los días con pagos y desaparecía con un solo día.
 */
export function PanelStripe() {
  const [estado, setEstado] = useState<EstadoStripe | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [errorEstado, setErrorEstado] = useState("");
  const [recarga, setRecarga] = useState(0);
  const [verPasos, setVerPasos] = useState(false);
  const [informeAbierto, setInformeAbierto] = useState(false);

  const hoy = hoyLocal();
  const [rango, setRango] = useState<ClaveRango>("30");
  const inicial = fechasDeRango("30", hoy)!;
  const [desde, setDesde] = useState(inicial.desde);
  const [hasta, setHasta] = useState(inicial.hasta);
  const fechasInvalidas = !desde || !hasta || desde > hasta;
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [anterior, setAnterior] = useState<Metricas | null>(null);
  const [cargandoMetricas, setCargandoMetricas] = useState(true);
  const [errorMetricas, setErrorMetricas] = useState("");

  function elegirRango(clave: ClaveRango) {
    setRango(clave);
    const f = fechasDeRango(clave, hoyLocal());
    if (f) { setDesde(f.desde); setHasta(f.hasta); }
  }

  useEffect(() => {
    let activo = true;
    setCargandoEstado(true); setErrorEstado("");
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke("stripe-estado-cuenta");
        if (error) throw new Error(await mensajeDeError(error));
        if (activo) setEstado(data as EstadoStripe);
      } catch (e) {
        if (activo) setErrorEstado(e instanceof Error ? e.message : "No se pudo consultar Stripe.");
      } finally { if (activo) setCargandoEstado(false); }
    })();
    return () => { activo = false; };
  }, [recarga]);

  useEffect(() => {
    if (fechasInvalidas) { setCargandoMetricas(false); return; }
    let activo = true;
    setCargandoMetricas(true); setErrorMetricas("");
    const previo = rangoAnterior(desde, hasta);
    (async () => {
      try {
        const [actual, antes] = await Promise.all([
          cargarMetricas(desde, hasta),
          // La comparación es un extra: si falla, se enseña el periodo sin ella.
          cargarMetricas(previo.desde, previo.hasta).catch(() => null),
        ]);
        if (activo) { setMetricas(actual); setAnterior(antes); }
      } catch (e) {
        const detalle = e as { code?: string; message?: string };
        if (activo) setErrorMetricas(
          detalle.code === "PGRST202" ? "Falta instalar las métricas de Cheques en Supabase."
            : detalle.code === "42501" ? "Tu usuario no tiene permiso para ver las métricas de Cheques."
            : detalle.message || "No se pudieron cargar las métricas.",
        );
      } finally { if (activo) setCargandoMetricas(false); }
    })();
    return () => { activo = false; };
  }, [desde, hasta, fechasInvalidas]);

  const datosPorHora = useMemo(() => Array.from({ length: 24 }, (_, hora) => ({
    hora: `${hora}h`, pagos: metricas?.por_hora.find((h) => h.hora === hora)?.pagos || 0,
  })), [metricas]);
  const serie = useMemo(() => (metricas && !fechasInvalidas ? serieIngresos(metricas.por_dia, desde, hasta) : null), [metricas, desde, hasta, fechasInvalidas]);

  const cuentaLista = !!estado?.configurado && !estado.error && estado.modo === "live" && !!estado.cobros_activos && !!estado.payouts_activos && !!estado.detalles_completos;
  const enDemo = VERSION_APP.entorno === "demo" || VERSION_APP.entorno === "preview";
  const ticket = metricas && metricas.pagos > 0 ? (metricas.valor_cheques_eur ?? metricas.bruto_eur) / metricas.pagos : 0;
  const ticketAnterior = anterior && anterior.pagos > 0 ? (anterior.valor_cheques_eur ?? anterior.bruto_eur) / anterior.pagos : null;
  const tituloSerie = serie?.agrupacion === "semana" ? "Ingresos por semana" : serie?.agrupacion === "mes" ? "Ingresos por mes" : "Ingresos por día";

  return (
    <div className="min-w-0 space-y-6">
      {/* Estado de la cuenta */}
      <Card className="rounded-2xl border-[#e5ddd0] shadow-sm overflow-hidden">
        <CardHeader className="bg-[#faf7f1] border-b border-[#eee7dc] p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-[#e5ddd0] text-[#795440]"><CreditCard className="h-6 w-6" /></div>
            <div className="min-w-0"><CardTitle className="text-xl sm:text-2xl">Cuenta de Stripe</CardTitle><p className="text-sm text-muted-foreground mt-1">En qué modo está y si puede cobrar y pagar a tu banco.</p></div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 space-y-4">
          {cargandoEstado ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Consultando Stripe…</p>
            : errorEstado ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorEstado}</p><Button variant="outline" size="sm" onClick={() => setRecarga((r) => r + 1)}>Reintentar</Button></div>
            : !estado?.configurado ? (
              <p className="text-sm text-muted-foreground">
                {enDemo
                  ? "En la demo no hay Stripe conectado (a propósito: aquí no se cobra). En producción esta tarjeta enseña el estado de la cuenta real."
                  : "Stripe no está configurado todavía: falta la clave STRIPE_SECRET_KEY en Supabase."}
              </p>
            )
            : estado.error ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{estado.error}</p><Button variant="outline" size="sm" onClick={() => setRecarga((r) => r + 1)}>Reintentar</Button></div>
            : <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${estado.modo === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  {estado.modo === "live" ? "Modo producción (dinero real)" : "Modo de pruebas"}
                </span>
                {estado.nombre_negocio && <span className="text-sm text-muted-foreground">{estado.nombre_negocio}</span>}
                {estado.pais && <span className="text-sm text-muted-foreground">· {estado.pais}{estado.moneda_por_defecto ? ` · ${estado.moneda_por_defecto.toUpperCase()}` : ""}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FilaEstado ok={estado.cobros_activos}>Puede cobrar</FilaEstado>
                <FilaEstado ok={estado.payouts_activos}>Pagos a tu banco activos</FilaEstado>
                <FilaEstado ok={estado.detalles_completos}>Datos de la cuenta completos</FilaEstado>
              </div>
            </>}
          <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="touch-hit inline-flex items-center gap-1.5 text-sm text-[#795440] hover:underline">
            Abrir el Dashboard de Stripe <ExternalLink className="h-3.5 w-3.5" />
          </a>
          {/* Con la cuenta ya en producción y todo activo, los pasos de activación sobran: se recogen. */}
          {!cargandoEstado && !errorEstado && estado?.configurado && !estado.error && (cuentaLista ? (
            <div className="border-t border-[#eee7dc] pt-3">
              <button type="button" onClick={() => setVerPasos((v) => !v)} aria-expanded={verPasos} className="touch-hit inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
                <ChevronDown className={`h-4 w-4 transition-transform ${verPasos ? "rotate-180" : ""}`} />Pasos de activación (ya completados)
              </button>
              {verPasos && <div className="mt-3"><PasosActivacion /></div>}
            </div>
          ) : (
            <div className="border-t border-[#eee7dc] pt-4 space-y-3">
              <h3 className="text-base font-semibold">Pasos para pasar a producción</h3>
              <PasosActivacion />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Métricas */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><CardTitle className="text-base">Métricas de cobros</CardTitle><p className="text-sm text-muted-foreground mt-1">Solo pagos por Stripe; las compras manuales y de cortesía no tienen comisión (salen en el informe).</p></div>
            <Button variant="outline" className="h-11 w-full gap-2 sm:w-auto" onClick={() => setInformeAbierto(true)}>
              <FileBarChart2 className="h-4 w-4" aria-hidden />Generar informe
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,200px)_minmax(0,160px)_minmax(0,160px)] sm:items-end">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="stripe-rango" className="text-xs">Periodo</Label>
              <Select value={rango} onValueChange={(v) => elegirRango(v as ClaveRango)}>
                <SelectTrigger id="stripe-rango" className="h-11 w-full sm:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>{RANGOS.map((r) => <SelectItem key={r.clave} value={r.clave}>{r.etiqueta}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3 sm:contents">
              <div className="min-w-0 space-y-1"><Label htmlFor="stripe-desde" className="text-xs">Desde</Label><Input id="stripe-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => { setRango("personalizado"); setDesde(e.target.value); }} className="h-11 w-full min-w-0 sm:h-9" /></div>
              <div className="min-w-0 space-y-1"><Label htmlFor="stripe-hasta" className="text-xs">Hasta</Label><Input id="stripe-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => { setRango("personalizado"); setHasta(e.target.value); }} className="h-11 w-full min-w-0 sm:h-9" /></div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {fechasInvalidas ? <p role="alert" className="text-sm text-destructive">{!desde || !hasta ? "Elige las dos fechas." : "La fecha «desde» no puede ser posterior a «hasta»."}</p>
            : cargandoMetricas ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Calculando métricas…</p>
            : errorMetricas ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorMetricas}</p></div>
            : !metricas || metricas.pagos === 0 ? <p className="text-sm text-muted-foreground">Sin pagos por Stripe en este rango de fechas.{anterior && anterior.pagos > 0 ? ` En el periodo anterior hubo ${anterior.pagos} (${euro(anterior.bruto_eur)}).` : ""}</p>
            : <>
              {metricas.comision_incompleta && <p className="flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />Algunos pagos no tienen la comisión real guardada: se estima con la tarifa estándar (1,5% + 0,25€).</p>}
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
                <Kpi icono={<Hash className="h-3.5 w-3.5" />} etiqueta="Pagos" valor={String(metricas.pagos)} actual={metricas.pagos} anterior={anterior?.pagos} />
                <Kpi icono={<TrendingUp className="h-3.5 w-3.5" />} etiqueta="Cobrado" valor={euro(metricas.bruto_eur)} actual={metricas.bruto_eur} anterior={anterior?.bruto_eur} />
                <Kpi icono={<Ticket className="h-3.5 w-3.5" />} etiqueta="Cheque medio" valor={euro(ticket)} actual={ticket} anterior={ticketAnterior} />
                <Kpi icono={<Receipt className="h-3.5 w-3.5" />} etiqueta="Se lleva Stripe" valor={euro(metricas.comision_eur)} actual={metricas.comision_eur} anterior={anterior?.comision_eur} invertir />
                <div className="col-span-2 lg:col-span-1"><Kpi icono={<Wallet className="h-3.5 w-3.5" />} etiqueta="Ganancia neta con cheques" valor={euro(metricas.neto_eur)} actual={metricas.neto_eur} anterior={anterior?.neto_eur} destacado /></div>
              </div>
              {metricas.valor_cheques_eur !== undefined && <DesgloseGastos metricas={metricas} />}
              {serie && <div>
                <h3 className="text-sm font-medium mb-2">{tituloSerie}</h3>
                <div className="h-[220px]" data-testid="grafico-ingresos-cheques">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={serie.puntos} margin={{ left: -10, right: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="etiqueta" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} allowDecimals={false} width={50} />
                      <Tooltip
                        cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                        contentStyle={TOOLTIP}
                        labelFormatter={(_, p) => (p?.[0]?.payload as { titulo?: string } | undefined)?.titulo ?? ""}
                        formatter={(v: number, _n, item) => [`${euro(v)} · ${(item?.payload as { pagos?: number } | undefined)?.pagos ?? 0} pagos`, "Cobrado"]}
                      />
                      <Bar dataKey="bruto_eur" fill="#b08968" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>}
              <div>
                <h3 className="text-sm font-medium mb-2">Pagos por hora del día</h3>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datosPorHora} margin={{ left: -20, right: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="hora" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} interval="preserveStartEnd" minTickGap={10} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} allowDecimals={false} />
                      <Tooltip cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }} contentStyle={TOOLTIP} formatter={(v: number) => [v, "Pagos"]} />
                      <Bar dataKey="pagos" fill="#795440" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>}
        </CardContent>
      </Card>

      {informeAbierto && (
        <Suspense fallback={null}>
          <InformeChequesDialog abierto={informeAbierto} onAbiertoChange={setInformeAbierto} />
        </Suspense>
      )}
    </div>
  );
}
