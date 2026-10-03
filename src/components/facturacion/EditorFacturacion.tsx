import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plus, Save, Download, Trash2, RefreshCw, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useFacturacionOficiososia, type FacturaGuardada } from "@/hooks/useFacturacionOficiososia";
import { categorias, periodicidades, nuevaFactura, nuevaLinea, mensualFactura, totalesFactura, erroresFactura, facturaSchema, euros, type Factura, type ParteFactura, type LineaFactura } from "./modelo";
import { VistaFactura } from "./VistaFactura";

const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const areaClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const accionClass = "h-auto min-h-14 min-w-0 flex-col gap-1 whitespace-normal px-2 py-2 text-[11px] sm:h-10 sm:min-h-0 sm:flex-row sm:gap-0 sm:px-4 sm:text-sm";
function Campo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{titulo}</span>{children}</label>;
}
function DatosParte({ titulo, parte, cambiar }: { titulo: string; parte: ParteFactura; cambiar: (p: ParteFactura) => void }) {
  return <fieldset className="min-w-0 space-y-3 rounded-lg border p-4">
    <legend className="px-2 text-sm font-semibold">{titulo}</legend>
    <Campo titulo="Nombre / razón social"><Input maxLength={120} value={parte.nombre} onChange={e => cambiar({...parte,nombre:e.target.value})} /></Campo>
    <Campo titulo="NIF / CIF"><Input maxLength={30} value={parte.nif} onChange={e => cambiar({...parte,nif:e.target.value})} /></Campo>
    <Campo titulo="Dirección fiscal"><textarea className={areaClass} maxLength={500} value={parte.direccion} onChange={e => cambiar({...parte,direccion:e.target.value})} /></Campo>
    <Campo titulo="Email"><Input type="email" maxLength={120} value={parte.email} onChange={e => cambiar({...parte,email:e.target.value})} /></Campo>
  </fieldset>;
}
export function EditorFacturacion() {
  const q = useFacturacionOficiososia();
  const [f, setF] = useState<Factura>(() => nuevaFactura());
  const [versionConfig, setVersionConfig] = useState<string | null>(null);
  const [actual, setActual] = useState<{id:string;version:string|null} | null>(null);
  const [dirty, setDirty] = useState(false);
  const [facturaModificada, setFacturaModificada] = useState(false);
  const [busy, setBusy] = useState(false);
  const [vista, setVista] = useState(false);
  const iniciado = useRef(false);
  useEffect(() => {
    if (!q.data || iniciado.current) return;
    iniciado.current = true;
    if (q.data.config) {
      setF(q.data.config.documento); setVersionConfig(q.data.config.actualizado_en);
      const archivada = q.data.facturas.find(g => g.numero === q.data.config?.documento.numero.trim());
      if (archivada) {
        setActual({id:archivada.id,version:archivada.actualizado_en});
        setFacturaModificada(JSON.stringify(archivada.documento) !== JSON.stringify(q.data.config.documento));
      }
    }
  }, [q.data]);
  useEffect(() => {
    if (!dirty) return;
    const advertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", advertir);
    return () => window.removeEventListener("beforeunload", advertir);
  }, [dirty]);
  const cambiar = (next: Factura) => { setF(next); setDirty(true); setFacturaModificada(true); };
  const linea = (id: string, cambio: Partial<LineaFactura>) => cambiar({...f,lineas:f.lineas.map(l => l.id === id ? {...l,...cambio} : l)});
  const puedeCambiar = () => !dirty || window.confirm("Hay cambios sin guardar. ¿Quieres descartarlos?");
  const abrir = (guardada: FacturaGuardada) => {
    if (!puedeCambiar()) return;
    setF(guardada.documento); setActual({id:guardada.id,version:guardada.actualizado_en});
    setVersionConfig(q.data?.config?.actualizado_en ?? null); setDirty(false); setFacturaModificada(false);
  };
  const nuevo = () => {
    if (!puedeCambiar()) return;
    setF(nuevaFactura(f.emisor)); setActual(null); setDirty(true); setFacturaModificada(false);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);
  };
  const guardar = async (comoFactura: boolean, descargar = false) => {
    const errores = comoFactura ? erroresFactura(f) : facturaSchema.safeParse(f).success ? [] : ["Revisa fechas, cantidades, precios y límites de los textos."];
    if (errores.length) { toast.error(errores.join(" ")); return; }
    setBusy(true);
    try {
      const documento = {...f, numero:f.numero.trim()};
      const resultado = await q.guardar(documento, versionConfig, comoFactura ? actual ?? {id:crypto.randomUUID(),version:null} : undefined);
      setF(documento);
      setVersionConfig(resultado.config.actualizado_en); setDirty(false);
      if (resultado.factura) { setActual({id:resultado.factura.id,version:resultado.factura.actualizado_en}); setFacturaModificada(false); }
      toast.success(comoFactura ? "Factura guardada" : "Borrador y tarifas guardados");
      if (descargar) {
        const { descargarFactura } = await import("./pdf");
        await descargarFactura(documento);
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : "No se ha podido guardar la factura."); }
    finally { setBusy(false); }
  };
  const recargar = async () => {
    if (!puedeCambiar()) return;
    const r = await q.refetch();
    if (!r.data || r.error) return;
    const documento = r.data.config?.documento ?? nuevaFactura();
    const archivada = r.data.facturas.find(g => g.numero === documento.numero.trim());
    setF(documento); setActual(archivada ? {id:archivada.id,version:archivada.actualizado_en} : null);
    setVersionConfig(r.data.config?.actualizado_en ?? null); setDirty(false);
    setFacturaModificada(!!archivada && JSON.stringify(archivada.documento) !== JSON.stringify(documento));
  };
  const total = totalesFactura(f);
  const deshabilitado = busy || q.isLoading || q.isError;
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Facturación · OficiosOsIA</h1>
        <p className="mt-1 text-sm text-muted-foreground">Instalación, licencias, módulos y soporte.</p>
        <p className="mt-1 text-xs text-muted-foreground">{dirty ? "Cambios sin guardar" : actual ? facturaModificada ? "Borrador guardado · factura pendiente de actualizar" : "Factura guardada" : q.data?.config ? "Borrador guardado" : "Nuevo borrador"}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={nuevo} disabled={busy || q.isLoading}><FilePlus2 className="mr-2 h-4 w-4" />Nueva factura</Button>
        <Button variant="outline" onClick={() => void recargar()} disabled={busy || q.isFetching} aria-label="Recargar facturación"><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {q.isError && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-semibold">No se ha podido cargar la facturación</p>
      <p className="mt-1 break-words">{q.error.message}</p>
      <p className="mt-1">Si esta función acaba de instalarse, comprueba que se haya aplicado la migración de facturación. Puedes reintentar con el botón de recarga.</p>
    </div>}
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[["Base de esta factura", euros(total.base)],["Total con impuestos",euros(total.total)],["Servicios recurrentes / mes",euros(mensualFactura(f))]].map(([label,v]) =>
        <Card key={label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words text-xl font-semibold">{v}</p></CardContent></Card>)}
    </div>
    <div className="flex flex-wrap items-end gap-3">
      <Campo titulo="Facturas guardadas"><select disabled={busy} className={selectClass} value={actual?.id ?? ""} onChange={e => { const v = q.data?.facturas.find(g => g.id === e.target.value); if(v) abrir(v); }}>
        <option value="">Seleccionar factura…</option>{q.data?.facturas.map(g => <option key={g.id} value={g.id}>{g.numero} · {g.documento.cliente.nombre} · {euros(totalesFactura(g.documento).total)}</option>)}
      </select></Campo>
      <Button variant="outline" onClick={() => setVista(!vista)} className="xl:hidden">{vista ? "Editar factura" : "Ver factura"}</Button>
      <span className="text-xs text-muted-foreground">{q.data?.facturas.length ?? 0} facturas guardadas</span>
    </div>
    {q.isLoading ? <p role="status" className="py-10 text-center text-muted-foreground">Cargando facturación…</p> : (
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <fieldset disabled={busy} className={vista ? "hidden min-w-0 space-y-5 xl:block" : "min-w-0 space-y-5"}>
          <Card><CardHeader><CardTitle className="text-base">Datos de la factura</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo titulo="Número de factura"><Input placeholder="FO-2026-001" maxLength={60} value={f.numero} onChange={e => cambiar({...f,numero:e.target.value})} /></Campo>
              <Campo titulo="Fecha"><Input type="date" value={f.fecha} onChange={e => cambiar({...f,fecha:e.target.value})} /></Campo>
              <Campo titulo="Vencimiento"><Input type="date" value={f.vencimiento} onChange={e => cambiar({...f,vencimiento:e.target.value})} /></Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-2"><DatosParte titulo="Emisor" parte={f.emisor} cambiar={p => cambiar({...f,emisor:p})} /><DatosParte titulo="Cliente" parte={f.cliente} cambiar={p => cambiar({...f,cliente:p})} /></div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Conceptos facturables</CardTitle></CardHeader><CardContent className="space-y-4">
            {f.lineas.map((l,i) => <fieldset key={l.id} className="min-w-0 space-y-3 rounded-lg border p-3">
              <legend className="px-2 text-xs font-semibold">Concepto {i+1}</legend>
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Campo titulo="Descripción"><Input maxLength={300} value={l.concepto} onChange={e => linea(l.id,{concepto:e.target.value})} /></Campo></div>
                <Button className="mt-6 shrink-0" size="icon" variant="ghost" disabled={f.lineas.length === 1} aria-label={"Eliminar concepto " + (i+1)} onClick={() => cambiar({...f,lineas:f.lineas.filter(v => v.id !== l.id)})}><Trash2 className="h-4 w-4" /></Button></div>
              <div className="grid grid-cols-2 gap-3"><Campo titulo="Tipo"><select className={selectClass} value={l.categoria} onChange={e => linea(l.id,{categoria:e.target.value as LineaFactura["categoria"]})}>{categorias.map(v => <option key={v}>{v}</option>)}</select></Campo>
                <Campo titulo="Periodicidad"><select className={selectClass} value={l.periodicidad} onChange={e => linea(l.id,{periodicidad:e.target.value as LineaFactura["periodicidad"]})}>{periodicidades.map(v => <option key={v}>{v}</option>)}</select></Campo></div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([["cantidad","Cantidad",0.01,100000],["precio","Precio unitario (€)",0,1000000],["descuento","Descuento (%)",0,100],["iva","IVA (%)",0,100]] as const).map(([key,label,min,max]) =>
                  <Campo key={key} titulo={label}><Input type="number" min={min} max={max} step="0.01" value={l[key]} onChange={e => linea(l.id,{[key]:Number(e.target.value)})} /></Campo>)}
              </div>
              <p className="text-right text-xs text-muted-foreground">Base del concepto: <strong>{euros(total.lineas[i].base)}</strong></p>
            </fieldset>)}
            <Button variant="outline" disabled={f.lineas.length >= 100} onClick={() => cambiar({...f,lineas:[...f.lineas,nuevaLinea()]})}><Plus className="mr-2 h-4 w-4" />Añadir concepto</Button>
            <p className="text-xs text-muted-foreground">Cada línea corresponde al periodo indicado en su descripción. La periodicidad sirve para calcular la cuota mensual; no multiplica el importe de la factura.</p>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Pago y observaciones</CardTitle></CardHeader><CardContent className="space-y-3">
            <Campo titulo="Retención (%)"><Input className="max-w-40" type="number" min={0} max={100} step="0.01" value={f.retencion} onChange={e => cambiar({...f,retencion:Number(e.target.value)})} /></Campo>
            <Campo titulo="Forma de pago / IBAN"><textarea className={areaClass} maxLength={500} value={f.pago} onChange={e => cambiar({...f,pago:e.target.value})} /></Campo>
            <Campo titulo="Observaciones / periodo de facturación"><textarea className={areaClass} maxLength={2000} value={f.notas} onChange={e => cambiar({...f,notas:e.target.value})} /></Campo>
          </CardContent></Card>
        </fieldset>
        <div className={vista ? "min-w-0 space-y-3" : "hidden min-w-0 space-y-3 xl:block"}>
          <p className="text-sm font-medium">Vista previa de la hoja de factura</p><VistaFactura factura={f} />
          <p className="text-xs text-muted-foreground">El PDF usa formato A4 y añade páginas cuando sea necesario.</p>
        </div>
      </div>
    )}
    <div className="sticky bottom-0 z-10 grid grid-cols-3 gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex sm:flex-wrap sm:justify-end">
      <Button className={accionClass} variant="outline" disabled={deshabilitado} onClick={() => void guardar(false)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />Guardar borrador</Button>
      <Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />{actual ? "Actualizar factura" : "Guardar factura"}</Button>
      <Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true,true)}><Download className="h-4 w-4 shrink-0 sm:mr-2" />{busy ? "Procesando…" : "Descargar PDF"}</Button>
    </div>
  </div>;
}
