import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorCheques } from "@/lib/cheques/regalo";
import { calcularGastosGestion, configGastosValida, LIMITES_GASTOS } from "@/lib/cheques/gastosGestion";

const db = supabase as unknown as SupabaseClient;
const euro = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });
const numero = (texto: string) => Number(texto.replace(",", "."));
const EJEMPLOS = [25, 50, 100, 250];

/**
 * Gastos de gestión que la web suma al cobro de cada cheque. Los cobra la
 * función `cheques-regalo-web` de casa-tomas-story leyendo estas columnas de
 * `plantilla_cheques_regalo`; aquí solo se configuran.
 */
export function GastosGestionCheques() {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [activos, setActivos] = useState(false);
  const [porcentaje, setPorcentaje] = useState("1.5"), [fijo, setFijo] = useState("0.25");
  const [cargando, setCargando] = useState(true), [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let activo = true;
    setCargando(true); setError("");
    void (async () => {
      try {
        const { data, error } = await db.from("plantilla_cheques_regalo")
          .select("gastos_gestion_activos, gastos_gestion_porcentaje, gastos_gestion_fijo_eur").eq("id", true).single();
        if (error || !data) throw error || new Error("No se encontró la configuración de los cheques");
        if (activo) {
          setActivos(data.gastos_gestion_activos === true);
          setPorcentaje(String(Number(data.gastos_gestion_porcentaje))); setFijo(String(Number(data.gastos_gestion_fijo_eur)));
          setCambios(false);
        }
      } catch (e) { if (activo) setError(errorCheques(e)); }
      finally { if (activo) setCargando(false); }
    })();
    return () => { activo = false; };
  }, [revision]);

  const config = { activos: true, porcentaje: numero(porcentaje), fijo_eur: numero(fijo) };
  const valida = configGastosValida(config);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || guardando || error || !cambios) return;
    if (!valida) { toast.error(`El porcentaje debe estar entre 0 y ${LIMITES_GASTOS.porcentajeMax - 0.01} % y la parte fija entre 0 y ${LIMITES_GASTOS.fijoMax} €.`); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.from("plantilla_cheques_regalo").update({
        gastos_gestion_activos: activos, gastos_gestion_porcentaje: config.porcentaje, gastos_gestion_fijo_eur: config.fijo_eur,
        actualizado_en: new Date().toISOString(),
      }).eq("id", true).select("id").single();
      if (error || !data) throw error || new Error("No se han guardado los gastos de gestión");
      setCambios(false);
      toast.success(activos ? "Gastos de gestión activados: la web los cobrará en las próximas compras" : "Gastos de gestión desactivados: la web cobra solo el valor del cheque");
    } catch (e) { toast.error(errorCheques(e)); }
    finally { setGuardando(false); }
  }

  return <Card className="rounded-2xl">
    <CardHeader><CardTitle>Gastos de gestión de la compra online</CardTitle><p className="text-sm text-muted-foreground">Se suman al valor del cheque en la web para cubrir la comisión de Stripe. El comprador los ve antes de pagar, en el resumen y en Stripe.</p></CardHeader>
    <CardContent className="space-y-5">
      <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><p>En España no se puede cobrar un recargo por pagar con un medio de pago concreto (art. 35.2 del Real Decreto-ley 19/2018). Estos gastos son iguales para cualquier forma de pago, pero actívalos solo con el visto bueno de tu gestoría, que también debe confirmar cómo tributan en la factura.</p></div>
      {cargando && <p role="status">Cargando gastos de gestión…</p>}
      {error && <div className="space-y-3"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision(r => r + 1)}>Reintentar</Button></div>}
      <form onSubmit={guardar} className="space-y-5">
        <fieldset disabled={!puedeEditar || cargando || guardando || !!error} className="space-y-5">
          <div className="flex items-center justify-between gap-4 rounded-xl border p-4"><Label htmlFor="gastos-activos" className="leading-snug">Cobrar gastos de gestión en la compra online</Label><Switch id="gastos-activos" checked={activos} onCheckedChange={v => { setActivos(v); setCambios(true); }} /></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="gastos-porcentaje">Porcentaje (%)</Label><Input id="gastos-porcentaje" type="number" inputMode="decimal" min="0" max="9.99" step="0.01" required value={porcentaje} onChange={e => { setPorcentaje(e.target.value); setCambios(true); }} /></div>
            <div className="space-y-2"><Label htmlFor="gastos-fijo">Parte fija (€)</Label><Input id="gastos-fijo" type="number" inputMode="decimal" min="0" max="5" step="0.01" required value={fijo} onChange={e => { setFijo(e.target.value); setCambios(true); }} /></div>
          </div>
          <p className="text-xs text-muted-foreground">Por defecto, la tarifa estándar de Stripe para tarjetas europeas: 1,5 % + 0,25 €. Las tarjetas premium o de fuera de Europa cuestan más; en esos pagos los gastos no cubren toda la comisión. La pestaña Stripe muestra lo que cobra de verdad.</p>
          {valida && <div className="rounded-xl bg-[#faf7f1] p-4 text-sm"><p className="font-medium mb-2">Lo que pagaría el comprador</p><table className="w-full"><thead><tr className="text-xs text-muted-foreground text-left"><th className="font-normal pb-1">Cheque</th><th className="font-normal pb-1">Gastos</th><th className="font-normal pb-1 text-right">Total</th></tr></thead><tbody>
            {EJEMPLOS.map(importe => { const gastos = calcularGastosGestion(importe, config); return <tr key={importe}><td>{euro(importe)}</td><td>{euro(gastos)}</td><td className="text-right font-medium">{euro(importe + gastos)}</td></tr>; })}
          </tbody></table></div>}
        </fieldset>
        <Button type="submit" disabled={!puedeEditar || cargando || guardando || !!error || !cambios}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar gastos de gestión</Button>
      </form>
    </CardContent>
  </Card>;
}
