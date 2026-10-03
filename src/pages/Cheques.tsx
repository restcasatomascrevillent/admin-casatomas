import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Gift, Search, CheckCircle2, XCircle, Loader2, FileText } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { toast } from "sonner";

// Estas tablas/RPC se incorporan mediante la migración de Cheques.
const db = supabase as unknown as SupabaseClient;
interface Resultado {
  encontrado: boolean;
  codigo?: string;
  importe_eur?: number;
  destinatario_nombre?: string | null;
  estado?: string;
  usado?: boolean;
  valido?: boolean;
  canjeado_en?: string | null;
}
interface Plantilla {
  id: boolean;
  emisor_nombre: string;
  emisor_nif: string;
  emisor_direccion: string;
  logo_data: string;
  iva_porcentaje: number;
  pie: string;
}
const vacia: Plantilla = { id: true, emisor_nombre: "", emisor_nif: "", emisor_direccion: "", logo_data: "", iva_porcentaje: 0, pie: "Importe correspondiente al cheque regalo." };
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export default function Cheques() {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [codigo, setCodigo] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [plantilla, setPlantilla] = useState<Plantilla>(vacia);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false);

  async function cargar() {
    setCargando(true); setErrorCarga("");
    const { data, error } = await db.from("plantilla_factura_cheques").select("*").eq("id", true).single();
    if (error) setErrorCarga("No se pudo cargar la plantilla. Comprueba que la migración de Cheques está aplicada y tienes permiso.");
    else { setPlantilla({ ...data, iva_porcentaje: Number(data.iva_porcentaje) }); setCambios(false); }
    setCargando(false);
  }
  useEffect(() => { void cargar(); }, []);

  async function verificar(e: FormEvent) {
    e.preventDefault();
    const normalizado = codigo.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalizado) return;
    setOcupado(true); setResultado(null);
    try {
      const { data, error } = await db.rpc("verificar_cheque_regalo", { p_codigo: normalizado });
      if (error) throw error;
      setResultado(data as Resultado);
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo verificar el cheque. Inténtalo de nuevo."); }
    finally { setOcupado(false); }
  }
  async function canjear() {
    if (!resultado?.valido || !resultado.codigo || !puedeEditar || ocupado) return;
    setOcupado(true);
    try {
      const { data, error } = await db.rpc("canjear_cheque_regalo", { p_codigo: resultado.codigo });
      if (error) throw error;
      setResultado(data as Resultado); setConfirmar(false);
      toast.success("Cheque canjeado correctamente");
    } catch (e) {
      setConfirmar(false); setResultado(null);
      toast.error(e instanceof Error ? e.message : "No se pudo canjear. Verifica de nuevo: puede haber sido utilizado por otra persona.");
    } finally { setOcupado(false); }
  }
  function cambiar<K extends keyof Plantilla>(k: K, v: Plantilla[K]) {
    setPlantilla(p => ({ ...p, [k]: v })); setCambios(true);
  }
  async function logo(file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 200000) {
      toast.error("Usa un logo PNG o JPG de hasta 200 KB."); return;
    }
    const reader = new FileReader();
    reader.onload = () => cambiar("logo_data", String(reader.result));
    reader.onerror = () => toast.error("No se pudo leer el logo");
    reader.readAsDataURL(file);
  }
  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || guardando || errorCarga) return;
    const limpia = { ...plantilla, emisor_nombre: plantilla.emisor_nombre.trim(), emisor_nif: plantilla.emisor_nif.trim(), emisor_direccion: plantilla.emisor_direccion.trim() };
    if (!limpia.emisor_nombre || !limpia.emisor_nif || !limpia.emisor_direccion || !Number.isFinite(limpia.iva_porcentaje) || limpia.iva_porcentaje < 0 || limpia.iva_porcentaje > 100) {
      toast.error("Completa los datos del emisor y un IVA entre 0 y 100%."); return;
    }
    setGuardando(true);
    try {
      const { data, error } = await db.from("plantilla_factura_cheques").update({ ...limpia, actualizado_en: new Date().toISOString() }).eq("id", true).select("id").single();
      if (error || !data) throw error || new Error("No se ha guardado la plantilla");
      setPlantilla(limpia); setCambios(false); toast.success("Plantilla de factura guardada");
    } catch { toast.error("No se pudo guardar la plantilla"); }
    finally { setGuardando(false); }
  }
  const total = 100;
  const base = Math.round(10000 / (1 + plantilla.iva_porcentaje / 100)) / 100;
  const estado = !resultado?.encontrado ? "Cheque no encontrado" : resultado.estado !== "pagado" ? "Cheque cancelado o sin pago confirmado" : resultado.usado ? "Este cheque ya está canjeado" : "Cheque válido para canjear";

  return <DashboardLayout>
    <div className="space-y-6">
      <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Gift className="h-6 w-6" />Cheques regalo</h1><p className="text-sm text-muted-foreground">Verifica códigos y prepara las facturas de las compras de la web.</p></div>
      <Tabs defaultValue="verificar">
        <TabsList className="grid w-full max-w-lg grid-cols-2 h-auto">
          <TabsTrigger value="verificar" className="min-h-11 gap-2 whitespace-normal text-xs sm:text-sm"><Search className="h-4 w-4" />Verificar cheque</TabsTrigger>
          <TabsTrigger value="plantilla" className="min-h-11 gap-2 whitespace-normal text-xs sm:text-sm"><FileText className="h-4 w-4" />Plantilla de factura</TabsTrigger>
        </TabsList>
        <TabsContent value="verificar" className="mt-6 space-y-4">
          <Card className="max-w-xl"><CardHeader><CardTitle>Comprobar un cheque regalo</CardTitle></CardHeader><CardContent>
            <form onSubmit={verificar} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="codigo-cheque">Código del cheque</Label><Input id="codigo-cheque" placeholder="CT-XXXXXXXX" value={codigo} maxLength={32} autoComplete="off" autoCapitalize="characters" disabled={ocupado} onChange={e => { setCodigo(e.target.value); setResultado(null); }} className="uppercase font-mono" /></div>
              <Button type="submit" disabled={ocupado || !codigo.trim()} className="w-full sm:w-auto">{ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Verificar cheque</Button>
            </form>
          </CardContent></Card>
          {resultado && <Card className={`max-w-xl ${resultado.valido ? "border-emerald-500" : "border-destructive/50"}`}><CardContent className="space-y-4 pt-6" role="status" aria-live="polite">
            <h2 className={`flex items-center gap-2 font-semibold ${resultado.valido ? "text-emerald-700" : "text-destructive"}`}>{resultado.valido ? <CheckCircle2 /> : <XCircle />}{estado}</h2>
            {resultado.encontrado && <><p className="text-3xl font-semibold">{euro(Number(resultado.importe_eur))}</p><p className="font-mono">{resultado.codigo}</p>{resultado.destinatario_nombre && <p>Para: {resultado.destinatario_nombre}</p>}{resultado.canjeado_en && <p className="text-sm text-muted-foreground">Canjeado el {new Date(resultado.canjeado_en).toLocaleString("es-ES")}</p>}{resultado.valido && puedeEditar && <Button disabled={ocupado} onClick={() => setConfirmar(true)}>Canjear cheque</Button>}{resultado.valido && !puedeEditar && <p className="text-sm text-muted-foreground">Necesitas permiso de edición para canjearlo.</p>}</>}
          </CardContent></Card>}
        </TabsContent>
        <TabsContent value="plantilla" className="mt-6">
          {cargando ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Cargando plantilla…</p> : errorCarga ? <Card><CardContent className="space-y-4 pt-6"><p role="alert">{errorCarga}</p><Button onClick={() => void cargar()}>Reintentar</Button></CardContent></Card> : <div className="grid gap-6 xl:grid-cols-2 items-start">
            <Card><CardHeader><CardTitle>Datos de la factura</CardTitle></CardHeader><CardContent>
              <form onSubmit={guardar} className="space-y-4">
                <fieldset disabled={!puedeEditar || guardando} className="space-y-4">
                  <div className="space-y-2"><Label htmlFor="emisor-nombre">Nombre o razón social del emisor</Label><Input id="emisor-nombre" required maxLength={200} value={plantilla.emisor_nombre} onChange={e => cambiar("emisor_nombre", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-nif">NIF / CIF del emisor</Label><Input id="emisor-nif" required maxLength={30} value={plantilla.emisor_nif} onChange={e => cambiar("emisor_nif", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-direccion">Dirección fiscal completa</Label><Textarea id="emisor-direccion" required maxLength={300} value={plantilla.emisor_direccion} onChange={e => cambiar("emisor_direccion", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="logo-factura">Logo de la factura</Label><Input id="logo-factura" type="file" accept="image/png,image/jpeg" onChange={e => void logo(e.target.files?.[0])} /><p className="text-xs text-muted-foreground">PNG o JPG, hasta 200 KB.</p>{plantilla.logo_data && <Button type="button" variant="outline" onClick={() => cambiar("logo_data", "")}>Quitar logo</Button>}</div>
                  <div className="space-y-2"><Label htmlFor="iva-factura">IVA incluido en el importe (%)</Label><Input id="iva-factura" type="number" step="0.01" min="0" max="100" required value={plantilla.iva_porcentaje} onChange={e => cambiar("iva_porcentaje", Number(e.target.value))} /><p className="text-xs text-muted-foreground">El total coincide con el pago del cheque. Usa 0 para emitir sin desglose de IVA.</p></div>
                  <div className="space-y-2"><Label htmlFor="pie-factura">Texto al pie</Label><Textarea id="pie-factura" maxLength={500} value={plantilla.pie} onChange={e => cambiar("pie", e.target.value)} /></div>
                </fieldset>
                <p className="text-sm text-muted-foreground">Si el cliente solicita factura, recibirá un PDF por email después de confirmarse el pago. Los cambios se aplican a las próximas facturas.</p>
                {puedeEditar && <Button type="submit" disabled={guardando || !cambios}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar plantilla</Button>}
              </form>
            </CardContent></Card>
            <div className="space-y-3 min-w-0"><p className="text-sm text-muted-foreground">Vista previa con datos de ejemplo · importe de 100 €</p>
              <article className="rounded-lg border bg-white text-neutral-800 shadow-sm p-5 sm:p-8 space-y-8 break-words" aria-label="Vista previa de factura">
                <header className="flex justify-between gap-4 items-start">{plantilla.logo_data ? <img src={plantilla.logo_data} alt="Logo del emisor" className="max-w-[130px] max-h-[65px] object-contain" /> : <h2 className="text-xl font-bold">CASA TOMÁS</h2>}<div className="text-right"><h2 className="text-2xl font-bold">FACTURA</h2><p className="text-sm">CT-00000001</p><p className="text-xs">{new Date().toLocaleDateString("es-ES")}</p></div></header>
                <div className="grid sm:grid-cols-2 gap-6 text-sm"><div><h3 className="font-semibold text-xs mb-2">EMISOR</h3><p>{plantilla.emisor_nombre || "Razón social del restaurante"}</p><p>NIF: {plantilla.emisor_nif || "NIF del emisor"}</p><p>{plantilla.emisor_direccion || "Dirección fiscal del emisor"}</p></div><div><h3 className="font-semibold text-xs mb-2">CLIENTE · EJEMPLO</h3><p>Nombre del comprador</p><p>NIF: 12345678Z</p><p>Dirección fiscal del comprador</p><p>cliente@ejemplo.com</p></div></div>
                <div className="text-sm"><div className="flex justify-between gap-4 bg-stone-100 p-3 font-semibold"><span>Concepto</span><span>Importe</span></div><div className="flex justify-between gap-4 py-4"><span>Cheque regalo Casa Tomás</span><span className="whitespace-nowrap">{euro(total)}</span></div></div>
                <div className="ml-auto max-w-xs space-y-2 text-sm"><p className="flex justify-between gap-4"><span>Base imponible</span><span>{euro(base)}</span></p>{plantilla.iva_porcentaje > 0 && <p className="flex justify-between gap-4"><span>IVA ({plantilla.iva_porcentaje}%)</span><span>{euro(total - base)}</span></p>}<p className="flex justify-between gap-4 border-t pt-3 font-bold text-lg"><span>TOTAL PAGADO</span><span className="whitespace-nowrap">{euro(total)}</span></p></div>
                <footer className="space-y-3 text-xs text-neutral-600"><p>Pago confirmado mediante Stripe</p><p className="whitespace-pre-wrap">{plantilla.pie}</p></footer>
              </article>
            </div>
          </div>}
        </TabsContent>
      </Tabs>
    </div>
    <Dialog open={confirmar} onOpenChange={open => !ocupado && setConfirmar(open)}><DialogContent><DialogHeader><DialogTitle>Canjear cheque regalo</DialogTitle><DialogDescription>Vas a utilizar {resultado?.codigo} por {euro(Number(resultado?.importe_eur || 0))}. Después no podrá volver a canjearse.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={ocupado} onClick={() => setConfirmar(false)}>Volver</Button><Button disabled={ocupado} onClick={() => void canjear()}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar canje</Button></DialogFooter></DialogContent></Dialog>
  </DashboardLayout>;
}
