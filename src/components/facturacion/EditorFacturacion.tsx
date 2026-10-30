import { useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { ConceptoOrdenable } from "./ConceptoOrdenable";
import { Plus, Save, Download, RefreshCw, FilePlus2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import { useFacturacionOficiososia, type BorradorGuardado, type FacturaGuardada } from "@/hooks/useFacturacionOficiososia";
import { categorias, periodicidades, nuevaFactura, nuevaLinea, totalesFactura, erroresFactura, facturaSchema, euros, type Factura, type ParteFactura, type LineaFactura } from "./modelo";
import { VistaFactura } from "./VistaFactura";
import { SelectorServicios, EditarCatalogo } from "./SelectorServicios";
import { FacturasEmitidas } from "./FacturasEmitidas";
import { catalogoInicial, prepararNuevaFactura, agregarProductos, ultimaFacturaCliente, recuperarServicios, siguienteNumero, normalizar } from "./catalogo";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

// Alto de pantalla (regla del dueño, 2026-10-07): el editor mide lo que queda
// bajo la cabecera del layout (`useAlturaDisponible`); cabecera, pestañas, barra
// de pasos y barra de acciones quedan fijas y solo hace scroll la región del
// contenido de cada pestaña. Sin medida (jsdom, primer pintado) cae al layout de
// siempre, con scroll de página.
/** Suelo (px): por debajo (teclado abierto en el móvil) deja de encoger y vuelve el scroll de página. */
const ALTURA_MINIMA_GESTOR_GASTO = 560;
/** Pestaña que llena el alto; `data-[state=inactive]:hidden` porque Radix deja montada la inactiva con `hidden` y `flex` le gana (ver Marketing.tsx). */
const pestanaClass = "flex min-h-0 flex-1 flex-col pt-3 data-[state=inactive]:hidden";
const regionClass = "min-h-0 flex-1 overflow-y-auto overscroll-contain";

const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm";
const areaClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const accionClass = "h-10 min-w-0 gap-2 whitespace-normal px-3 text-xs sm:text-sm";
function Campo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{titulo}</span>{children}</label>;
}
function DatosParte({ titulo, parte, cambiar }: { titulo: string; parte: ParteFactura; cambiar: (p: ParteFactura) => void }) {
  return <fieldset className="min-w-0 space-y-3 rounded-lg border p-3">
    <legend className="px-2 text-sm font-semibold">{titulo}</legend>
    <div className="grid gap-3 sm:grid-cols-2"><Campo titulo="Nombre / razón social"><Input maxLength={120} value={parte.nombre} onChange={e => cambiar({...parte,nombre:e.target.value})} /></Campo>
    <Campo titulo="NIF / CIF"><Input maxLength={30} value={parte.nif} onChange={e => cambiar({...parte,nif:e.target.value})} /></Campo></div>
    <div className="grid gap-3 sm:grid-cols-2"><Campo titulo="Dirección fiscal"><textarea className={areaClass} maxLength={500} value={parte.direccion} onChange={e => cambiar({...parte,direccion:e.target.value})} /></Campo>
    <Campo titulo="Email"><Input type="email" maxLength={120} value={parte.email} onChange={e => cambiar({...parte,email:e.target.value})} /></Campo></div>
  </fieldset>;
}
export function EditorFacturacion() {
  const q = useFacturacionOficiososia();
  const [f, setF] = useState<Factura>(() => nuevaFactura());
  const [versionConfig, setVersionConfig] = useState<string | null>(null);
  const [actual, setActual] = useState<{id:string;version:string|null} | null>(null);
  const [borrador, setBorrador] = useState<{id:string;version:string|null;facturaId?:string|null}|null>(null);
  const [dirty, setDirty] = useState(false);
  const [facturaModificada, setFacturaModificada] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paso, setPaso] = useState(0);
  const inicioEditor = useRef<HTMLDivElement>(null);
  const regionPaso = useRef<HTMLDivElement>(null);
  const [raiz, setRaiz] = useState<HTMLDivElement | null>(null);
  const alto = useAlturaDisponible(raiz, ALTURA_MINIMA_GESTOR_GASTO);
  // El paso nuevo empieza arriba: la región del formulario vuelve al principio y,
  // si la página aún desplaza (móvil con teclado, bajo el suelo), la ventana también.
  const irPaso = (n: number) => { setPaso(n); if (regionPaso.current) regionPaso.current.scrollTop = 0; inicioEditor.current?.scrollIntoView?.({block:"start",behavior:"smooth"}); };
  const [tab, setTab] = useState("nueva");
  const [confirmacion,setConfirmacion] = useState<{titulo:string;descripcion:string;accion:string;destructiva:boolean;resolver:(valor:boolean)=>void}|null>(null);
  const confirmar = (titulo:string,descripcion:string,accion:string,destructiva=true) => new Promise<boolean>(resolver=>setConfirmacion({titulo,descripcion,accion,destructiva,resolver}));
  const cerrarConfirmacion = (valor:boolean) => {confirmacion?.resolver(valor);setConfirmacion(null);};
  const iniciado = useRef(false);
  useEffect(() => {
    if (!q.data || iniciado.current) return;
    iniciado.current = true;
    if (q.data.config) {
      setF({...q.data.config.documento,ivaGlobal:q.data.config.documento.ivaGlobal ?? 21,catalogo:q.data.config.documento.catalogo ?? catalogoInicial()}); setVersionConfig(q.data.config.actualizado_en);
      const pendiente = q.data.borradores?.find(b=>JSON.stringify(b.documento)===JSON.stringify(q.data?.config?.documento));
      if(pendiente)setBorrador({id:pendiente.id,version:pendiente.actualizado_en,facturaId:pendiente.factura_id});
      const archivada = q.data.facturas.find(g => pendiente ? g.id===pendiente.factura_id : g.numero === q.data.config?.documento.numero.trim());
      if (archivada) {
        setActual({id:archivada.id,version:archivada.actualizado_en});
        setFacturaModificada(JSON.stringify(archivada.documento) !== JSON.stringify(q.data.config.documento));
      }
    } else setF(prepararNuevaFactura(nuevaFactura(),q.data.facturas));
  }, [q.data]);
  useEffect(() => {
    if (!dirty) return;
    const advertir = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", advertir);
    return () => window.removeEventListener("beforeunload", advertir);
  }, [dirty]);
  const cambiar = (next: Factura) => { setF(next); setDirty(true); setFacturaModificada(true); };
  const sensorsConceptos = useSensors(useSensor(PointerSensor,{activationConstraint:{distance:8}}),useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
  const moverConcepto = (from:number,to:number) => {
    if(busy || from<0 || to<0 || from>=f.lineas.length || to>=f.lineas.length || from===to)return;
    cambiar({...f,lineas:arrayMove(f.lineas,from,to)});
  };
  const eliminarConcepto = async (id:string) => {
    const concepto=f.lineas.find(l=>l.id===id);
    if(busy || !concepto)return;
    if(!await confirmar("Eliminar concepto",`Vas a quitar «${concepto.concepto || "Concepto sin descripción"}» de esta factura. Guarda los cambios para conservar la eliminación.`,"Eliminar concepto"))return;
    cambiar({...f,lineas:f.lineas.length===1 ? [{...nuevaLinea("Otros"),concepto:""}] : f.lineas.filter(l=>l.id!==id)});
  };
  const linea = (id: string, cambio: Partial<LineaFactura>) => cambiar({...f,lineas:f.lineas.map(l => l.id === id ? {...l,...cambio} : l)});
  const puedeCambiar = async () => !dirty || await confirmar("Cambios sin guardar", "Hay cambios sin guardar. ¿Quieres descartarlos para continuar?", "Descartar cambios");
  const abrir = async (guardada: FacturaGuardada) => {
    if (!await puedeCambiar()) return;
    setBorrador(null);
    setF({...guardada.documento,ivaGlobal:guardada.documento.ivaGlobal ?? 21,catalogo:f.catalogo ?? catalogoInicial()}); setActual({id:guardada.id,version:guardada.actualizado_en});
    setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null); setDirty(false); setFacturaModificada(false);
  };
  const abrirBorrador = async (b:BorradorGuardado) => {
    if (!await puedeCambiar()) return;
    const emitida=q.data?.facturas.find(g=>g.id===b.factura_id);
    setF({...b.documento,ivaGlobal:b.documento.ivaGlobal ?? 21,catalogo:f.catalogo ?? catalogoInicial()});
    setBorrador({id:b.id,version:b.actualizado_en,facturaId:b.factura_id});
    setActual(emitida?{id:emitida.id,version:emitida.actualizado_en}:null);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);setDirty(false);setFacturaModificada(true);setTab("nueva");setPaso(0);
  };
  const nuevo = async () => {
    if (!await puedeCambiar()) return;
    setBorrador(null);
    setF(prepararNuevaFactura(f,[...(q.data?.facturas ?? []),...(q.data?.borradores ?? [])])); setActual(null); setDirty(true); setFacturaModificada(false); setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);
  };
  const duplicar = async (g:FacturaGuardada) => {
    if (!await puedeCambiar()) return;
    setBorrador(null);
    const base = prepararNuevaFactura(f,[...(q.data?.facturas ?? []),...(q.data?.borradores ?? [])]);
    setF({...g.documento,ivaGlobal:g.documento.ivaGlobal ?? 21,numero:base.numero,fecha:base.fecha,vencimiento:base.vencimiento,catalogo:base.catalogo,
      lineas:g.documento.lineas.map(l=>({...l,id:crypto.randomUUID()}))});
    setActual(null); setDirty(true); setFacturaModificada(false); setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);
  };
  const descargarEmitida = async (g:FacturaGuardada) => {
    setBusy(true);
    try { const {descargarFactura} = await import("./pdf"); await descargarFactura(g.documento); }
    catch(e) { toast.error(mensajeUsuario(e, "No se ha podido descargar la factura.")); }
    finally {setBusy(false);}
  };
  const eliminar = async (g:FacturaGuardada,estado:"emitida"|"borrador") => {
    if(!await confirmar(estado==="emitida"?"Eliminar factura":"Eliminar borrador", `Vas a eliminar ${g.numero || "el documento sin número"}. Esta acción no se puede deshacer.`, "Eliminar"))return;
    setBusy(true);
    try {
      const resultado=await q.eliminar(g,estado);
      if(estado==="emitida" && actual?.id===g.id){setActual(null);setFacturaModificada(true);setDirty(true);}
      if(estado==="borrador" && borrador?.id===g.id){setBorrador(null);setDirty(true);}
      if(estado==="emitida" && borrador?.facturaId===g.id){
        const pendiente=resultado.borradores?.find(b=>b.id===borrador.id);
        setBorrador(pendiente?{id:pendiente.id,version:pendiente.actualizado_en,facturaId:null}:null);
      }
      toast.success(estado==="emitida"?"Factura eliminada":"Borrador eliminado");
    }catch(e){toast.error(mensajeUsuario(e, "No se ha podido eliminar."));}
    finally{setBusy(false);}
  };
  const agregar = (ids:string[],paqueteId?:string) => {
    try { cambiar(agregarProductos(f,f.catalogo ?? catalogoInicial(),ids,paqueteId)); }
    catch(e) {toast.error(mensajeUsuario(e, "No se han podido añadir los servicios."));}
  };
  const guardar = async (comoFactura: boolean, descargar = false, soloCatalogo = false) => {
    const errores = comoFactura ? erroresFactura(f) : facturaSchema.safeParse(f).success ? [] : ["Revisa fechas, cantidades, precios y límites de los textos."];
    if (errores.length) { toast.error(errores.join(" ")); return; }
    setBusy(true);
    try {
      const documento = {...f, numero:f.numero.trim()};
      const resultado = await q.guardar(documento, versionConfig, comoFactura ? actual ?? {id:crypto.randomUUID(),version:null} : undefined, soloCatalogo ? undefined : borrador ?? {id:crypto.randomUUID(),version:null,facturaId:actual?.id});
      if(resultado.borrador)setBorrador({id:resultado.borrador.id,version:resultado.borrador.actualizado_en,facturaId:resultado.borrador.factura_id});
      if(comoFactura)setBorrador(null);
      setF(documento);
      setVersionConfig(resultado.config.actualizado_en); setDirty(false);
      if (resultado.factura) { setActual({id:resultado.factura.id,version:resultado.factura.actualizado_en}); setFacturaModificada(false); }
      toast.success(comoFactura ? actual ? "Factura actualizada" : "Factura emitida" : soloCatalogo ? "Catálogo y tarifas guardados" : "Borrador guardado");
      if (comoFactura && !descargar) setTab("emitidas");
      if (descargar) {
        const { descargarFactura } = await import("./pdf");
        await descargarFactura(documento);
      }
    } catch (e) { toast.error(mensajeUsuario(e, "No se ha podido guardar la factura.")); }
    finally { setBusy(false); }
  };
  const recargar = async () => {
    if (!await puedeCambiar()) return;
    const r = await q.refetch();
    if (!r.data || r.error) return;
    const documento = r.data.config ? {...r.data.config.documento,ivaGlobal:r.data.config.documento.ivaGlobal ?? 21,catalogo:r.data.config.documento.catalogo ?? catalogoInicial()} : prepararNuevaFactura(nuevaFactura(),r.data.facturas);
    const pendiente=r.data.borradores?.find(b=>JSON.stringify(b.documento)===JSON.stringify(documento));
    const archivada = r.data.facturas.find(g => pendiente ? g.id===pendiente.factura_id : g.numero === documento.numero.trim());
    setBorrador(pendiente?{id:pendiente.id,version:pendiente.actualizado_en,facturaId:pendiente.factura_id}:null);
    setF(documento); setActual(archivada ? {id:archivada.id,version:archivada.actualizado_en} : null);
    setVersionConfig(r.data.config?.actualizado_en ?? null); setDirty(false);
    setFacturaModificada(!!archivada && JSON.stringify(archivada.documento) !== JSON.stringify(documento));
  };
  const total = totalesFactura(f);
  const deshabilitado = busy || q.isLoading || q.isError;
  const ultimaCliente = ultimaFacturaCliente(q.data?.facturas ?? [],f.cliente);
  const clientes = [...(q.data?.facturas ?? [])].sort((a,b)=>b.documento.fecha.localeCompare(a.documento.fecha))
    .filter((g,i,lista)=>lista.findIndex(v=>normalizar(v.documento.cliente.nif)===normalizar(g.documento.cliente.nif))===i);
  return <div ref={setRaiz} className="flex flex-col gap-3" style={alto ? {height:alto} : undefined}>
    <AlertDialog open={!!confirmacion} onOpenChange={abierto=>{if(!abierto)cerrarConfirmacion(false);}}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{confirmacion?.titulo}</AlertDialogTitle><AlertDialogDescription className="break-words">{confirmacion?.descripcion}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className={confirmacion?.destructiva ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={()=>cerrarConfirmacion(true)}>{confirmacion?.accion}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-base font-semibold leading-tight">Facturación · OficiosOsIA</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Instalación, licencias, módulos y soporte · {dirty ? "Cambios sin guardar" : actual ? facturaModificada ? "Borrador guardado · factura pendiente de actualizar" : "Factura guardada" : q.data?.config ? "Borrador guardado" : "Nuevo borrador"}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={nuevo} disabled={busy || q.isLoading}><FilePlus2 className="mr-2 h-4 w-4" />Nueva factura</Button>
        <Button variant="outline" onClick={() => void recargar()} disabled={busy || q.isFetching} aria-label="Recargar facturación"><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {q.isError && <div role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-semibold">No se ha podido cargar la facturación</p>
      <p className="mt-1 break-words">{q.error.message}</p>
      <p className="mt-1">Si esta función acaba de instalarse, comprueba que se haya aplicado la migración de facturación. Puedes reintentar con el botón de recarga.</p>
    </div>}
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <PestanasPagina
        pestanas={[
          { valor: "emitidas", etiqueta: "Facturas" },
          { valor: "nueva", etiqueta: "Nueva factura" },
          { valor: "catalogo", etiqueta: "Módulos y paquetes" },
        ]}
      />
      <TabsContent value="emitidas" className={`${regionClass} space-y-4 pt-3 data-[state=inactive]:hidden`}>
        {q.isLoading ? <p role="status">Cargando facturas…</p> : q.isError ? <p className="text-sm text-muted-foreground">El historial no está disponible. Reintenta la carga.</p> :
          <FacturasEmitidas eliminar={(g,estado)=>void eliminar(g,estado)} borradores={q.data?.borradores ?? []} editarBorrador={abrirBorrador} facturas={q.data?.facturas ?? []} busy={busy} editar={abrir} duplicar={duplicar} descargar={g=>void descargarEmitida(g)} nueva={nuevo} />}
      </TabsContent>
      <TabsContent value="nueva" className={`${pestanaClass} gap-5`}>
      {actual && <p className="shrink-0 text-sm font-medium">Editando factura {f.numero}</p>}
    <div ref={inicioEditor} className="shrink-0 scroll-mt-4 space-y-3">
      <nav aria-label="Pasos de la factura" className="flex gap-1 border-b border-border/60">
        {["Cliente", "Servicios", "Ajustes", "Revisar"].map((nombre,i)=><Button key={nombre} variant="ghost" className={"-mb-px h-10 min-w-0 flex-1 rounded-none border-b-2 px-1 text-xs shadow-none hover:bg-transparent sm:flex-none sm:px-4 sm:text-sm pointer-coarse:h-11 "+(paso===i ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")} aria-current={paso===i ? "step" : undefined} onClick={()=>irPaso(i)}>{i+1}. {nombre}</Button>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{f.cliente.nombre || "Selecciona un cliente"} · {f.lineas.filter(l=>l.concepto.trim()).length} conceptos</span><span>Total: <strong>{euros(total.total)}</strong></span></div>
    </div>
    <div ref={regionPaso} className={regionClass}>
    {q.isLoading ? <p role="status" className="py-10 text-center text-muted-foreground">Cargando facturación…</p> : (
      <div className="min-w-0">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {paso === 0 && <>
          <Card><CardHeader><CardTitle className="text-base">1. Cliente y datos de la factura</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo titulo="Número de factura"><Input placeholder={siguienteNumero(q.data?.facturas ?? [],f.fecha)} maxLength={60} value={f.numero} onChange={e => cambiar({...f,numero:e.target.value})} /></Campo>
              <Campo titulo="Fecha"><Input type="date" value={f.fecha} onChange={e => cambiar({...f,fecha:e.target.value})} /></Campo>
              <Campo titulo="Vencimiento"><Input type="date" value={f.vencimiento} onChange={e => cambiar({...f,vencimiento:e.target.value})} /></Campo>
            </div>
            {!!clientes.length && <Campo titulo="Usar cliente guardado"><select aria-label="Usar cliente guardado" className={selectClass} value="" onChange={e=>{const g=clientes.find(v=>v.id===e.target.value);if(g)cambiar({...f,cliente:{...g.documento.cliente}});}}>
              <option value="">Seleccionar cliente…</option>{clientes.map(g=><option key={g.id} value={g.id}>{g.documento.cliente.nombre} · {g.documento.cliente.nif}</option>)}
            </select></Campo>}
            <DatosParte titulo="Cliente" parte={f.cliente} cambiar={p => cambiar({...f,cliente:p})} />
            {ultimaCliente && <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Servicios detectados en la última factura de este cliente: {ultimaCliente.numero}</p>
              <Button variant="outline" className="mt-2 h-auto whitespace-normal" onClick={()=>{try{cambiar(recuperarServicios(f,ultimaCliente.documento));}catch(e){toast.error(mensajeUsuario(e, "No se han podido recuperar los servicios."));}}}>Añadir servicios recurrentes del cliente</Button>
            </div>}
            <details open={!f.emisor.nif || !f.emisor.direccion} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">Datos del emisor · {f.emisor.nombre}</summary>
              <div className="mt-3"><DatosParte titulo="Emisor" parte={f.emisor} cambiar={p => cambiar({...f,emisor:p})} /></div>
            </details>
          </CardContent></Card>
          </>}
          {paso === 1 && <>
          <details className="rounded-lg border p-3" open={!f.lineas.some(l=>l.concepto.trim())}><summary className="cursor-pointer text-sm font-medium">Añadir módulos o paquetes</summary><div className="mt-3"><SelectorServicios catalogo={f.catalogo ?? catalogoInicial()} lineas={f.lineas} agregar={agregar} /></div></details>
          <Card><CardHeader><CardTitle className="text-base">2. Conceptos de la factura</CardTitle><p className="text-xs text-muted-foreground">Arrastra desde el asa o usa las flechas para cambiar el orden de los conceptos.</p></CardHeader><CardContent className="space-y-4"><DndContext sensors={sensorsConceptos} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={({active,over})=>{if(over)moverConcepto(f.lineas.findIndex(l=>l.id===active.id),f.lineas.findIndex(l=>l.id===over.id));}}><SortableContext items={f.lineas.map(l=>l.id)} strategy={verticalListSortingStrategy}><div className="space-y-3">
            {f.lineas.map((l,i) => <ConceptoOrdenable key={l.id} id={l.id} index={i} total={f.lineas.length} busy={busy} mover={moverConcepto} eliminar={()=>void eliminarConcepto(l.id)}>
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Campo titulo="Descripción"><Input maxLength={300} value={l.concepto} onChange={e => linea(l.id,{concepto:e.target.value})} /></Campo></div>
              </div>

              <div className="grid grid-cols-3 items-end gap-2">
                <Campo titulo="Cantidad"><Input type="number" min={0.01} max={100000} step="0.01" value={l.cantidad} onChange={e=>linea(l.id,{cantidad:Number(e.target.value)})} /></Campo>
                <Campo titulo="Precio unitario (€)"><Input type="number" min={0} max={1000000} step="0.01" value={l.precio} onChange={e=>linea(l.id,{precio:Number(e.target.value)})} /></Campo>
                <p className="pb-2 text-right text-sm font-medium">{euros(total.lineas[i].base)}</p>
              </div>
              <details className="rounded-md bg-muted/30 p-2"><summary className="cursor-pointer text-xs text-muted-foreground">Tipo y periodicidad · {l.periodicidad}</summary><div className="mt-2 grid grid-cols-2 gap-3"><Campo titulo="Tipo"><select aria-label="Tipo" className={selectClass} value={l.categoria} onChange={e => linea(l.id,{categoria:e.target.value as LineaFactura["categoria"]})}>{categorias.map(v => <option key={v}>{v}</option>)}</select></Campo>
                <Campo titulo="Periodicidad"><select aria-label="Periodicidad" className={selectClass} value={l.periodicidad} onChange={e => linea(l.id,{periodicidad:e.target.value as LineaFactura["periodicidad"]})}>{periodicidades.map(v => <option key={v}>{v}</option>)}</select></Campo></div>
              </details>
            </ConceptoOrdenable>)}
            </div></SortableContext></DndContext><Button variant="outline" disabled={f.lineas.length >= 100} onClick={() => cambiar({...f,lineas:[...f.lineas,nuevaLinea()]})}><Plus className="mr-2 h-4 w-4" />Añadir concepto</Button>
            <p className="text-xs text-muted-foreground">Cada línea corresponde al periodo indicado en su descripción. La periodicidad sirve para calcular la cuota mensual; no multiplica el importe de la factura.</p>
          </CardContent></Card>
          </>}
          {paso === 2 && <><Card><CardHeader><CardTitle className="text-base">3. Descuentos e impuestos</CardTitle></CardHeader><CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><label htmlFor="aplicar-iva" className="text-sm font-medium">Aplicar IVA</label>
              <Switch id="aplicar-iva" checked={f.aplicarIva!==false} onCheckedChange={v=>cambiar({...f,aplicarIva:v})} /></div>
            {f.aplicarIva===false && <p className="text-xs text-muted-foreground">La factura se calcula sin IVA. El porcentaje general se conserva si vuelves a activarlo.</p>}
            <Campo titulo="IVA de la factura (%)"><Input className="max-w-40" type="number" disabled={f.aplicarIva===false} min={0} max={100} step="0.01" value={f.ivaGlobal ?? 21} onChange={e=>cambiar({...f,ivaGlobal:Number(e.target.value)})} /></Campo>
            <p className="text-xs text-muted-foreground">Se aplica a toda la base de la factura, después de los descuentos.</p>
            <Campo titulo="Descuento global (%)"><Input className="max-w-40" type="number" min={0} max={100} step="0.01" value={f.descuentoGlobal ?? 0} onChange={e=>cambiar({...f,descuentoGlobal:Number(e.target.value)})} /></Campo>
            <p className="text-xs text-muted-foreground">Se aplica después de los descuentos por concepto y antes de los impuestos.</p>
            <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Descuentos por concepto</summary>
              <div className="mt-3 space-y-3">{f.lineas.map((l,i)=><div key={l.id} className="flex min-w-0 items-center gap-3">
                <label htmlFor={"descuento-"+l.id} className="min-w-0 flex-1 break-words text-xs">{l.concepto || "Concepto "+(i+1)}</label>
                <Input id={"descuento-"+l.id} aria-label={"Descuento de concepto "+(i+1)+" (%)"} className="w-24 shrink-0" type="number" min={0} max={100} step="0.01" value={l.descuento} onChange={e=>linea(l.id,{descuento:Number(e.target.value)})} />
              </div>)}</div>
            </details>
            <p className="text-sm">Descuento total: <strong>{euros(total.descuentosLineas+total.descuentoGlobal)}</strong></p>
            <Campo titulo="Retención (%)"><Input className="max-w-40" type="number" min={0} max={100} step="0.01" value={f.retencion} onChange={e => cambiar({...f,retencion:Number(e.target.value)})} /></Campo>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Pago y observaciones</CardTitle></CardHeader><CardContent className="space-y-3">
            <Campo titulo="Forma de pago / IBAN"><textarea className={areaClass} maxLength={500} value={f.pago} onChange={e => cambiar({...f,pago:e.target.value})} /></Campo>
            <Campo titulo="Observaciones / periodo de facturación"><textarea className={areaClass} maxLength={2000} value={f.notas} onChange={e => cambiar({...f,notas:e.target.value})} /></Campo>
          </CardContent></Card>
          </>}
          {paso === 3 && <div className="min-w-0 space-y-3">
          <p className="text-sm font-medium">Vista previa de la hoja de factura</p><VistaFactura factura={f} />
          <p className="text-xs text-muted-foreground">El PDF usa formato A4 y añade páginas cuando sea necesario.</p>
        </div>}
        </fieldset>
      </div>
    )}
    </div>
    {/* Fuera de la región: siempre a la vista. El `sticky` solo actúa si la página desplaza (bajo el suelo). */}
    <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex sm:flex-wrap sm:justify-end">
      <div className="flex w-full items-center justify-between gap-2 border-b pb-2 sm:mr-auto sm:w-auto sm:border-0 sm:pb-0">
        <Button variant="outline" disabled={paso===0 || busy} onClick={()=>irPaso(paso-1)}>Anterior</Button>
        <span className="px-2 text-xs text-muted-foreground">Paso {paso+1} de 4</span>
        {paso<3 && <Button disabled={busy} onClick={()=>irPaso(paso+1)}>Siguiente</Button>}
      </div>
      <Button className={accionClass} variant="outline" disabled={deshabilitado} onClick={() => void guardar(false)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />Guardar borrador</Button>
      {paso === 3 && <><Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />{actual ? "Actualizar factura" : "Emitir factura"}</Button>
      <Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true,true)}><Download className="h-4 w-4 shrink-0 sm:mr-2" />{busy ? "Procesando…" : "Descargar PDF"}</Button></>}
    </div>
      </TabsContent>
      <TabsContent value="catalogo" className={`${pestanaClass} gap-4`}>
        <div className={regionClass}><EditarCatalogo catalogo={f.catalogo ?? catalogoInicial()} cambiar={c=>cambiar({...f,catalogo:c})} busy={busy || q.isLoading} /></div>
        <Button className="shrink-0 self-start" disabled={deshabilitado} onClick={()=>void guardar(false,false,true)}><Save className="mr-2 h-4 w-4" />Guardar catálogo y tarifas</Button>
      </TabsContent>
    </Tabs>
  </div>;
}
