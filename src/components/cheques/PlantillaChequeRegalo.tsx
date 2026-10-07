import { useEffect, useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { LOGO_CASA_TOMAS } from "@/lib/cheques/casaTomas";
import { PLANTILLA_REGALO, CHEQUE_EJEMPLO, textoRegalo, errorCheques, type PlantillaRegalo } from "@/lib/cheques/regalo";
import { VistaChequeRegalo } from "./VistaChequeRegalo";

const db = supabase as unknown as SupabaseClient;
export function PlantillaChequeRegalo() {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [plantilla, setPlantilla] = useState<PlantillaRegalo>(PLANTILLA_REGALO);
  const [cargando, setCargando] = useState(true), [guardando, setGuardando] = useState(false);
  const [cambios, setCambios] = useState(false), [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
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
    if (!plantilla.email_asunto.trim() || !plantilla.email_mensaje.trim() || !plantilla.pdf_titulo.trim()) { toast.error("Completa el asunto, el mensaje y el título del cheque."); return; }
    setGuardando(true);
    try {
      const { data, error } = await db.from("plantilla_cheques_regalo").update({ ...plantilla, actualizado_en: new Date().toISOString() }).eq("id", true).select("id").single();
      if (error || !data) throw error || new Error("No se ha guardado la plantilla");
      setCambios(false); toast.success("Correo y PDF del cheque guardados");
    } catch (e) { toast.error(errorCheques(e)); }
    finally { setGuardando(false); }
  }
  return <div className="grid gap-6 xl:grid-cols-2 items-start">
    <Card className="rounded-2xl"><CardHeader><CardTitle>Correo y PDF del cheque</CardTitle><p className="text-sm text-muted-foreground">Personaliza el regalo que recibe el comprador. Los cambios se aplican a los próximos cheques expedidos.</p></CardHeader><CardContent>
      {cargando && <p role="status">Cargando plantilla…</p>}
      {error && <div className="space-y-3 mb-4"><p role="alert" className="text-destructive">{error}</p><Button variant="outline" onClick={() => setRevision(r => r + 1)}>Reintentar</Button></div>}
      <form onSubmit={guardar} className="space-y-5">
        <fieldset disabled={!puedeEditar || cargando || guardando || !!error} className="space-y-5">
          <div className="space-y-2"><Label htmlFor="regalo-asunto">Asunto del correo</Label><Input id="regalo-asunto" required maxLength={200} value={plantilla.email_asunto} onChange={e => cambiar("email_asunto", e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="regalo-mensaje">Mensaje del correo</Label><Textarea id="regalo-mensaje" rows={6} required maxLength={3000} value={plantilla.email_mensaje} onChange={e => cambiar("email_mensaje", e.target.value)} /><p className="text-xs text-muted-foreground">Puedes usar {"{comprador}"}, {"{destinatario}"}, {"{codigo}"} y {"{importe}"}. Se sustituyen por los datos de cada compra.</p></div>
          <div className="border-t pt-5 space-y-5"><h3 className="font-semibold">Diseño del PDF</h3>
            <div className="space-y-2"><Label htmlFor="regalo-titulo">Título del cheque</Label><Input id="regalo-titulo" required maxLength={80} value={plantilla.pdf_titulo} onChange={e => cambiar("pdf_titulo", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="regalo-subtitulo">Subtítulo</Label><Input id="regalo-subtitulo" maxLength={160} value={plantilla.pdf_subtitulo} onChange={e => cambiar("pdf_subtitulo", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="regalo-logo">Logo del cheque</Label><Input id="regalo-logo" type="file" accept="image/png,image/jpeg" onChange={e => subirLogo(e.target.files?.[0])} /><p className="text-xs text-muted-foreground">PNG o JPG de hasta 200 KB. Por defecto se usa el logo de Casa Tomás.</p><img src={plantilla.logo_data || LOGO_CASA_TOMAS} alt="Logo del cheque" className="h-16 max-w-40 object-contain" /><Button type="button" variant="outline" size="sm" onClick={() => cambiar("logo_data", "")}>Usar logo de Casa Tomás</Button></div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-2"><Label htmlFor="regalo-acento">Color de detalles</Label><Input id="regalo-acento" type="color" value={plantilla.color_acento} onChange={e => cambiar("color_acento", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="regalo-fondo">Color de fondo</Label><Input id="regalo-fondo" type="color" value={plantilla.color_fondo} onChange={e => cambiar("color_fondo", e.target.value)} /></div></div>
            <div className="space-y-2"><Label htmlFor="regalo-instrucciones">Instrucciones de uso</Label><Textarea id="regalo-instrucciones" rows={4} maxLength={800} value={plantilla.pdf_instrucciones} onChange={e => cambiar("pdf_instrucciones", e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="regalo-pie">Texto al pie del cheque</Label><Textarea id="regalo-pie" rows={3} maxLength={400} value={plantilla.pdf_pie} onChange={e => cambiar("pdf_pie", e.target.value)} /></div>
          </div>
        </fieldset>
        <Button type="submit" disabled={!puedeEditar || cargando || guardando || !!error || !cambios}>{guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar correo y PDF</Button>
      </form>
    </CardContent></Card>
    <div className="space-y-4 xl:sticky xl:top-0"><VistaChequeRegalo cheque={CHEQUE_EJEMPLO} plantilla={plantilla} /><Card className="rounded-2xl"><CardHeader><CardTitle className="text-base">Vista previa del correo</CardTitle></CardHeader><CardContent className="space-y-4"><p className="font-medium">{textoRegalo(plantilla.email_asunto, CHEQUE_EJEMPLO)}</p><p className="text-sm whitespace-pre-wrap break-words">{textoRegalo(plantilla.email_mensaje, CHEQUE_EJEMPLO)}</p><p className="font-mono font-semibold">{CHEQUE_EJEMPLO.codigo}</p><p className="text-xs text-muted-foreground">Adjunto: Cheque-{CHEQUE_EJEMPLO.codigo}.pdf · Ejemplo de 100 €</p></CardContent></Card></div>
  </div>;
}
