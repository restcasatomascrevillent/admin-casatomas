import { estadoCaducidad, fechaCaducidad } from "@/lib/cheques/caducidad";
import { useHoyCheques } from "@/hooks/useHoyCheques";
import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Search, CheckCircle2, XCircle, Loader2, FileText, Palette, ShieldCheck, Ticket, HandCoins, CreditCard } from "lucide-react";
import { DashboardLayout } from "@/components/DashboardLayout";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
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
import { ListaTickets } from "@/components/cheques/ListaTickets";
import { VistaFacturaCheque } from "@/components/cheques/VistaFacturaCheque";
import { CompraManual } from "@/components/cheques/CompraManual";
import { PlantillaChequeRegalo } from "@/components/cheques/PlantillaChequeRegalo";
import { PanelStripe } from "@/components/cheques/PanelStripe";
import { GastosGestionCheques } from "@/components/cheques/GastosGestionCheques";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";

/**
 * Suelo (px) del alto de la página: por debajo (ventanas muy bajas, teclado abierto en el
 * móvil) deja de encoger y vuelve el scroll de página. El mismo que Newsletter.
 */
const ALTURA_MINIMA_CHEQUES = 360;

/**
 * Contenido de cada pestaña: ocupa el alto que queda bajo la barra y hace scroll por dentro.
 * `data-[state=inactive]:hidden` imprescindible (como en Marketing/Facturas): Radix deja montadas
 * las pestañas inactivas con el atributo `hidden`, y una clase `flex` le gana a ese atributo.
 */
const CONTENIDO_PESTANA = "mt-0 min-h-0 flex-1 overflow-y-auto overscroll-contain data-[state=inactive]:hidden";

