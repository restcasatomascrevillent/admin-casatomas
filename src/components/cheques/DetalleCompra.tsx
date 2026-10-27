import { estadoCaducidad, fechaCaducidad } from "@/lib/cheques/caducidad";
import { useHoyCheques } from "@/hooks/useHoyCheques";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { errorCheques, type ChequeRegalo } from "@/lib/cheques/regalo";

interface Compra extends ChequeRegalo {
  estado: string; usado: boolean; creado_en: string | null; email_enviado_en: string | null;
  canjeado_en: string | null; origen: string; pago_manual_metodo: string | null;
  solicita_factura: boolean; datos_factura: { nombre?: string; nif?: string; direccion?: string } | null;
  factura_numero: string | null; stripe_session_id: string | null; stripe_payment_intent_id: string | null;
  gastos_gestion_eur?: number | string | null; stripe_fee_eur?: number | string | null;
}
const euro = (n: number) => n.toLocaleString("es-ES", { style: "currency", currency: "EUR" });

/** Cuánto pagó el comprador, cuánto se llevó Stripe y cuánto quedó. Solo compras web. */
function ImportesStripe({ compra, dato }: { compra: Compra; dato: (titulo: string, valor?: string | null) => JSX.Element }) {
  const valor = Number(compra.importe_eur), gastos = Number(compra.gastos_gestion_eur || 0);
  const cobrado = Math.round((valor + gastos) * 100) / 100;
  const comision = compra.stripe_fee_eur == null ? null : Number(compra.stripe_fee_eur);
  return <section className="border-t pt-4"><h3 className="font-semibold mb-3">Importes y comisión</h3><dl className="grid gap-4 sm:grid-cols-2">
    {dato("Valor del cheque", euro(valor))}{dato("Gastos de gestión", euro(gastos))}{dato("Total cobrado", euro(cobrado))}
    {dato("Se llevó Stripe", comision === null ? "Sin dato real (compra anterior o pago sin confirmar)" : euro(comision))}
    {comision !== null && dato("Te queda", euro(Math.round((cobrado - comision) * 100) / 100))}
  </dl></section>;
}
const fecha = (valor?: string | null) => valor ? new Date(valor).toLocaleString("es-ES") : "—";
const metodos: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", cortesia: "Cortesía" };

export function DetalleCompra({ id, onClose }: { id: string | null; onClose: () => void }) {
  const hoy = useHoyCheques();
  const [compra, setCompra] = useState<Compra | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let activo = true;
    setCompra(null); setError("");
    if (!id) return;
    void (async () => {
      try {
        const { data, error } = await (supabase as unknown as SupabaseClient).rpc("detalle_cheque_regalo", { p_id: id });
        if (error || !data) throw error || new Error("No se encontró la compra");
        if (activo) setCompra(data as Compra);
      } catch (e) { if (activo) setError(errorCheques(e)); }
    })();
    return () => { activo = false; };
  }, [id, revision]);
  const dato = (titulo: string, valor?: string | null) => <div key={titulo} className="min-w-0"><dt className="text-xs text-muted-foreground">{titulo}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm font-medium">{valor || "—"}</dd></div>;
  return <Dialog open={!!id} onOpenChange={open => !open && onClose()}>
    <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>Información de la compra</DialogTitle><DialogDescription>Datos del comprador y del cheque regalo.</DialogDescription></DialogHeader>
      {error ? <div className="space-y-3"><p role="alert">{error}</p><Button variant="outline" onClick={() => setRevision(r => r + 1)}>Reintentar</Button></div> : !compra ? <p role="status">Cargando compra…</p> : <div className="space-y-6">
        <div className="rounded-xl bg-[#faf7f1] p-4 flex flex-wrap items-center justify-between gap-3"><div><p className="font-mono font-semibold">{compra.codigo}</p><p className="text-sm mt-1">{compra.estado === "cancelado" ? "Cancelado" : compra.usado ? "Canjeado" : estadoCaducidad(compra.caduca_el, hoy).caducado ? "Caducado" : "Disponible"}</p></div><p className="text-3xl font-semibold">{Number(compra.importe_eur).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p></div>
        <section><h3 className="font-semibold mb-3">Comprador</h3><dl className="grid gap-4 sm:grid-cols-2">{dato("Nombre", compra.comprador_nombre)}{dato("Email", compra.comprador_email)}{dato("Teléfono", compra.comprador_telefono)}{dato("Fecha de compra", fecha(compra.creado_en))}</dl></section>
        <section className="border-t pt-4"><h3 className="font-semibold mb-3">Regalo</h3><dl className="grid gap-4 sm:grid-cols-2">{dato("Válido hasta (incluido)", fechaCaducidad(compra.caduca_el))}{dato("Tiempo restante", compra.usado || compra.estado !== "pagado" ? "—" : estadoCaducidad(compra.caduca_el, hoy).texto)}{dato("Destinatario", compra.destinatario_nombre)}{dato("Entrega deseada", compra.fecha_entrega_deseada ? compra.fecha_entrega_deseada.split("-").reverse().join("/") : null)}<div className="sm:col-span-2">{dato("Dedicatoria", compra.mensaje)}</div></dl></section>
        <section className="border-t pt-4"><h3 className="font-semibold mb-3">Pago y entrega</h3><dl className="grid gap-4 sm:grid-cols-2">{dato("Origen", compra.origen === "manual" ? "Compra manual" : "Web · Stripe")}{dato("Método de pago", compra.pago_manual_metodo ? metodos[compra.pago_manual_metodo] : "Stripe")}{dato("Correo enviado", compra.email_enviado_en ? fecha(compra.email_enviado_en) : "Sin envío confirmado")}{dato("Canjeado el", fecha(compra.canjeado_en))}{dato("Importe en el regalo", compra.ocultar_importe ? "Oculto" : "Visible")}{compra.stripe_session_id && dato("Sesión de Stripe", compra.stripe_session_id)}{compra.stripe_payment_intent_id && dato("Pago de Stripe", compra.stripe_payment_intent_id)}</dl></section>
        {compra.origen !== "manual" && compra.stripe_payment_intent_id && <ImportesStripe compra={compra} dato={dato} />}
        <section className="border-t pt-4"><h3 className="font-semibold mb-3">Factura</h3>{compra.solicita_factura ? <dl className="grid gap-4 sm:grid-cols-2">{dato("Nombre o razón social", compra.datos_factura?.nombre)}{dato("NIF / CIF", compra.datos_factura?.nif)}{dato("Dirección fiscal", compra.datos_factura?.direccion)}{dato("Número de factura", compra.factura_numero || "Pendiente de emitir")}</dl> : <p className="text-sm text-muted-foreground">No solicitada</p>}</section>
      </div>}
    </DialogContent>
  </Dialog>;
}
