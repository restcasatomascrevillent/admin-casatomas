import { useState, type FormEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, CheckCircle2 } from "lucide-react";
import { errorCheques, type ChequeRegalo } from "@/lib/cheques/regalo";
import { VistaChequeRegalo } from "./VistaChequeRegalo";

const inicial = { importe_eur: "100", comprador_nombre: "", comprador_email: "", comprador_telefono: "", destinatario_nombre: "", mensaje: "", fecha_entrega_deseada: "", pago_manual_metodo: "efectivo", ocultar_importe: false };

export function CompraManual() {
  const { canAccess: puedeEditar } = useCanAccessSection("cheques", "edit");
  const [datos, setDatos] = useState(inicial);
  const [confirmado, setConfirmado] = useState(false);
  const [solicitud, setSolicitud] = useState<string | null>(null);
  const [cheque, setCheque] = useState<ChequeRegalo | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [emailEnviado, setEmailEnviado] = useState(false);
  const [error, setError] = useState("");
  function cambiar(campo: keyof typeof inicial, valor: string | boolean) { setDatos(d => ({ ...d, [campo]: valor })); }
  async function expedir(e: FormEvent) {
    e.preventDefault();
    if (!puedeEditar || ocupado || !confirmado || cheque) return;
    const id = solicitud || crypto.randomUUID();
    setSolicitud(id); setOcupado(true); setError("");
    try {
      const { data, error } = await (supabase as unknown as SupabaseClient).rpc("crear_cheque_manual", {
        p_solicitud_id: id, p_datos: { ...datos, importe_eur: Number(datos.importe_eur) },
      });
      if (error || !data?.codigo) throw error || new Error("No se ha podido confirmar la expedición");
      setCheque(data as ChequeRegalo);
      await enviar(data.id);
    } catch (e) {
      const code = (e as { code?: string })?.code || "";
      // Los errores de validación/permiso revierten la transacción; se pueden corregir los datos.
      // Ante una interrupción de red mantenemos la referencia para consultar la misma compra.
      if (code.startsWith("22") || ["P0001", "42501", "PGRST202"].includes(code)) setSolicitud(null);
      setError(errorCheques(e));
    }
    finally { setOcupado(false); }
  }
  async function enviar(id: string) {
    const { data, error } = await supabase.functions.invoke("cheques-regalo-admin", { body: { accion: "enviar_manual", id } });
    if (error || !data?.email_enviado) {
      setError("El cheque está expedido. No se ha confirmado el envío del correo; puedes reintentarlo sin generar otro código.");
      setEmailEnviado(false);
    } else { setError(""); setEmailEnviado(true); }
  }
  async function reintentarEmail() {
    if (!cheque || ocupado) return;
    setOcupado(true);
    try { await enviar(cheque.id); } catch { setError("No se ha confirmado el envío del correo. Vuelve a intentarlo."); }
    finally { setOcupado(false); }
  }
  if (cheque) return <div className="grid gap-6 xl:grid-cols-2 items-start">
    <Card className="rounded-2xl"><CardHeader><CardTitle className="flex gap-2 items-center"><CheckCircle2 className="text-emerald-600" />Cheque expedido</CardTitle></CardHeader><CardContent className="space-y-4">
      <p className="text-2xl font-mono font-semibold">{cheque.codigo}</p>
      <p>{Number(cheque.importe_eur).toLocaleString("es-ES", { style: "currency", currency: "EUR" })} · {cheque.comprador_nombre}</p>
      <p className="text-sm break-words">{emailEnviado ? `Correo y PDF enviados a ${cheque.comprador_email}.` : "El código ya se puede verificar y canjear."}</p>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-3">{!emailEnviado && <Button disabled={ocupado} onClick={() => void reintentarEmail()}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Reintentar envío</Button>}<Button variant="outline" disabled={ocupado} onClick={() => { setCheque(null); setSolicitud(null); setDatos(inicial); setConfirmado(false); setError(""); setEmailEnviado(false); }}>Nueva compra</Button></div>
    </CardContent></Card>
    <VistaChequeRegalo cheque={cheque} />
  </div>;
  return <Card className="max-w-3xl rounded-2xl"><CardHeader><CardTitle>Compra manual</CardTitle><p className="text-sm text-muted-foreground">Registra una compra cobrada en el restaurante o un cheque de cortesía. Se generará un código y se enviará el regalo por email con su PDF.</p></CardHeader><CardContent>
    {!puedeEditar && <p className="mb-4 text-sm text-muted-foreground">Necesitas permiso de edición de Cheques para expedir una compra.</p>}
    <form onSubmit={expedir} className="space-y-5">
      <fieldset disabled={!puedeEditar || ocupado || !!solicitud} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="manual-importe">Importe (€)</Label><Input id="manual-importe" type="number" min="10" max="1000" step="0.01" required value={datos.importe_eur} onChange={e => cambiar("importe_eur", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="manual-metodo">Método de pago</Label><select id="manual-metodo" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={datos.pago_manual_metodo} onChange={e => { cambiar("pago_manual_metodo", e.target.value); setConfirmado(false); }}><option value="efectivo">Efectivo</option><option value="tarjeta">Tarjeta</option><option value="transferencia">Transferencia</option><option value="cortesia">Cortesía</option></select></div></div>
        <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="manual-nombre">Nombre del comprador</Label><Input id="manual-nombre" required maxLength={200} value={datos.comprador_nombre} onChange={e => cambiar("comprador_nombre", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="manual-email">Email del comprador</Label><Input id="manual-email" type="email" required maxLength={320} value={datos.comprador_email} onChange={e => cambiar("comprador_email", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="manual-telefono">Teléfono del comprador</Label><Input id="manual-telefono" type="tel" maxLength={40} value={datos.comprador_telefono} onChange={e => cambiar("comprador_telefono", e.target.value)} /></div><div className="space-y-2"><Label htmlFor="manual-destinatario">Nombre del destinatario</Label><Input id="manual-destinatario" maxLength={200} value={datos.destinatario_nombre} onChange={e => cambiar("destinatario_nombre", e.target.value)} /></div></div>
        <div className="space-y-2"><Label htmlFor="manual-mensaje">Dedicatoria</Label><Textarea id="manual-mensaje" rows={3} maxLength={500} value={datos.mensaje} onChange={e => cambiar("mensaje", e.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="manual-fecha">Entrega deseada (opcional)</Label><Input id="manual-fecha" type="date" value={datos.fecha_entrega_deseada} onChange={e => cambiar("fecha_entrega_deseada", e.target.value)} className="max-w-xs" /></div>
        <label className="flex gap-3 items-center text-sm"><Checkbox checked={datos.ocultar_importe} onCheckedChange={v => cambiar("ocultar_importe", v === true)} />Ocultar el importe en el correo y el PDF del regalo</label>
        <label className="flex gap-3 items-start rounded-xl border p-4 text-sm"><Checkbox checked={confirmado} onCheckedChange={v => setConfirmado(v === true)} className="mt-0.5" />{datos.pago_manual_metodo === "cortesia" ? "Confirmo que quiero expedir este cheque de cortesía." : "Confirmo que esta compra ya se ha cobrado por el medio indicado."}</label>
      </fieldset>
      {error && <p role="alert" className="text-destructive">{error}{solicitud && " Reintenta esta misma compra para comprobar su expedición."}</p>}
      <Button type="submit" disabled={!puedeEditar || ocupado || !confirmado}>{ocupado && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{solicitud && !ocupado ? "Reintentar expedición" : "Generar código y enviar cheque"}</Button>
    </form>
  </CardContent></Card>;
}
