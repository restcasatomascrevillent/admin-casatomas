import { calcularCaducidad, fechaCaducidad } from "@/lib/cheques/caducidad";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { ChipsSubnivel } from "@/components/panel/ChipsSubnivel";
import { CalendarClock, Loader2, Mail, Palette } from "lucide-react";
import { toast } from "sonner";
import { LOGO_CASA_TOMAS } from "@/lib/cheques/casaTomas";
import { PLANTILLA_REGALO, CHEQUE_EJEMPLO, textoRegalo, errorCheques, type PlantillaRegalo } from "@/lib/cheques/regalo";
import { VistaChequeRegalo } from "./VistaChequeRegalo";
import { OpcionesRegalo } from "./OpcionesRegalo";

const db = supabase as unknown as SupabaseClient;

/** Subpestaña añadida desde fuera (p. ej. los gastos de gestión), con su propio estado y guardado. */
export interface PestanaConfiguracionExtra { valor: string; etiqueta: string; icono?: ReactNode; contenido: ReactNode }

/**
 * Configuración del regalo en subpestañas para no hacer scroll: Correo, Diseño del PDF y Validez editan la
 * MISMA plantilla (un solo estado y un solo guardado, así lo cambiado en una no se pierde al pasar a otra).
 */
export function PlantillaChequeRegalo({ extra }: { extra?: PestanaConfiguracionExtra } = {}) {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [seccion, setSeccion] = useState("correo");
  const [plantilla, setPlantilla] = useState<PlantillaRegalo>(PLANTILLA_REGALO);
  const [cargando, setCargando] = useState(true), [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [ocultarImporte, setOcultarImporte] = useState(false);
  const [incluirDedicatoria, setIncluirDedicatoria] = useState(true);
  const ejemplo = { ...CHEQUE_EJEMPLO, caduca_el: calcularCaducidad(plantilla.caducidad_meses), ocultar_importe: ocultarImporte, mensaje: incluirDedicatoria ? CHEQUE_EJEMPLO.mensaje : null };
  useEffect(() => {
    let activo = true;
    setCargando(true); setError("");
    void (async () => {
      try {
        const { data, error } = await db.from("plantilla_cheques_regalo").select("*").eq("id", true).single();
        if (error || !data) throw error || new Error("No se encontró la plantilla del cheque");
        if (activo) { setPlantilla(Object.fromEntries(Object.keys(PLANTILLA_REGALO).map(k => [k, data[k] ?? PLANTILLA_REGALO[k as keyof PlantillaRegalo]])) as unknown as PlantillaRegalo); setCambios(false); }
      } catch (e) { if (activo) setError(errorCheques(e)); }
      finally { if (activo) setCargando(false); }
    })();
    return () => { activo = false; };
  }, [revision]);
  function cambiar<K extends keyof PlantillaRegalo>(k: K, valor: PlantillaRegalo[K]) { setPlantilla(p => ({ ...p, [k]: valor })); setCambios(true); }
  function subirLogo(file?: File) {
    if (!file) return;
    if (!["image/png","image/jpeg"].includes(file.type) || file.size > 200000) { toast.error("Usa un logo PNG o JPG de hasta 200 KB."); return; }
    const reader = new FileReader(); reader.onload = () => cambiar("logo_data", String(reader.result)); reader.onerror = () => toast.error("No se pudo leer el logo"); reader.readAsDataURL(file);
  }
  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || guardando || error || !cambios) return;
    // Se guarda todo junto: si falta algo de otra subpestaña, se lleva allí al usuario.
    if (!plantilla.email_asunto.trim() || !plantilla.email_mensaje.trim() || !plantilla.pdf_titulo.trim()) { setSeccion(plantilla.pdf_titulo.trim() ? "correo" : "pdf"); toast.error("Completa el asunto, el mensaje y el título del cheque."); return; }
    if (!Number.isInteger(plantilla.caducidad_meses) || plantilla.caducidad_meses < 1 || plantilla.caducidad_meses > 120) { setSeccion("validez"); toast.error("La validez debe ser un número entero entre 1 y 120 meses."); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.from("plantilla_cheques_regalo").update({ ...plantilla, actualizado_en: new Date().toISOString() }).eq("id", true).select("id").single();
      if (error || !data) throw error || new Error("No se ha guardado la plantilla");
      setCambios(false); window.dispatchEvent(new Event("cheques-plantilla-actualizada")); toast.success("Correo y PDF del cheque guardados");
    } catch (e) { toast.error(errorCheques(e)); }
    finally { setGuardando(false); }
  }
  const opciones = <><OpcionesRegalo ocultarImporte={ocultarImporte} incluirDedicatoria={incluirDedicatoria} onImporte={setOcultarImporte} onDedicatoria={setIncluirDedicatoria} /><p className="text-xs text-muted-foreground">Prueba las opciones de cada compra. Estas selecciones solo cambian el ejemplo.</p></>;
  /** Una subpestaña de la plantilla: sus campos a la izquierda y su vista previa a la derecha, con el guardado común. */
  const panel = (valor: string, titulo: string, descripcion: string, campos: ReactNode, vista: ReactNode) =>
    <TabsContent value={valor} className="mt-0"><div className="grid gap-6 xl:grid-cols-2 items-start">
      <Card className="rounded-2xl"><CardHeader><CardTitle>{titulo}</CardTitle><p className="text-sm text-muted-foreground">{descripcion} Los cambios se aplican a los próximos cheques expedidos.</p></CardHeader><CardContent>
        {cargando && <p role="status">Cargando plantilla…</p>}
        {error && <div className="space-y-3 mb-4"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision(r => r + 1)}>Reintentar</Button></div>}
        <form onSubmit={guardar} className="space-y-5">
          <fieldset disabled={!puedeEditar || cargando || guardando || !!error} className="space-y-5">{campos}</fieldset>
          <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!puedeEditar || cargando || guardando || !!error || !cambios}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar correo y PDF</Button>{cambios && <p className="text-xs text-muted-foreground">Guarda a la vez el correo, el diseño del PDF y la validez.</p>}</div>
        </form>
      </CardContent></Card>
      <div className="space-y-4 xl:sticky xl:top-0">{vista}</div>
    </div></TabsContent>;

  return <Tabs value={seccion} onValueChange={setSeccion} className="space-y-4">
    <ChipsSubnivel className="flex-wrap" chips={[
      { valor: "correo", etiqueta: "Correo", icono: <Mail /> },
      { valor: "pdf", etiqueta: "Diseño del PDF", icono: <Palette /> },
      { valor: "validez", etiqueta: "Validez", icono: <CalendarClock /> },
      ...(extra ? [{ valor: extra.valor, etiqueta: extra.etiqueta, icono: extra.icono }] : []),
    ]} />
    {panel("correo", "Correo al comprador", "Lo recibe quien compra el cheque, con el PDF adjunto.", <>
      <div className="space-y-2"><Label htmlFor="regalo-asunto">Asunto del correo</Label><Input id="regalo-asunto" required maxLength={200} value={plantilla.email_asunto} onChange={e => cambiar("email_asunto", e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="regalo-mensaje">Mensaje del correo</Label><Textarea id="regalo-mensaje" rows={8} required maxLength={3000} value={plantilla.email_mensaje} onChange={e => cambiar("email_mensaje", e.target.value)} /><p className="text-xs text-muted-foreground">Puedes usar {"{comprador}"}, {"{destinatario}"}, {"{codigo}"}, {"{importe}"} y {"{caducidad}"}. Se sustituyen por los datos de cada compra.</p></div>
    </>, <>{opciones}<Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Vista previa del correo</CardTitle></CardHeader><CardContent className="space-y-4"><p className="font-medium">{textoRegalo(plantilla.email_asunto, ejemplo, ocultarImporte)}</p><p className="text-sm whitespace-pre-wrap break-words">{textoRegalo(plantilla.email_mensaje, ejemplo, ocultarImporte)}</p><p className="font-mono font-semibold">{CHEQUE_EJEMPLO.codigo}</p>{!ocultarImporte && <p className="text-sm">100,00 €</p>}<p className="text-sm font-semibold">Válido hasta el {fechaCaducidad(ejemplo.caduca_el)} (incluido). Después de esa fecha no podrá canjearse.</p><p className="text-xs text-muted-foreground">Adjunto: Cheque-{CHEQUE_EJEMPLO.codigo}.pdf</p></CardContent></Card></>)}
    {panel("pdf", "Diseño del PDF", "La tarjeta regalo que se adjunta al correo.", <>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="regalo-titulo">Título del cheque</Label><Input id="regalo-titulo" required maxLength={80} value={plantilla.pdf_titulo} onChange={e => cambiar("pdf_titulo", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="regalo-subtitulo">Subtítulo</Label><Input id="regalo-subtitulo" maxLength={160} value={plantilla.pdf_subtitulo} onChange={e => cambiar("pdf_subtitulo", e.target.value)} /></div></div>
      <div className="space-y-2"><Label htmlFor="regalo-logo">Logo del cheque</Label><div className="flex flex-wrap items-center gap-3"><img src={plantilla.logo_data || LOGO_CASA_TOMAS} alt="Logo del cheque" className="h-12 max-w-32 object-contain" /><Input id="regalo-logo" type="file" accept="image/png,image/jpeg" onChange={e => subirLogo(e.target.files?.[0])} className="max-w-xs" /><Button type="button" variant="outline" size="sm" onClick={() => cambiar("logo_data", "")}>Usar logo de Casa Tomás</Button></div><p className="text-xs text-muted-foreground">PNG o JPG de hasta 200 KB. Por defecto se usa el logo de Casa Tomás.</p></div>
      <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="regalo-acento">Color de detalles</Label><Input id="regalo-acento" type="color" value={plantilla.color_acento} onChange={e => cambiar("color_acento", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="regalo-fondo">Color de fondo</Label><Input id="regalo-fondo" type="color" value={plantilla.color_fondo} onChange={e => cambiar("color_fondo", e.target.value)} /></div></div>
      <div className="space-y-2"><Label htmlFor="regalo-instrucciones">Instrucciones de uso</Label><Textarea id="regalo-instrucciones" rows={3} maxLength={800} value={plantilla.pdf_instrucciones} onChange={e => cambiar("pdf_instrucciones", e.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="regalo-pie">Texto al pie del cheque</Label><Textarea id="regalo-pie" rows={2} maxLength={400} value={plantilla.pdf_pie} onChange={e => cambiar("pdf_pie", e.target.value)} /></div>
    </>, <>{opciones}<VistaChequeRegalo cheque={ejemplo} plantilla={plantilla} /></>)}
    {panel("validez", "Validez del cheque", "Cuánto tiempo se puede canjear desde que se emite.", <>
      <div className="space-y-2"><Label htmlFor="regalo-caducidad">Validez del cheque (meses)</Label><Input id="regalo-caducidad" type="number" min="1" max="120" step="1" required value={plantilla.caducidad_meses} onChange={e => cambiar("caducidad_meses", Number(e.target.value))} className="max-w-40" /><p className="text-sm text-muted-foreground">Por defecto: 12 meses (1 año) desde la emisión. Válido hasta el final del día de caducidad, hora de España.</p><p className="text-xs text-muted-foreground">El nuevo plazo se aplica a los próximos cheques. Los ya expedidos conservan su fecha.</p></div>
    </>, <Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Ejemplo</CardTitle></CardHeader><CardContent><p className="text-sm">Un cheque emitido hoy se podrá canjear hasta el <strong>{fechaCaducidad(ejemplo.caduca_el)}</strong> (incluido). La fecha aparece en el correo y en el PDF.</p></CardContent></Card>)}
    {/* forceMount: la subpestaña externa conserva lo que se haya escrito sin guardar al cambiar de chip. */}
    {extra && <TabsContent value={extra.valor} forceMount className="mt-0 data-[state=inactive]:hidden">{extra.contenido}</TabsContent>}
  </Tabs>;
}
