import { Check, Plus, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { categorias, periodicidades, euros, type CatalogoFacturacion, type LineaFactura } from "./modelo";
import { productosSeleccionados } from "./catalogo";

interface Props {
  catalogo: CatalogoFacturacion; lineas: LineaFactura[];
  agregar: (ids:string[],paqueteId?:string) => void;
}
export function SelectorServicios({catalogo,lineas,agregar}: Props) {
  const elegidos = productosSeleccionados(lineas,catalogo);
  return <Card><CardHeader className="pb-3"><CardTitle className="text-base">Añadir servicios en un clic</CardTitle>
    <p className="text-xs text-muted-foreground">Las tarifas se editan en «Módulos y paquetes». Después puedes ajustar cada importe en la factura.</p>
  </CardHeader><CardContent>
    <Tabs defaultValue="paquetes">
      <TabsList><TabsTrigger value="paquetes">Paquetes</TabsTrigger><TabsTrigger value="modulos">Módulos y servicios</TabsTrigger></TabsList>
      <TabsContent value="paquetes" className="space-y-2 pt-2">{catalogo.paquetes.length ? catalogo.paquetes.map(p => {
        const productos = catalogo.productos.filter(v=>p.productoIds.includes(v.id));
        const incluidos = productos.filter(v=>elegidos.has(v.id)).length;
        return <Button key={p.id} type="button" variant="outline" disabled={!productos.length || incluidos === productos.length} onClick={()=>agregar(p.productoIds,p.id)} className="h-auto w-full justify-start gap-3 whitespace-normal py-3 text-left">
          <Package className="h-5 w-5 shrink-0" /><span className="min-w-0"><strong className="block">{p.nombre}</strong>
            <span className="mt-1 block text-xs font-normal text-muted-foreground">{productos.map(v=>v.nombre).join(" · ")}</span>
            <span className="mt-1 block text-xs">{incluidos}/{productos.length} incluidos en esta factura</span>
          </span><Plus className="ml-auto h-4 w-4 shrink-0" />
        </Button>;
      }) : <p className="text-sm text-muted-foreground">Crea un paquete en la pestaña de catálogo.</p>}</TabsContent>
      <TabsContent value="modulos" className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">{catalogo.productos.map(p =>
        <Button key={p.id} type="button" variant="outline" disabled={elegidos.has(p.id)} onClick={()=>agregar([p.id])} className="h-auto justify-start gap-2 whitespace-normal py-3 text-left">
          {elegidos.has(p.id) ? <Check className="h-4 w-4 shrink-0" /> : <Plus className="h-4 w-4 shrink-0" />}
          <span className="min-w-0"><span className="block">{p.nombre}</span><span className="mt-1 block text-xs font-normal text-muted-foreground">{euros(p.precio)} · {p.periodicidad}</span></span>
        </Button>)}</TabsContent>
    </Tabs>
  </CardContent></Card>;
}

export function EditarCatalogo({catalogo,cambiar,busy}: {catalogo:CatalogoFacturacion;cambiar:(c:CatalogoFacturacion)=>void;busy:boolean}) {
  const producto = (id:string, v:Partial<CatalogoFacturacion["productos"][number]>) => cambiar({...catalogo,productos:catalogo.productos.map(p=>p.id===id?{...p,...v}:p)});
  const selectClass = "h-10 w-full rounded-md border border-input bg-background px-2 text-sm";
  return <fieldset disabled={busy} className="min-w-0 space-y-5">
    <Card><CardHeader><CardTitle className="text-base">Tarifas de módulos y servicios</CardTitle>
      <p className="text-sm text-muted-foreground">Define tus precios una vez. Se copiarán al seleccionar un módulo o paquete en una nueva factura.</p>
    </CardHeader><CardContent className="space-y-3">
      {catalogo.productos.map(p=><div key={p.id} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-xs">Servicio<Input aria-label={"Nombre de " + p.nombre} maxLength={160} value={p.nombre} onChange={e=>producto(p.id,{nombre:e.target.value})} className="mt-1" /></label>
        <label className="text-xs">Precio (€)<Input aria-label={"Precio de " + p.nombre} type="number" min={0} max={1000000} step="0.01" value={p.precio} onChange={e=>producto(p.id,{precio:Number(e.target.value)})} className="mt-1" /></label>
        <label className="text-xs">Periodicidad<select className={selectClass+" mt-1"} value={p.periodicidad} onChange={e=>producto(p.id,{periodicidad:e.target.value as LineaFactura["periodicidad"]})}>{periodicidades.map(v=><option key={v}>{v}</option>)}</select></label>
        <label className="text-xs">Tipo<select className={selectClass+" mt-1"} value={p.categoria} onChange={e=>producto(p.id,{categoria:e.target.value as LineaFactura["categoria"]})}>{categorias.map(v=><option key={v}>{v}</option>)}</select></label>
      </div>)}
      <Button type="button" variant="outline" disabled={catalogo.productos.length>=100} onClick={()=>cambiar({...catalogo,productos:[...catalogo.productos,{id:crypto.randomUUID(),nombre:"Nuevo servicio",categoria:"Módulo",precio:0,periodicidad:"Mensual"}]})}><Plus className="mr-2 h-4 w-4" />Añadir servicio al catálogo</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Paquetes</CardTitle>
      <p className="text-sm text-muted-foreground">Agrupa módulos para añadirlos juntos. Se mantienen sus precios y periodicidades y no se duplican servicios ya incluidos.</p>
    </CardHeader><CardContent className="space-y-3">{catalogo.paquetes.map(p=><details key={p.id} className="rounded-lg border p-3">
      <summary className="cursor-pointer text-sm font-semibold">{p.nombre} · {p.productoIds.length} servicios</summary>
      <label className="mt-3 block text-xs">Nombre del paquete<Input value={p.nombre} maxLength={120} className="mt-1" onChange={e=>cambiar({...catalogo,paquetes:catalogo.paquetes.map(v=>v.id===p.id?{...v,nombre:e.target.value}:v)})} /></label>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{catalogo.productos.map(v=><label key={v.id} className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={p.productoIds.includes(v.id)} onChange={e=>cambiar({...catalogo,paquetes:catalogo.paquetes.map(pack=>pack.id===p.id?{...pack,productoIds:e.target.checked?[...pack.productoIds,v.id]:pack.productoIds.filter(id=>id!==v.id)}:pack)})} />{v.nombre}
      </label>)}</div>
    </details>)}
      <Button type="button" variant="outline" disabled={catalogo.paquetes.length>=30} onClick={()=>cambiar({...catalogo,paquetes:[...catalogo.paquetes,{id:crypto.randomUUID(),nombre:"Nuevo paquete",productoIds:[]}]})}><Plus className="mr-2 h-4 w-4" />Crear paquete</Button>
    </CardContent></Card>
  </fieldset>;
}
