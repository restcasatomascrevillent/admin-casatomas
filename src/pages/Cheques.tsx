import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Search, CheckCircle2, XCircle, Loader2, FileText, Palette, ShieldCheck, ArrowRight } from "lucide-react";
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
import { CASA_TOMAS, LOGO_CASA_TOMAS } from "@/lib/cheques/casaTomas";
import { VistaFacturaCheque } from "@/components/cheques/VistaFacturaCheque";

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
const vacia: Plantilla = { id: true, emisor_nombre: CASA_TOMAS.nombre, emisor_nif: "", emisor_direccion: CASA_TOMAS.direccion, logo_data: LOGO_CASA_TOMAS, iva_porcentaje: 0, pie: CASA_TOMAS.pie };
function mensajeError(error: unknown, accion: string) {
  const detalle = error && typeof error === "object" ? error as { code?: string; message?: string } : {};
  if (["PGRST202", "PGRST205", "42P01", "42883"].includes(detalle.code || "")) {
    return "La configuración de Cheques todavía no está instalada en Supabase. Aplica las migraciones de Cheques en el proyecto jeamoczmbfsnwkfjxcyo y vuelve a intentarlo.";
  }
  if (detalle.code === "42501") return "Tu usuario no tiene permiso para esta operación. Revisa los permisos de Cheques.";
  return detalle.message || `No se pudo ${accion}. Comprueba la conexión y vuelve a intentarlo.`;
}
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export default function Cheques() {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [codigo, setCodigo] = useState("CT-");
  const [errorVerificacion, setErrorVerificacion] = useState("");
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
    try {
      const { data, error } = await db.from("plantilla_factura_cheques").select("*").eq("id", true).single();
      if (error) throw error;
      if (!data) throw new Error("No hay una plantilla guardada o tu usuario no tiene permiso para leerla.");
      setPlantilla({ ...vacia, ...data, emisor_nombre: data.emisor_nombre || vacia.emisor_nombre, emisor_direccion: data.emisor_direccion || vacia.emisor_direccion, logo_data: data.logo_data || ((!data.emisor_nombre && !data.emisor_direccion && !data.emisor_nif) ? vacia.logo_data : ""), pie: data.pie || vacia.pie, iva_porcentaje: Number(data.iva_porcentaje) });
      setCambios(false);
    } catch (error) { setErrorCarga(mensajeError(error, "cargar la plantilla")); }
    finally { setCargando(false); }
  }

  useEffect(() => { void cargar(); }, []);

  async function verificar(e: FormEvent) {
    e.preventDefault();
    const normalizado = codigo.trim().toUpperCase().replace(/\s+/g, "");
    if (!normalizado || normalizado === "CT-") return;
    setOcupado(true); setResultado(null); setErrorVerificacion("");
    try {
      const { data, error } = await db.rpc("verificar_cheque_regalo", { p_codigo: normalizado });
      if (error) throw error;
      setResultado(data as Resultado);
    } catch (e) { setErrorVerificacion(mensajeError(e, "verificar el cheque")); }
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
      toast.error(mensajeError(e, "canjear el cheque"));
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
    } catch (error) { toast.error(mensajeError(error, "guardar la plantilla")); }
    finally { setGuardando(false); }
  }
  function usarCasaTomas() {
    setPlantilla(p => ({ ...p, emisor_nombre: p.emisor_nombre || CASA_TOMAS.nombre, emisor_direccion: p.emisor_direccion || CASA_TOMAS.direccion, logo_data: LOGO_CASA_TOMAS, pie: CASA_TOMAS.pie }));
    setCambios(true);
  }
  const estado = !resultado?.encontrado ? "Cheque no encontrado" : resultado.estado !== "pagado" ? "Cheque cancelado o sin pago confirmado" : resultado.usado ? "Este cheque ya está canjeado" : "Cheque válido para canjear";

  return <DashboardLayout>
    <div className="space-y-6">
      <Tabs defaultValue="verificar">
        <TabsList className="grid w-full max-w-lg grid-cols-2 h-auto rounded-xl p-1.5 bg-muted/60">
          <TabsTrigger value="verificar" className="min-h-11 gap-2 whitespace-normal text-xs sm:text-sm rounded-lg data-[state=active]:shadow-sm"><Search className="h-4 w-4" />Verificar cheque</TabsTrigger>
          <TabsTrigger value="plantilla" className="min-h-11 gap-2 whitespace-normal text-xs sm:text-sm rounded-lg data-[state=active]:shadow-sm"><FileText className="h-4 w-4" />Plantilla de factura</TabsTrigger>
        </TabsList>
        <TabsContent value="verificar" className="mt-6 space-y-4">
          <Card className="max-w-xl rounded-2xl shadow-sm"><CardHeader><div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-[#795440]/10 text-[#795440]"><ShieldCheck className="h-5 w-5" /></div><CardTitle>Comprobar un cheque regalo</CardTitle><p className="text-sm text-muted-foreground">Introduce el código que aparece en el email del cliente.</p></CardHeader><CardContent>
            <form onSubmit={verificar} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="codigo-cheque">Código del cheque</Label><Input id="codigo-cheque" placeholder="CT-XXXXXXXX" value={codigo} maxLength={32} autoComplete="off" autoCapitalize="characters" disabled={ocupado} onChange={e => { setCodigo(e.target.value); setResultado(null); setErrorVerificacion(""); }} className="h-14 rounded-xl uppercase font-mono text-lg tracking-widest bg-muted/20" /></div>
              <Button type="submit" disabled={ocupado || !codigo.trim() || codigo.trim().toUpperCase() === "CT-"} className="w-full h-12 rounded-xl bg-[#795440] hover:bg-[#654432] text-white">{ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Verificar cheque</Button>
            </form>
          </CardContent></Card>
          {errorVerificacion && <Card className="max-w-xl border-destructive/50"><CardContent className="pt-6"><p role="alert">{errorVerificacion}</p></CardContent></Card>}
          {resultado && <Card className={`max-w-xl ${resultado.valido ? "border-emerald-500" : "border-destructive/50"}`}><CardContent className="space-y-4 pt-6" role="status" aria-live="polite">
            <h2 className={`flex items-center gap-2 font-semibold ${resultado.valido ? "text-emerald-700" : "text-destructive"}`}>{resultado.valido ? <CheckCircle2 /> : <XCircle />}{estado}</h2>
            {resultado.encontrado && <><p className="text-3xl font-semibold">{euro(Number(resultado.importe_eur))}</p><p className="font-mono">{resultado.codigo}</p>{resultado.destinatario_nombre && <p>Para: {resultado.destinatario_nombre}</p>}{resultado.canjeado_en && <p className="text-sm text-muted-foreground">Canjeado el {new Date(resultado.canjeado_en).toLocaleString("es-ES")}</p>}{resultado.valido && puedeEditar && <Button disabled={ocupado} onClick={() => setConfirmar(true)}>Canjear cheque</Button>}{resultado.valido && !puedeEditar && <p className="text-sm text-muted-foreground">Necesitas permiso de edición para canjearlo.</p>}</>}
          </CardContent></Card>}
        </TabsContent>
        <TabsContent value="plantilla" className="mt-6">
          {cargando ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Cargando plantilla…</p> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start">
            <Card className="rounded-2xl shadow-sm"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Personaliza tu factura</CardTitle><p className="text-sm text-muted-foreground mt-2">El logo y los datos de Casa Tomás ya están preparados.</p></div><Palette className="h-5 w-5 text-[#795440] shrink-0" /></div></CardHeader><CardContent>
              {errorCarga && <div className="space-y-3 rounded-lg border border-destructive/40 p-4"><p role="alert">{errorCarga}</p><p className="text-sm text-muted-foreground">Vista previa de la plantilla Casa Tomás. No se han recuperado los datos guardados; la edición está bloqueada hasta restablecer la conexión.</p><Button onClick={() => void cargar()} variant="outline">Reintentar conexión</Button></div>}
              <form onSubmit={guardar} className="space-y-4 mt-4">
                <fieldset disabled={!puedeEditar || guardando || !!errorCarga} className="space-y-4">
                  <Button type="button" variant="outline" className="w-full min-h-11 rounded-xl border-[#d8c6b5] text-[#795440]" onClick={usarCasaTomas}><img src={LOGO_CASA_TOMAS} alt="" className="h-7 w-10 object-contain mr-2" />Usar plantilla Casa Tomás<ArrowRight className="h-4 w-4 ml-auto" /></Button>
                  <p className="text-xs text-muted-foreground">Revisa la razón social y completa el NIF fiscal antes de emitir. Los datos fiscales y el IVA que tengas guardados se conservan al aplicar esta plantilla.</p>
                  <div className="space-y-2"><Label htmlFor="emisor-nombre">Nombre o razón social del emisor</Label><Input id="emisor-nombre" required maxLength={200} value={plantilla.emisor_nombre} onChange={e => cambiar("emisor_nombre", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-nif">NIF / CIF del emisor</Label><Input id="emisor-nif" required maxLength={30} value={plantilla.emisor_nif} onChange={e => cambiar("emisor_nif", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-direccion">Dirección fiscal completa</Label><Textarea id="emisor-direccion" required maxLength={300} value={plantilla.emisor_direccion} onChange={e => cambiar("emisor_direccion", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="logo-factura">Logo de la factura</Label><Input id="logo-factura" type="file" accept="image/png,image/jpeg" onChange={e => void logo(e.target.files?.[0])} /><p className="text-xs text-muted-foreground">PNG o JPG, hasta 200 KB.</p>{plantilla.logo_data && <Button type="button" variant="outline" onClick={() => cambiar("logo_data", "")}>Quitar logo</Button>}</div>
                  <div className="space-y-2"><Label htmlFor="iva-factura">IVA incluido en el importe (%)</Label><Input id="iva-factura" type="number" step="0.01" min="0" max="100" required value={plantilla.iva_porcentaje} onChange={e => cambiar("iva_porcentaje", Number(e.target.value))} /><p className="text-xs text-muted-foreground">El total coincide con el pago del cheque. Usa 0 para emitir sin desglose de IVA.</p></div>
                  <div className="space-y-2"><Label htmlFor="pie-factura">Texto al pie</Label><Textarea id="pie-factura" maxLength={500} value={plantilla.pie} onChange={e => cambiar("pie", e.target.value)} /></div>
                </fieldset>
                <p className="text-sm text-muted-foreground">Si el cliente solicita factura, recibirá un PDF por email después de confirmarse el pago. Los cambios se aplican a las próximas facturas.</p>
                {puedeEditar && <Button type="submit" disabled={guardando || !cambios || !!errorCarga}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar plantilla</Button>}
              </form>
            </CardContent></Card>
            <div className="space-y-3 min-w-0 xl:sticky xl:top-6"><div className="flex justify-between items-center gap-3"><h2 className="text-sm font-medium">Así recibirá su factura el cliente</h2><span className="shrink-0 rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">Ejemplo · 100 €</span></div>
              <VistaFacturaCheque plantilla={plantilla} />
            </div>
          </div>}
        </TabsContent>
      </Tabs>
    </div>
    <Dialog open={confirmar} onOpenChange={open => !ocupado && setConfirmar(open)}><DialogContent><DialogHeader><DialogTitle>Canjear cheque regalo</DialogTitle><DialogDescription>Vas a utilizar {resultado?.codigo} por {euro(Number(resultado?.importe_eur || 0))}. Después no podrá volver a canjearse.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={ocupado} onClick={() => setConfirmar(false)}>Volver</Button><Button disabled={ocupado} onClick={() => void canjear()}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar canje</Button></DialogFooter></DialogContent></Dialog>
  </DashboardLayout>;
}

