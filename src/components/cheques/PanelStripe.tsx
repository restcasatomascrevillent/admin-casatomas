import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2, CreditCard, CheckCircle2, XCircle, ExternalLink, Receipt, Wallet, Hash, TrendingUp, AlertTriangle,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

const db = supabase as unknown as SupabaseClient;
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
const hoyISO = (offsetDias = 0) => { const d = new Date(); d.setDate(d.getDate() + offsetDias); return d.toISOString().slice(0, 10); };

interface EstadoStripe {
  configurado: boolean; modo?: "test" | "live"; pais?: string | null; moneda_por_defecto?: string | null;
  cobros_activos?: boolean; payouts_activos?: boolean; detalles_completos?: boolean; nombre_negocio?: string | null; error?: string;
}
interface Metricas {
  pagos: number; bruto_eur: number; comision_eur: number; neto_eur: number; comision_incompleta: boolean;
  por_hora: { hora: number; pagos: number }[]; por_dia: { dia: string; pagos: number; bruto_eur: number }[];
}

async function mensajeDeError(error: unknown): Promise<string> {
  const e = error as { context?: { json?: () => Promise<{ error?: string }> }; message?: string };
  const cuerpo = await e?.context?.json?.().catch(() => null);
  return cuerpo?.error || e?.message || "No se pudo completar la petición.";
}

function FilaEstado({ ok, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border p-3 text-sm font-medium ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
      <span>{children}</span>
    </div>
  );
}

const PASOS_ACTIVACION = [
  { titulo: "Activar la cuenta de Stripe", detalle: "Razón social, NIF/CIF, representante y actividad del negocio.", url: "https://dashboard.stripe.com/settings/account" },
  { titulo: "Cuenta bancaria (IBAN) para los pagos", detalle: "A dónde transfiere Stripe el dinero cobrado.", url: "https://dashboard.stripe.com/settings/payouts" },
  { titulo: "Claves de API en modo Live", detalle: "Sustituyen a las de test (sk_test_… / rk_test_…) en Supabase.", url: "https://dashboard.stripe.com/apikeys" },
  { titulo: "Webhook nuevo en modo Live", detalle: "Mismos eventos que en test, apuntando a stripe-webhook-cheques-regalo.", url: "https://dashboard.stripe.com/webhooks" },
];