// Estas tablas/RPC se incorporan mediante la migración de Cheques.
const db = supabase as unknown as SupabaseClient;
interface Resultado {
  caduca_el?: string | null;
  caducado?: boolean;
  dias_restantes?: number | null;
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
  email_mensaje: string;
}
const vacia: Plantilla = { id: true, emisor_nombre: CASA_TOMAS.nombre, emisor_nif: "", emisor_direccion: CASA_TOMAS.direccion, logo_data: LOGO_CASA_TOMAS, iva_porcentaje: 0, pie: CASA_TOMAS.pie, email_mensaje: "Gracias por tu compra. Adjuntamos la factura de tu cheque regalo de Casa Tomás." };
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
  const hoy = useHoyCheques();
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [pestana, setPestana] = useState("expedicion");
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
  // Alto de la pantalla, sin scroll de página (petición del dueño, 2026-10-07): mismo patrón que
  // Newsletter (`useAlturaDisponible`). La barra de pestañas queda fija y cada pestaña hace scroll
  // por dentro; Expedición crece con las filas de su página, sin scroll interno de tabla. Sin medida
  // (jsdom, primer pintado) cae al layout de siempre, con scroll de página.
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_CHEQUES);

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
    if (!resultado?.valido || caducado || !resultado.codigo || !puedeEditar || ocupado) return;
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
    const limpia = { ...plantilla, email_mensaje: plantilla.email_mensaje.trim(), emisor_nombre: plantilla.emisor_nombre.trim(), emisor_nif: plantilla.emisor_nif.trim(), emisor_direccion: plantilla.emisor_direccion.trim() };
    if (!limpia.email_mensaje || !limpia.emisor_nombre || !limpia.emisor_nif || !limpia.emisor_direccion || !Number.isFinite(limpia.iva_porcentaje) || limpia.iva_porcentaje < 0 || limpia.iva_porcentaje > 100) {
      toast.error("Completa los datos del emisor, el mensaje del email y un IVA entre 0 y 100%."); return;
    }
    setGuardando(true);
    try {
      const { data, error } = await db.from("plantilla_factura_cheques").update({ ...limpia, actualizado_en: new Date().toISOString() }).eq("id", true).select("id").single();
      if (error || !data) throw error || new Error("No se ha guardado la plantilla");
      setPlantilla(limpia); setCambios(false); toast.success("Plantilla de factura guardada");
    } catch (error) { toast.error(mensajeError(error, "guardar la plantilla")); }
    finally { setGuardando(false); }
  }
  const caducado = resultado?.caducado || estadoCaducidad(resultado?.caduca_el, hoy).caducado;
  const puedeCanjear = resultado?.valido && !caducado;
  const estado = !resultado?.encontrado ? "Cheque no encontrado" : resultado.estado !== "pagado" ? "Cheque cancelado o sin pago confirmado" : resultado.usado ? "Este cheque ya está canjeado" : caducado ? "Este cheque está caducado" : puedeCanjear ? "Cheque válido para canjear" : "Cheque no disponible para canjear";

  return <DashboardLayout>
    <div ref={setRaiz} className="flex flex-col" style={alto ? (pestana === "expedicion" ? undefined : { height: alto }) : undefined}>
      <Tabs value={pestana} onValueChange={setPestana} className="flex min-h-0 flex-1 flex-col gap-6">
        <PestanasPagina
          pestanas={[
            { valor: "expedicion", etiqueta: "Expedición de tickets", icono: <Ticket /> },
            { valor: "verificar", etiqueta: "Verificar cheque", icono: <Search /> },
            { valor: "manual", etiqueta: "Compra manual", icono: <HandCoins /> },
            { valor: "regalo", etiqueta: "Configuración", icono: <Palette /> },
            { valor: "plantilla", etiqueta: "Plantilla de factura", icono: <FileText /> },
            { valor: "stripe", etiqueta: "Stripe", icono: <CreditCard /> },
          ]}
        />
        <TabsContent value="expedicion" className="mt-0 min-w-0 data-[state=inactive]:hidden"><ListaTickets /></TabsContent>
        <TabsContent value="manual" forceMount className={CONTENIDO_PESTANA}><CompraManual /></TabsContent>
        <TabsContent value="regalo" className={`${CONTENIDO_PESTANA} space-y-6`}><PlantillaChequeRegalo /><div className="max-w-2xl"><GastosGestionCheques /></div></TabsContent>
        <TabsContent value="stripe" className={CONTENIDO_PESTANA}><PanelStripe /></TabsContent>
        <TabsContent value="verificar" className={`${CONTENIDO_PESTANA} space-y-5 max-w-4xl`}>
          <Card className="rounded-2xl border-[#e5ddd0] shadow-sm overflow-hidden"><CardHeader className="bg-[#faf7f1] border-b border-[#eee7dc] p-5 sm:p-6"><div className="flex items-center gap-4"><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white border border-[#e5ddd0] text-[#795440]"><ShieldCheck className="h-6 w-6" /></div><div><CardTitle className="text-xl sm:text-2xl">Comprobar cheque regalo</CardTitle><p className="text-sm text-muted-foreground mt-1">Introduce el código del email para consultar su importe y disponibilidad.</p></div></div></CardHeader><CardContent className="p-5 sm:p-6">
            <form onSubmit={verificar} className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-2 flex-1 min-w-0"><Label htmlFor="codigo-cheque">Código del cheque</Label><Input id="codigo-cheque" placeholder="CT-XXXXXXXX" value={codigo} maxLength={32} autoComplete="off" autoCapitalize="characters" disabled={ocupado} onChange={e => { setCodigo(e.target.value); setResultado(null); setErrorVerificacion(""); }} className="h-14 rounded-xl uppercase font-mono text-lg tracking-widest bg-muted/20" /></div>
              <Button type="submit" disabled={ocupado || !codigo.trim() || codigo.trim().toUpperCase() === "CT-"} className="w-full sm:w-auto sm:min-w-48 h-14 rounded-xl bg-[#795440] hover:bg-[#654432] text-white shrink-0">{ocupado ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}Verificar cheque</Button>
            </form>
          </CardContent></Card>
          {errorVerificacion && <Card className="border-destructive/50 rounded-2xl"><CardContent className="pt-6"><p role="alert">{errorVerificacion}</p></CardContent></Card>}
          {resultado && <Card className={`rounded-2xl ${puedeCanjear ? "border-emerald-300 bg-emerald-50/40" : "border-destructive/30"}`}><CardContent className="space-y-4 pt-6" role="status" aria-live="polite">
            <h2 className={`flex items-center gap-2 font-semibold ${puedeCanjear ? "text-emerald-700" : "text-destructive"}`}>{puedeCanjear ? <CheckCircle2 /> : <XCircle />}{estado}</h2>
            {resultado.encontrado && <><p className="text-3xl font-semibold">{euro(Number(resultado.importe_eur))}</p><p className="font-mono">{resultado.codigo}</p>{resultado.caduca_el && <div className="text-sm"><p>Válido hasta el {fechaCaducidad(resultado.caduca_el)} (incluido).</p>{!resultado.usado && resultado.estado === "pagado" && <p className="font-semibold">{estadoCaducidad(resultado.caduca_el, hoy).texto}</p>}</div>}{resultado.destinatario_nombre && <p>Para: {resultado.destinatario_nombre}</p>}{resultado.canjeado_en && <p className="text-sm text-muted-foreground">Canjeado el {new Date(resultado.canjeado_en).toLocaleString("es-ES")}</p>}{puedeCanjear && puedeEditar && <Button disabled={ocupado} onClick={() => setConfirmar(true)}>Canjear cheque</Button>}{puedeCanjear && !puedeEditar && <p className="text-sm text-muted-foreground">Necesitas permiso de edición para canjearlo.</p>}</>}
          </CardContent></Card>}
        </TabsContent>
        {/* La vista previa se pega arriba de la REGIÓN de la pestaña (su contenedor de scroll), ya no de la ventana. */}
        <TabsContent value="plantilla" className={CONTENIDO_PESTANA}>
          {cargando ? <p className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Cargando plantilla…</p> : <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start">
            <Card className="rounded-2xl shadow-sm"><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>Personaliza tu factura</CardTitle><p className="text-sm text-muted-foreground mt-2">El logo y los datos de Casa Tomás ya están preparados.</p></div><Palette className="h-5 w-5 text-[#795440] shrink-0" /></div></CardHeader><CardContent>
              {errorCarga && <div className="space-y-3 rounded-lg border border-destructive/40 p-4"><p role="alert">{errorCarga}</p><p className="text-sm text-muted-foreground">Vista previa de la plantilla Casa Tomás. No se han recuperado los datos guardados; la edición está bloqueada hasta restablecer la conexión.</p><Button onClick={() => void cargar()} variant="outline">Reintentar conexión</Button></div>}
              <form onSubmit={guardar} className="space-y-4 mt-4">
                <fieldset disabled={!puedeEditar || guardando || !!errorCarga} className="space-y-4">
                  <p className="text-xs text-muted-foreground">Revisa la razón social y completa el NIF fiscal antes de emitir.</p>
                  <div className="space-y-2"><Label htmlFor="emisor-nombre">Nombre o razón social del emisor</Label><Input id="emisor-nombre" required maxLength={200} value={plantilla.emisor_nombre} onChange={e => cambiar("emisor_nombre", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-nif">NIF / CIF del emisor</Label><Input id="emisor-nif" required maxLength={30} value={plantilla.emisor_nif} onChange={e => cambiar("emisor_nif", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="emisor-direccion">Dirección fiscal completa</Label><Textarea id="emisor-direccion" required maxLength={300} value={plantilla.emisor_direccion} onChange={e => cambiar("emisor_direccion", e.target.value)} /></div>
                  <div className="space-y-2"><Label htmlFor="logo-factura">Logo de la factura</Label><Input id="logo-factura" type="file" accept="image/png,image/jpeg" onChange={e => void logo(e.target.files?.[0])} /><p className="text-xs text-muted-foreground">PNG o JPG, hasta 200 KB.</p>{plantilla.logo_data && <Button type="button" variant="outline" onClick={() => cambiar("logo_data", "")}>Quitar logo</Button>}</div>
                  <div className="space-y-2"><Label htmlFor="iva-factura">IVA incluido en el importe (%)</Label><Input id="iva-factura" type="number" step="0.01" min="0" max="100" required value={plantilla.iva_porcentaje} onChange={e => cambiar("iva_porcentaje", Number(e.target.value))} /><p className="text-xs text-muted-foreground">El total coincide con el pago del cheque. Usa 0 para emitir sin desglose de IVA.</p></div>
                  <div className="space-y-2"><Label htmlFor="pie-factura">Texto al pie</Label><Textarea id="pie-factura" maxLength={500} value={plantilla.pie} onChange={e => cambiar("pie", e.target.value)} /></div>
                  <div className="space-y-2 border-t pt-4"><Label htmlFor="email-factura">Mensaje del email de la factura</Label><Textarea id="email-factura" required rows={5} maxLength={3000} value={plantilla.email_mensaje} onChange={e => cambiar("email_mensaje", e.target.value)} /><p className="text-xs text-muted-foreground">Este mensaje acompaña al PDF adjunto. Se conservan los saltos de línea.</p></div>
                </fieldset>
                <p className="text-sm text-muted-foreground">Si el cliente solicita factura, recibirá un PDF por email después de confirmarse el pago. Los cambios se aplican a las próximas facturas.</p>
                {puedeEditar && <Button type="submit" disabled={guardando || !cambios || !!errorCarga}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar plantilla</Button>}
              </form>
            </CardContent></Card>
            <div className="space-y-3 min-w-0 xl:sticky xl:top-0"><div className="flex justify-between items-center gap-3"><h2 className="text-sm font-medium">Así recibirá su factura el cliente</h2><span className="shrink-0 rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">Ejemplo · 100 €</span></div>
              <VistaFacturaCheque plantilla={plantilla} />
              <Card><CardHeader><CardTitle className="text-base">Mensaje que recibirá el cliente</CardTitle></CardHeader><CardContent><p className="whitespace-pre-wrap break-words text-sm">{plantilla.email_mensaje}</p><p className="mt-4 text-xs text-muted-foreground">Adjunto: Factura-CT-00000001.pdf</p></CardContent></Card>
            </div>
          </div>}
        </TabsContent>
      </Tabs>
    </div>
    <Dialog open={confirmar} onOpenChange={open => !ocupado && setConfirmar(open)}><DialogContent><DialogHeader><DialogTitle>Canjear cheque regalo</DialogTitle><DialogDescription>Vas a utilizar {resultado?.codigo} por {euro(Number(resultado?.importe_eur || 0))}. Después no podrá volver a canjearse.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={ocupado} onClick={() => setConfirmar(false)}>Volver</Button><Button disabled={ocupado || !puedeCanjear} onClick={() => void canjear()}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar canje</Button></DialogFooter></DialogContent></Dialog>
  </DashboardLayout>;
}

