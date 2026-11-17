import { Suspense, lazy, useEffect, useRef, useState, type ReactNode } from "react";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { ConceptoOrdenable } from "./ConceptoOrdenable";
import { Plus, Save, Download, Eye, RefreshCw, FilePlus2, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PestanasPagina } from "@/components/panel/PestanasPagina";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { useFacturacionOficiososia, type BorradorGuardado, type FacturaGuardada } from "@/hooks/useFacturacionOficiososia";
import { categorias, periodicidades, nuevaFactura, totalesRecibo, erroresFactura, facturaSchema, euros, sinDatosFiscales, textoMesRecibo, tipoDeRecibo, tiposRecibo, TEXTO_TIPO_RECIBO, type Factura, type LineaFactura, type TipoRecibo } from "./modelo";
import { VistaFactura } from "./VistaFactura";
import { VistaPreviaPdf, type ReciboEnPrevia } from "./VistaPreviaPdf";
import { SelectorServicios, EditarCatalogo } from "./SelectorServicios";
import { FacturasEmitidas } from "./FacturasEmitidas";
import { catalogoInicial, prepararNuevaFactura, agregarProductos, ultimaFacturaCliente, recuperarServicios, siguienteNumero, normalizar, aplicarGastosServicios, cambiarMes, cambiarTipo, anadirConcepto, anadirGastoServicio, descuentoAServicios, quitarConcepto, type GastoServicio } from "./catalogo";
import { GastosServiciosRecibo } from "./GastosServiciosRecibo";
import { useGastosServiciosMes } from "@/hooks/useGastosServiciosMes";
import { useAlturaDisponible } from "@/hooks/useAlturaDisponible";
import { mensajeUsuario } from "@/lib/mensaje-usuario";

// «Control Excel» (17/11/2026) se carga solo al abrir su pestaña: lee el Excel de Drive.
const ControlExcel = lazy(() => import("@/components/control-excel/ControlExcel").then((m) => ({ default: m.ControlExcel })));

// Gestor Gasto (17/11/2026, petición del dueño): los documentos son RECIBOS, sin membrete ni
// datos fiscales, de dos tipos — licencia global y pago mensual (cuota fija + los gastos del mes
// que se ven en Servicios, editables) — y una pestaña «Control Excel» para llevar el Excel de
// control (cobros y gastos de este cliente) sin abrirlo. Ver docs/FACTURACION-OFICIOSOSIA.md.
//
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

/** Pasos del editor: los impuestos y los datos fiscales ya no existen (recibos). */
const PASOS = ["Datos", "Conceptos", "Revisar"] as const;
const ULTIMO_PASO = PASOS.length - 1;