export function PanelStripe() {
  const [estado, setEstado] = useState<EstadoStripe | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [errorEstado, setErrorEstado] = useState("");
  const [recarga, setRecarga] = useState(0);

  const [desde, setDesde] = useState(hoyISO(-29));
  const [hasta, setHasta] = useState(hoyISO());
  const fechasInvalidas = !!desde && !!hasta && desde > hasta;
  const [metricas, setMetricas] = useState<Metricas | null>(null);
  const [cargandoMetricas, setCargandoMetricas] = useState(true);
  const [errorMetricas, setErrorMetricas] = useState("");

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
    (async () => {
      try {
        const { data, error } = await db.rpc("metricas_cheques_regalo", { p_desde: desde || null, p_hasta: hasta || null });
        if (error) throw error;
        if (activo) setMetricas(data as Metricas);
      } catch (e) {
        const detalle = e as { code?: string; message?: string };
        if (activo) setErrorMetricas(
          detalle.code === "PGRST202" ? "Falta instalar las métricas de Cheques en Supabase." : detalle.message || "No se pudieron cargar las métricas.",
        );
      } finally { if (activo) setCargandoMetricas(false); }
    })();
    return () => { activo = false; };
  }, [desde, hasta, fechasInvalidas]);

  const datosPorHora = Array.from({ length: 24 }, (_, hora) => ({
    hora: `${hora}h`, pagos: metricas?.por_hora.find((h) => h.hora === hora)?.pagos || 0,
  }));

  return (
    <div className="space-y-6">
      {/* Estado de la cuenta */}
      <Card className="rounded-2xl border-[#e5ddd0] shadow-sm overflow-hidden">
        <CardHeader className="bg-[#faf7f1] border-b border-[#eee7dc] p-5 sm:p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-[#e5ddd0] text-[#795440]"><CreditCard className="h-6 w-6" /></div>
            <div><CardTitle className="text-xl sm:text-2xl">Cuenta de Stripe</CardTitle><p className="text-sm text-muted-foreground mt-1">En qué modo está y si puede cobrar y pagar a tu banco.</p></div>
          </div>
        </CardHeader>
        <CardContent className="p-5 sm:p-6 space-y-4">
          {cargandoEstado ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Consultando Stripe…</p>
            : errorEstado ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorEstado}</p><Button variant="outline" size="sm" onClick={() => setRecarga((r) => r + 1)}>Reintentar</Button></div>
            : !estado?.configurado ? <p className="text-sm text-muted-foreground">Stripe no está configurado todavía: falta la clave STRIPE_SECRET_KEY en Supabase.</p>
            : estado.error ? <p role="alert" className="text-sm text-destructive">{estado.error}</p>
            : <>
              <div className="flex flex-wrap items-center gap-3">
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${estado.modo === "live" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                  {estado.modo === "live" ? "Modo producción (dinero real)" : "Modo de pruebas"}
                </span>
                {estado.nombre_negocio && <span className="text-sm text-muted-foreground">{estado.nombre_negocio}</span>}
                {estado.pais && <span className="text-sm text-muted-foreground">· {estado.pais} · {estado.moneda_por_defecto?.toUpperCase()}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <FilaEstado ok={estado.cobros_activos}>Puede cobrar</FilaEstado>
                <FilaEstado ok={estado.payouts_activos}>Pagos a tu banco activos</FilaEstado>
                <FilaEstado ok={estado.detalles_completos}>Datos de la cuenta completos</FilaEstado>
              </div>
            </>}
          <a href="https://dashboard.stripe.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-[#795440] hover:underline">
            Abrir el Dashboard de Stripe <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </CardContent>
      </Card>

      {/* Checklist de activación */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><CardTitle className="text-base">Pasos para pasar a producción</CardTitle><p className="text-sm text-muted-foreground mt-1">Esto se hace en el Dashboard de Stripe, no aquí: por seguridad, el CIF, el IBAN y los datos bancarios no se guardan en este panel.</p></CardHeader>
        <CardContent className="space-y-3">
          {PASOS_ACTIVACION.map((paso) => (
            <a key={paso.titulo} href={paso.url} target="_blank" rel="noreferrer" className="flex items-start justify-between gap-3 rounded-lg border border-[#eee7dc] p-3 hover:bg-[#faf7f1] transition-colors">
              <div className="min-w-0"><p className="text-sm font-medium">{paso.titulo}</p><p className="text-xs text-muted-foreground mt-0.5">{paso.detalle}</p></div>
              <ExternalLink className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
            </a>
          ))}
          <p className="text-xs text-muted-foreground pt-1">El NIF/CIF de tus propias facturas (no el de Stripe) se revisa en la pestaña «Plantilla de factura».</p>
        </CardContent>
      </Card>

      {/* Métricas */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader><div className="flex items-start justify-between gap-3 flex-wrap"><div><CardTitle className="text-base">Métricas de cobros</CardTitle><p className="text-sm text-muted-foreground mt-1">Solo pagos por Stripe; las compras manuales y de cortesía no tienen comisión.</p></div>
          <div className="flex items-end gap-2">
            <div className="space-y-1"><Label htmlFor="stripe-desde" className="text-xs">Desde</Label><Input id="stripe-desde" type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className="h-9 w-[150px]" /></div>
            <div className="space-y-1"><Label htmlFor="stripe-hasta" className="text-xs">Hasta</Label><Input id="stripe-hasta" type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className="h-9 w-[150px]" /></div>
          </div>
        </div></CardHeader>
        <CardContent className="space-y-6">
          {fechasInvalidas ? <p role="alert" className="text-sm text-destructive">La fecha «desde» no puede ser posterior a «hasta».</p>
            : cargandoMetricas ? <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Calculando métricas…</p>
            : errorMetricas ? <div className="space-y-3"><p role="alert" className="text-sm text-destructive">{errorMetricas}</p></div>
            : !metricas || metricas.pagos === 0 ? <p className="text-sm text-muted-foreground">Sin pagos por Stripe en este rango de fechas.</p>
            : <>
              {metricas.comision_incompleta && <p className="flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />Algunos pagos no tienen la comisión real guardada: se estima con la tarifa estándar (1,5% + 0,25€).</p>}
              <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
                <div className="rounded-xl bg-[#faf7f1] p-4"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Hash className="h-3.5 w-3.5" />Pagos</div><p className="mt-1 text-2xl font-semibold">{metricas.pagos}</p></div>
                <div className="rounded-xl bg-[#faf7f1] p-4"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><TrendingUp className="h-3.5 w-3.5" />Ingresos brutos</div><p className="mt-1 text-2xl font-semibold">{euro(metricas.bruto_eur)}</p></div>
                <div className="rounded-xl bg-[#faf7f1] p-4"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Receipt className="h-3.5 w-3.5" />Comisión Stripe</div><p className="mt-1 text-2xl font-semibold">{euro(metricas.comision_eur)}</p></div>
                <div className="rounded-xl bg-emerald-50 p-4"><div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" />Ganancia neta</div><p className="mt-1 text-2xl font-semibold text-emerald-700">{euro(metricas.neto_eur)}</p></div>
              </div>
              <div>
                <h3 className="text-sm font-medium mb-2">Pagos por hora del día</h3>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={datosPorHora} margin={{ left: -20, right: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="hora" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} interval={1} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} formatter={(v: number) => [v, "Pagos"]} />
                      <Bar dataKey="pagos" fill="#795440" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {metricas.por_dia.length > 1 && <div>
                <h3 className="text-sm font-medium mb-2">Ingresos por día</h3>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={metricas.por_dia.map((d) => ({ ...d, diaCorto: d.dia.slice(5).split("-").reverse().join("/") }))} margin={{ left: -10, right: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="diaCorto" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "8px" }} formatter={(v: number) => [euro(v), "Ingresos"]} />
                      <Bar dataKey="bruto_eur" fill="#b08968" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>}
            </>}
        </CardContent>
      </Card>
    </div>
  );
}
