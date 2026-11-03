import { useState } from "react";
import { Download, Pencil, Copy, FilePlus2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { euros, totalesFactura } from "./modelo";
import { normalizar } from "./catalogo";
import type { BorradorGuardado, FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

export function FacturasEmitidas({facturas,borradores=[],editarBorrador,busy,editar,duplicar,descargar,nueva,eliminar}: {
  borradores?:BorradorGuardado[];editarBorrador:(b:BorradorGuardado)=>void;
  facturas:FacturaGuardada[];busy:boolean;editar:(f:FacturaGuardada)=>void;duplicar:(f:FacturaGuardada)=>void;
  eliminar:(f:FacturaGuardada,estado:"emitida"|"borrador")=>void;
  descargar:(f:FacturaGuardada)=>void;nueva:()=>void;
}) {
  const [busqueda,setBusqueda] = useState("");
  const [desde,setDesde] = useState("");
  const [hasta,setHasta] = useState("");
  const [estado,setEstado] = useState("todas");
  const todas = [...facturas.map(f=>({...f,estado:"emitida" as const})),...borradores.map(b=>({...b,estado:"borrador" as const}))];
  const visibles = todas.filter(f=>
    (estado==="todas" || f.estado===estado) &&
    normalizar([f.numero,f.documento.cliente.nombre,f.documento.cliente.nif].join(" ")).includes(normalizar(busqueda)) &&
    (!desde || f.documento.fecha >= desde) && (!hasta || f.documento.fecha <= hasta)
  ).sort((a,b)=>b.documento.fecha.localeCompare(a.documento.fecha) || b.creado_en.localeCompare(a.creado_en));
  return <div className="space-y-4">
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
      <label className="text-xs text-muted-foreground">Buscar factura o cliente<Input value={busqueda} placeholder="Número, cliente o NIF…" onChange={e=>setBusqueda(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Estado<select aria-label="Estado" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-base md:text-sm" value={estado} onChange={e=>setEstado(e.target.value)}><option value="todas">Todas</option><option value="emitida">Emitidas</option><option value="borrador">Borradores</option></select></label>
      <label className="text-xs text-muted-foreground">Desde<Input type="date" value={desde} onChange={e=>setDesde(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Hasta<Input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="mt-1" /></label>
    </div>
    <p className="text-xs text-muted-foreground">{visibles.length} de {todas.length} facturas · Emitido: {euros(visibles.filter(f=>f.estado==="emitida").reduce((s,f)=>s+totalesFactura(f.documento).total,0))} · En borrador: {euros(visibles.filter(f=>f.estado==="borrador").reduce((s,f)=>s+totalesFactura(f.documento).total,0))}</p>
    {(busqueda || desde || hasta || estado!=="todas") && <Button variant="ghost" size="sm" onClick={()=>{setBusqueda("");setDesde("");setHasta("");setEstado("todas");}}>Limpiar filtros</Button>}
    {!visibles.length && <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{todas.length ? "No hay facturas que coincidan con la búsqueda" : "Todavía no hay facturas"}</p>
      <Button variant="outline" disabled={busy} className="mt-4" onClick={nueva}><FilePlus2 className="mr-2 h-4 w-4" />Crear nueva factura</Button>
    </div>}
    {visibles.map(g=><article key={g.estado+g.id} className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{g.numero || "Sin número"} <span className={"ml-2 inline-block rounded-full px-2 py-1 text-xs font-medium "+(g.estado==="emitida"?"bg-green-100 text-green-800":"bg-amber-100 text-amber-800")}>{g.estado==="emitida"?"Emitida":"Borrador"}</span></p><p className="mt-1 break-words text-sm">{g.documento.cliente.nombre || "Cliente pendiente"}</p>
        <p className="mt-1 text-xs text-muted-foreground">{g.documento.fecha.split("-").reverse().join("/")} · NIF: {g.documento.cliente.nif}</p></div>
      <p className="text-lg font-semibold">{euros(totalesFactura(g.documento).total)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>g.estado==="borrador"?editarBorrador(g):editar(g)}><Pencil className="mr-2 h-4 w-4" />{g.estado==="borrador"?"Continuar":"Editar"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>duplicar(g)}><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={()=>eliminar(g,g.estado)} aria-label={"Eliminar "+(g.estado==="emitida"?"factura ":"borrador ")+(g.numero || "sin número")}><Trash2 className="mr-2 h-4 w-4" />Eliminar</Button>
        {g.estado==="emitida" && <Button size="sm" disabled={busy} onClick={()=>descargar(g)}><Download className="mr-2 h-4 w-4" />PDF</Button>}
      </div>
    </article>)}
  </div>;
}