const selectClass = "h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base md:text-sm";
const areaClass = "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const accionClass = "h-10 min-w-0 gap-2 whitespace-normal px-3 text-xs sm:text-sm";
function Campo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-medium text-muted-foreground">{titulo}</span>{children}</label>;
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
  // Recibo cuyo PDF se está viendo en la vista previa (no guarda ni emite nada).
  const [previa, setPrevia] = useState<ReciboEnPrevia | null>(null);
  // Mes cuyos gastos de Servicios hay que poner solos en cuanto carguen (recibo mensual nuevo o cambio de mes).
  const autoServicios = useRef<string | null>(null);
  const esMensual = tipoDeRecibo(f) === "mensual";
  const gastosQ = useGastosServiciosMes(esMensual ? f.mes : undefined);
  useEffect(() => {
    if (!autoServicios.current || !esMensual || autoServicios.current !== f.mes || !gastosQ.gastos) return;
    autoServicios.current = null;
    const gastos = gastosQ.gastos;
    try { setF(previo => aplicarGastosServicios(previo, gastos)); setDirty(true); setFacturaModificada(true); }
    catch (e) { toast.error(mensajeUsuario(e, "No se han podido añadir los gastos de Servicios.")); }
  }, [gastosQ.gastos, esMensual, f.mes]);
  const [confirmacion,setConfirmacion] = useState<{titulo:string;descripcion:string;accion:string;destructiva:boolean;resolver:(valor:boolean)=>void}|null>(null);
  const confirmar = (titulo:string,descripcion:string,accion:string,destructiva=true) => new Promise<boolean>(resolver=>setConfirmacion({titulo,descripcion,accion,destructiva,resolver}));
  const cerrarConfirmacion = (valor:boolean) => {confirmacion?.resolver(valor);setConfirmacion(null);};
  const iniciado = useRef(false);
  useEffect(() => {
    if (!q.data || iniciado.current) return;
    iniciado.current = true;
    if (q.data.config) {
      setF({...q.data.config.documento,catalogo:q.data.config.documento.catalogo ?? catalogoInicial()}); setVersionConfig(q.data.config.actualizado_en);
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
    if(!await confirmar("Eliminar concepto",`Vas a quitar «${concepto.concepto || "Concepto sin descripción"}» de este recibo. Guarda los cambios para conservar la eliminación.`,"Eliminar concepto"))return;
    cambiar(quitarConcepto(f,id));
  };
  const linea = (id: string, cambio: Partial<LineaFactura>) => cambiar({...f,lineas:f.lineas.map(l => l.id === id ? {...l,...cambio} : l)});
  const puedeCambiar = async () => !dirty || await confirmar("Cambios sin guardar", "Hay cambios sin guardar. ¿Quieres descartarlos para continuar?", "Descartar cambios");
  const abrir = async (guardada: FacturaGuardada) => {
    if (!await puedeCambiar()) return;
    setBorrador(null); autoServicios.current = null;
    setF({...guardada.documento,catalogo:f.catalogo ?? catalogoInicial()}); setActual({id:guardada.id,version:guardada.actualizado_en});
    setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null); setDirty(false); setFacturaModificada(false);
  };
  const abrirBorrador = async (b:BorradorGuardado) => {
    if (!await puedeCambiar()) return;
    const emitida=q.data?.facturas.find(g=>g.id===b.factura_id);
    autoServicios.current = null;
    setF({...b.documento,catalogo:f.catalogo ?? catalogoInicial()});
    setBorrador({id:b.id,version:b.actualizado_en,facturaId:b.factura_id});
    setActual(emitida?{id:emitida.id,version:emitida.actualizado_en}:null);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);setDirty(false);setFacturaModificada(true);setTab("nueva");setPaso(0);
  };
  const nuevo = async (tipo: TipoRecibo = "licencia") => {
    if (!await puedeCambiar()) return;
    setBorrador(null);
    const recibo = prepararNuevaFactura(f,[...(q.data?.facturas ?? []),...(q.data?.borradores ?? [])],tipo);
    autoServicios.current = recibo.mes ?? null;
    setF(recibo); setActual(null); setDirty(true); setFacturaModificada(false); setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);
  };
  const duplicar = async (g:FacturaGuardada) => {
    if (!await puedeCambiar()) return;
    setBorrador(null); autoServicios.current = null;
    const base = prepararNuevaFactura(f,[...(q.data?.facturas ?? []),...(q.data?.borradores ?? [])]);
    setF({...g.documento,numero:base.numero,fecha:base.fecha,vencimiento:base.vencimiento,catalogo:base.catalogo,
      lineas:g.documento.lineas.map(l=>({...l,id:crypto.randomUUID()}))});
    setActual(null); setDirty(true); setFacturaModificada(false); setTab("nueva"); setPaso(0);
    setVersionConfig(q.data?.config?.actualizado_en ?? null);
  };
  const descargarEmitida = async (g:FacturaGuardada) => {
    setBusy(true);
    try { const {descargarFactura} = await import("./pdf"); await descargarFactura(g.documento); }
    catch(e) { toast.error(mensajeUsuario(e, "No se ha podido descargar el recibo.")); }
    finally {setBusy(false);}
  };
  const eliminar = async (g:FacturaGuardada,estado:"emitida"|"borrador") => {
    if(!await confirmar(estado==="emitida"?"Eliminar recibo":"Eliminar borrador", `Vas a eliminar ${g.numero || "el documento sin número"}. Esta acción no se puede deshacer.`, "Eliminar"))return;
    setBusy(true);
    try {
      const resultado=await q.eliminar(g,estado);
      if(estado==="emitida" && actual?.id===g.id){setActual(null);setFacturaModificada(true);setDirty(true);}
      if(estado==="borrador" && borrador?.id===g.id){setBorrador(null);setDirty(true);}
      if(estado==="emitida" && borrador?.facturaId===g.id){
        const pendiente=resultado.borradores?.find(b=>b.id===borrador.id);
        setBorrador(pendiente?{id:pendiente.id,version:pendiente.actualizado_en,facturaId:null}:null);
      }
      toast.success(estado==="emitida"?"Recibo eliminado":"Borrador eliminado");
    }catch(e){toast.error(mensajeUsuario(e, "No se ha podido eliminar."));}
    finally{setBusy(false);}
  };
  const agregar = (ids:string[],paqueteId?:string) => {
    try { cambiar(agregarProductos(f,f.catalogo ?? catalogoInicial(),ids,paqueteId)); }
    catch(e) {toast.error(mensajeUsuario(e, "No se han podido añadir los servicios."));}
  };
  const cambiarTipoRecibo = (tipo: TipoRecibo) => {
    const siguiente = cambiarTipo(f, tipo);
    if (siguiente === f) return;
    autoServicios.current = tipo === "mensual" && !siguiente.lineas.some(l => l.proveedor) ? siguiente.mes ?? null : null;
    cambiar(siguiente);
  };
  const cambiarMesRecibo = (mes: string) => {
    const siguiente = cambiarMes(f, mes);
    if (siguiente === f) return;
    autoServicios.current = mes; // los gastos son los de ese mes: se refrescan al cargar
    cambiar(siguiente);
  };
  const ponerGastosServicios = () => {
    if (!gastosQ.gastos) return;
    try { cambiar(aplicarGastosServicios(f, gastosQ.gastos)); toast.success("Gastos de Servicios actualizados en el recibo"); }
    catch(e) { toast.error(mensajeUsuario(e, "No se han podido añadir los gastos de Servicios.")); }
  };
  const guardar = async (comoFactura: boolean, descargar = false, soloCatalogo = false) => {
    const errores = comoFactura ? erroresFactura(f) : facturaSchema.safeParse(f).success ? [] : ["Revisa fechas, cantidades, precios y límites de los textos."];
    if (errores.length) { toast.error(errores.join(" ")); return; }
    setBusy(true);
    try {
      // Un recibo no vence ni lleva datos fiscales: el vencimiento (que el documento guardado aún exige) es su misma fecha.
      const documento = sinDatosFiscales({...f, numero:f.numero.trim(), vencimiento:f.fecha});
      const resultado = await q.guardar(documento, versionConfig, comoFactura ? actual ?? {id:crypto.randomUUID(),version:null} : undefined, soloCatalogo ? undefined : borrador ?? {id:crypto.randomUUID(),version:null,facturaId:actual?.id});
      if(resultado.borrador)setBorrador({id:resultado.borrador.id,version:resultado.borrador.actualizado_en,facturaId:resultado.borrador.factura_id});
      if(comoFactura)setBorrador(null);
      setF(documento);
      setVersionConfig(resultado.config.actualizado_en); setDirty(false);
      if (resultado.factura) { setActual({id:resultado.factura.id,version:resultado.factura.actualizado_en}); setFacturaModificada(false); }
      toast.success(comoFactura ? actual ? "Recibo actualizado" : "Recibo emitido" : soloCatalogo ? "Tarifas guardadas" : "Borrador guardado");
      if (comoFactura && !descargar) setTab("emitidas");
      if (descargar) {
        const { descargarFactura } = await import("./pdf");
        await descargarFactura(documento);
      }
    } catch (e) { toast.error(mensajeUsuario(e, "No se ha podido guardar el recibo.")); }
    finally { setBusy(false); }
  };
  const recargar = async () => {
    if (!await puedeCambiar()) return;
    const r = await q.refetch();
    if (!r.data || r.error) return;
    autoServicios.current = null;
    const documento = r.data.config ? {...r.data.config.documento,catalogo:r.data.config.documento.catalogo ?? catalogoInicial()} : prepararNuevaFactura(nuevaFactura(),r.data.facturas);
    const pendiente=r.data.borradores?.find(b=>JSON.stringify(b.documento)===JSON.stringify(documento));
    const archivada = r.data.facturas.find(g => pendiente ? g.id===pendiente.factura_id : g.numero === documento.numero.trim());
    setBorrador(pendiente?{id:pendiente.id,version:pendiente.actualizado_en,facturaId:pendiente.factura_id}:null);
    setF(documento); setActual(archivada ? {id:archivada.id,version:archivada.actualizado_en} : null);
    setVersionConfig(r.data.config?.actualizado_en ?? null); setDirty(false);
    setFacturaModificada(!!archivada && JSON.stringify(archivada.documento) !== JSON.stringify(documento));
  };
  const anadirGasto = (g: GastoServicio) => {
    try { cambiar(anadirGastoServicio(f, g)); }
    catch(e) { toast.error(mensajeUsuario(e, "No se ha podido añadir el gasto.")); }
  };
  const total = totalesRecibo(f);
  // En un pago mensual los gastos de Servicios se editan en su bloque (precio y descuento de cada uno):
  // la lista de conceptos enseña solo la cuota y lo añadido a mano. `i` es su posición real en el recibo.
  const conceptos = f.lineas.map((l,i)=>({l,i})).filter(({l})=>!(esMensual && l.proveedor));
  const deshabilitado = busy || q.isLoading || q.isError;
  const ultimaCliente = ultimaFacturaCliente(q.data?.facturas ?? [],f.cliente);
  const clientes = [...(q.data?.facturas ?? [])].sort((a,b)=>b.documento.fecha.localeCompare(a.documento.fecha))
    .filter(g=>g.documento.cliente.nombre.trim())
    .filter((g,i,lista)=>lista.findIndex(v=>normalizar(v.documento.cliente.nombre)===normalizar(g.documento.cliente.nombre))===i);
  return <div ref={setRaiz} className="flex flex-col gap-3" style={alto ? {height:alto} : undefined}>
    <AlertDialog open={!!confirmacion} onOpenChange={abierto=>{if(!abierto)cerrarConfirmacion(false);}}>
      <AlertDialogContent>
        <AlertDialogHeader><AlertDialogTitle>{confirmacion?.titulo}</AlertDialogTitle><AlertDialogDescription className="break-words">{confirmacion?.descripcion}</AlertDialogDescription></AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction className={confirmacion?.destructiva ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined} onClick={()=>cerrarConfirmacion(true)}>{confirmacion?.accion}</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <VistaPreviaPdf recibo={previa} cerrar={()=>setPrevia(null)} />
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-base font-semibold leading-tight">Gestor Gasto · OficiosOsIA</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">Recibos de licencias y pagos mensuales · {dirty ? "Cambios sin guardar" : actual ? facturaModificada ? "Borrador guardado · recibo pendiente de actualizar" : "Recibo guardado" : q.data?.config ? "Borrador guardado" : "Nuevo borrador"}</p></div>
      <div className="flex flex-wrap gap-2">
        {/* En el móvil, nombres cortos: los tres botones caben en una fila y dejan alto para el recibo. */}
        <Button variant="outline" aria-label="Nueva licencia" onClick={() => void nuevo("licencia")} disabled={busy || q.isLoading}><FilePlus2 className="mr-2 h-4 w-4" /><span className="sm:hidden">Licencia</span><span className="hidden sm:inline">Nueva licencia</span></Button>
        <Button variant="outline" aria-label="Nuevo pago mensual" onClick={() => void nuevo("mensual")} disabled={busy || q.isLoading}><CalendarPlus className="mr-2 h-4 w-4" /><span className="sm:hidden">Pago mensual</span><span className="hidden sm:inline">Nuevo pago mensual</span></Button>
        <Button variant="outline" onClick={() => void recargar()} disabled={busy || q.isFetching} aria-label="Recargar recibos"><RefreshCw className="h-4 w-4" /></Button>
      </div>
    </div>
    {q.isError && <div role="alert" className="shrink-0 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
      <p className="font-semibold">No se han podido cargar los recibos</p>
      <p className="mt-1 break-words">{q.error.message}</p>
      <p className="mt-1">Si esta función acaba de instalarse, comprueba que se haya aplicado la migración de facturación. Puedes reintentar con el botón de recarga.</p>
    </div>}
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
      <PestanasPagina
        pestanas={[
          { valor: "emitidas", etiqueta: "Recibos" },
          { valor: "nueva", etiqueta: "Nuevo recibo", etiquetaCorta: "Nuevo" },
          { valor: "catalogo", etiqueta: "Tarifas" },
          { valor: "control", etiqueta: "Control Excel", etiquetaCorta: "Excel" },
        ]}
      />
      <TabsContent value="emitidas" className={`${regionClass} space-y-4 pt-3 data-[state=inactive]:hidden`}>
        {q.isLoading ? <p role="status">Cargando recibos…</p> : q.isError ? <p className="text-sm text-muted-foreground">El historial no está disponible. Reintenta la carga.</p> :
          <FacturasEmitidas eliminar={(g,estado)=>void eliminar(g,estado)} borradores={q.data?.borradores ?? []} editarBorrador={abrirBorrador} facturas={q.data?.facturas ?? []} busy={busy} editar={abrir} duplicar={duplicar} descargar={g=>void descargarEmitida(g)} nueva={()=>void nuevo("licencia")} previsualizar={(g,estado)=>setPrevia({documento:g.documento,borrador:estado==="borrador"})} />}
      </TabsContent>
      <TabsContent value="nueva" className={`${pestanaClass} gap-5`}>
      {actual && <p className="shrink-0 text-sm font-medium">Editando el recibo {f.numero}</p>}
    <div ref={inicioEditor} className="shrink-0 scroll-mt-4 space-y-3">
      <nav aria-label="Pasos del recibo" className="flex gap-1 border-b border-border/60">
        {PASOS.map((nombre,i)=><Button key={nombre} variant="ghost" className={"-mb-px h-10 min-w-0 flex-1 rounded-none border-b-2 px-1 text-xs shadow-none hover:bg-transparent hover:text-foreground active:bg-transparent active:text-foreground sm:flex-none sm:px-4 sm:text-sm pointer-coarse:h-11 "+(paso===i ? "border-foreground text-foreground" : "border-transparent text-muted-foreground")} aria-current={paso===i ? "step" : undefined} onClick={()=>irPaso(i)}>{i+1}. {nombre}</Button>)}
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="min-w-0 break-words text-muted-foreground">{TEXTO_TIPO_RECIBO[tipoDeRecibo(f)]}{esMensual && textoMesRecibo(f.mes) ? " · " + textoMesRecibo(f.mes) : ""} · {f.cliente.nombre || "Sin cliente"} · {f.lineas.filter(l=>l.concepto.trim()).length} conceptos</span><span>Total: <strong>{euros(total.total)}</strong></span></div>
    </div>
    <div ref={regionPaso} className={regionClass}>
    {q.isLoading ? <p role="status" className="py-10 text-center text-muted-foreground">Cargando recibos…</p> : (
      <div className="min-w-0">
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {paso === 0 && <>
          <Card><CardHeader><CardTitle className="text-base">1. Datos del recibo</CardTitle></CardHeader><CardContent className="space-y-4">
            <div role="group" aria-label="Tipo de recibo" className="grid gap-2 sm:grid-cols-2">
              {tiposRecibo.map(tipo => <Button key={tipo} type="button" variant={tipoDeRecibo(f)===tipo ? "default" : "outline"} aria-pressed={tipoDeRecibo(f)===tipo} className="h-auto min-h-11 flex-col items-start gap-0.5 whitespace-normal py-2 text-left" onClick={()=>cambiarTipoRecibo(tipo)}>
                <span className="font-semibold">{TEXTO_TIPO_RECIBO[tipo]}</span>
                <span className="text-xs font-normal opacity-80">{tipo==="licencia" ? "Pago único: instalación, licencias y módulos." : "Cuota fija del mes + gastos de IA, hosting… de Servicios."}</span>
              </Button>)}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo titulo="Número de recibo"><Input placeholder={siguienteNumero(q.data?.facturas ?? [],f.fecha)} maxLength={60} value={f.numero} onChange={e => cambiar({...f,numero:e.target.value})} /></Campo>
              <Campo titulo="Fecha"><Input type="date" value={f.fecha} onChange={e => cambiar({...f,fecha:e.target.value})} /></Campo>
              {esMensual && <Campo titulo="Mes que se paga"><Input type="month" value={f.mes ?? ""} onChange={e => cambiarMesRecibo(e.target.value)} /></Campo>}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo titulo="Cliente"><Input maxLength={120} value={f.cliente.nombre} onChange={e => cambiar({...f,cliente:{...f.cliente,nombre:e.target.value}})} /></Campo>
              <Campo titulo="Emitido por"><Input maxLength={120} value={f.emisor.nombre} onChange={e => cambiar({...f,emisor:{...f.emisor,nombre:e.target.value}})} /></Campo>
            </div>
            {clientes.length > 1 && <Campo titulo="Usar cliente guardado"><select aria-label="Usar cliente guardado" className={selectClass} value="" onChange={e=>{const g=clientes.find(v=>v.id===e.target.value);if(g)cambiar({...f,cliente:{...f.cliente,nombre:g.documento.cliente.nombre}});}}>
              <option value="">Seleccionar cliente…</option>{clientes.map(g=><option key={g.id} value={g.id}>{g.documento.cliente.nombre}</option>)}
            </select></Campo>}
            {!esMensual && ultimaCliente && <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Conceptos recurrentes del último recibo de este cliente: {ultimaCliente.numero}</p>
              <Button variant="outline" className="mt-2 h-auto whitespace-normal" onClick={()=>{try{cambiar(recuperarServicios(f,ultimaCliente.documento));}catch(e){toast.error(mensajeUsuario(e, "No se han podido recuperar los conceptos."));}}}>Añadir conceptos recurrentes del cliente</Button>
            </div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo titulo="Forma de pago"><textarea className={areaClass} maxLength={500} placeholder="Efectivo, transferencia, Bizum…" value={f.pago} onChange={e => cambiar({...f,pago:e.target.value})} /></Campo>
              <Campo titulo="Observaciones"><textarea className={areaClass} maxLength={2000} value={f.notas} onChange={e => cambiar({...f,notas:e.target.value})} /></Campo>
            </div>
            <p className="text-xs text-muted-foreground">Es un recibo sencillo: sin datos fiscales ni impuestos.</p>
          </CardContent></Card>
          </>}
          {paso === 1 && <>
          {esMensual
            ? <GastosServiciosRecibo mes={f.mes} gastos={gastosQ} enRecibo={f.lineas.filter(l=>l.proveedor)} poner={ponerGastosServicios}
                cambiar={(id,cambio)=>linea(id,cambio)} quitar={id=>cambiar(quitarConcepto(f,id))} anadir={anadirGasto} descuentoATodos={pct=>cambiar(descuentoAServicios(f,pct))} />
            : <details className="rounded-lg border p-3" open={!f.lineas.some(l=>l.concepto.trim())}><summary className="cursor-pointer text-sm font-medium">Añadir módulos o paquetes</summary><div className="mt-3"><SelectorServicios catalogo={f.catalogo ?? catalogoInicial()} lineas={f.lineas} agregar={agregar} /></div></details>}
          <Card><CardHeader><CardTitle className="text-base">2. Conceptos del recibo</CardTitle><p className="text-xs text-muted-foreground">{esMensual ? "La cuota y lo que añadas a mano. Los gastos de Servicios se editan arriba, en su bloque. " : ""}Todo se puede editar: descripción, precio y descuento de cada concepto. Arrastra desde el asa o usa las flechas para cambiar el orden.</p></CardHeader><CardContent className="space-y-4"><DndContext sensors={sensorsConceptos} collisionDetection={closestCenter} modifiers={[restrictToVerticalAxis]} onDragEnd={({active,over})=>{if(over)moverConcepto(f.lineas.findIndex(l=>l.id===active.id),f.lineas.findIndex(l=>l.id===over.id));}}><SortableContext items={conceptos.map(c=>c.l.id)} strategy={verticalListSortingStrategy}><div className="space-y-3">
            {conceptos.map(({l,i},j) => <ConceptoOrdenable key={l.id} id={l.id} index={j} total={conceptos.length} busy={busy} mover={(a,b)=>{if(conceptos[a] && conceptos[b])moverConcepto(conceptos[a].i,conceptos[b].i);}} eliminar={()=>void eliminarConcepto(l.id)}>
              <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><Campo titulo="Descripción"><Input maxLength={300} value={l.concepto} onChange={e => linea(l.id,{concepto:e.target.value})} /></Campo></div>
              </div>

              <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-4">
                <Campo titulo="Cantidad"><Input type="number" min={0.01} max={100000} step="0.01" value={l.cantidad} onChange={e=>linea(l.id,{cantidad:Number(e.target.value)})} /></Campo>
                <Campo titulo="Precio unitario (€)"><Input type="number" min={0} max={1000000} step="0.01" value={l.precio} onChange={e=>linea(l.id,{precio:Number(e.target.value)})} /></Campo>
                <Campo titulo="Descuento (%)"><Input type="number" min={0} max={100} step="0.01" value={l.descuento} onChange={e=>linea(l.id,{descuento:Number(e.target.value)})} /></Campo>
                <p className="pb-2 text-right text-sm font-medium">{euros(total.lineas[i].baseAntesGlobal)}</p>
              </div>
              <details className="rounded-md bg-muted/30 p-2"><summary className="cursor-pointer py-2.5 text-xs text-muted-foreground">Tipo y periodicidad · {l.periodicidad}</summary><div className="mt-2 grid grid-cols-2 gap-3"><Campo titulo="Tipo"><select aria-label="Tipo" className={selectClass} value={l.categoria} onChange={e => linea(l.id,{categoria:e.target.value as LineaFactura["categoria"]})}>{categorias.map(v => <option key={v}>{v}</option>)}</select></Campo>
                <Campo titulo="Periodicidad"><select aria-label="Periodicidad" className={selectClass} value={l.periodicidad} onChange={e => linea(l.id,{periodicidad:e.target.value as LineaFactura["periodicidad"]})}>{periodicidades.map(v => <option key={v}>{v}</option>)}</select></Campo></div>
              </details>
            </ConceptoOrdenable>)}
            </div></SortableContext></DndContext><Button variant="outline" disabled={f.lineas.length >= 100} onClick={() => cambiar(anadirConcepto(f))}><Plus className="mr-2 h-4 w-4" />Añadir concepto</Button>
          </CardContent></Card>
          <Card><CardHeader><CardTitle className="text-base">Descuento global</CardTitle></CardHeader><CardContent className="space-y-3">
            <Campo titulo="Descuento global (%)"><Input className="max-w-40" type="number" min={0} max={100} step="0.01" value={f.descuentoGlobal ?? 0} onChange={e=>cambiar({...f,descuentoGlobal:Number(e.target.value)})} /></Campo>
            <p className="text-xs text-muted-foreground">Se aplica a todo el recibo, después de los descuentos de cada concepto.</p>
            <p className="text-sm">Descuento total: <strong>{euros(total.descuentosLineas+total.descuentoGlobal)}</strong> · Total del recibo: <strong>{euros(total.total)}</strong></p>
          </CardContent></Card>
          </>}
          {paso === 2 && <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Vista previa del recibo</p>
            <Button type="button" variant="outline" className="h-10 gap-2 pointer-coarse:h-11" onClick={()=>setPrevia({documento:f,borrador:!actual || facturaModificada || dirty})}><Eye className="h-4 w-4" aria-hidden="true" />Vista previa del PDF</Button></div>
          <VistaFactura factura={f} />
          <p className="text-xs text-muted-foreground">El PDF usa formato A4 y añade páginas cuando sea necesario. «Vista previa del PDF» lo enseña tal cual, sin guardar ni emitir.</p>
        </div>}
        </fieldset>
      </div>
    )}
    </div>
    {/* Fuera de la región: siempre a la vista. El `sticky` solo actúa si la página desplaza (bajo el suelo). */}
    <div className="sticky bottom-0 z-10 flex shrink-0 flex-wrap gap-2 rounded-lg border bg-background/95 p-3 shadow-sm backdrop-blur sm:flex sm:flex-wrap sm:justify-end">
      <div className="flex w-full items-center justify-between gap-2 border-b pb-2 sm:mr-auto sm:w-auto sm:border-0 sm:pb-0">
        <Button variant="outline" disabled={paso===0 || busy} onClick={()=>irPaso(paso-1)}>Anterior</Button>
        <span className="px-2 text-xs text-muted-foreground">Paso {paso+1} de {PASOS.length}</span>
        {paso<ULTIMO_PASO && <Button disabled={busy} onClick={()=>irPaso(paso+1)}>Siguiente</Button>}
      </div>
      <Button className={accionClass} variant="outline" disabled={deshabilitado} onClick={() => void guardar(false)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />Guardar borrador</Button>
      {paso === ULTIMO_PASO && <><Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true)}><Save className="h-4 w-4 shrink-0 sm:mr-2" />{actual ? "Actualizar recibo" : "Emitir recibo"}</Button>
      <Button className={accionClass} disabled={deshabilitado} onClick={() => void guardar(true,true)}><Download className="h-4 w-4 shrink-0 sm:mr-2" />{busy ? "Procesando…" : "Descargar PDF"}</Button></>}
    </div>
      </TabsContent>
      <TabsContent value="catalogo" className={`${pestanaClass} gap-4`}>
        <div className={regionClass}><EditarCatalogo catalogo={f.catalogo ?? catalogoInicial()} cambiar={c=>cambiar({...f,catalogo:c})} busy={busy || q.isLoading} /></div>
        <Button className="shrink-0 self-start" disabled={deshabilitado} onClick={()=>void guardar(false,false,true)}><Save className="mr-2 h-4 w-4" />Guardar tarifas</Button>
      </TabsContent>
      <TabsContent value="control" className={`${regionClass} pt-3 data-[state=inactive]:hidden`}>
        {tab === "control" && <Suspense fallback={<p role="status" className="py-10 text-center text-sm text-muted-foreground">Cargando el control…</p>}><ControlExcel /></Suspense>}
      </TabsContent>
    </Tabs>
  </div>;
}
