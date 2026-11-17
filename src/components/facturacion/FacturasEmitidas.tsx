import { useState } from "react";
import { Download, Eye, Pencil, Copy, FilePlus2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { euros, tipoDeRecibo, tituloRecibo, totalesRecibo } from "./modelo";
import { normalizar } from "./catalogo";
import type { BorradorGuardado, FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

const selectClass = "mt-1 h-10 w-full rounded-md border bg-background px-3 text-base md:text-sm";

/** Lista de recibos emitidos y borradores (17/11/2026: recibos, sin NIF ni impuestos). */
export function FacturasEmitidas({facturas,borradores=[],editarBorrador,busy,editar,duplicar,descargar,nueva,eliminar,previsualizar}: {
  borradores?:BorradorGuardado[];editarBorrador:(b:BorradorGuardado)=>void;
  facturas:FacturaGuardada[];busy:boolean;editar:(f:FacturaGuardada)=>void;duplicar:(f:FacturaGuardada)=>void;
  eliminar:(f:FacturaGuardada,estado:"emitida"|"borrador")=>void;
  descargar:(f:FacturaGuardada)=>void;nueva:()=>void;
  /** Abre la vista previa del PDF (también de un borrador). Sin ella no sale el botón. */
  previsualizar?:(f:FacturaGuardada,estado:"emitida"|"borrador")=>void;
}) {
  const [busqueda,setBusqueda] = useState("");
  const [desde,setDesde] = useState("");
  const [hasta,setHasta] = useState("");
  const [estado,setEstado] = useState("todas");
  const [tipo,setTipo] = useState("todos");
  const todas = [...facturas.map(f=>({...f,estado:"emitida" as const})),...borradores.map(b=>({...b,estado:"borrador" as const}))];
  const visibles = todas.filter(f=>
    (estado==="todas" || f.estado===estado) &&
    (tipo==="todos" || tipoDeRecibo(f.documento)===tipo) &&
    normalizar([f.numero,f.documento.cliente.nombre,tituloRecibo(f.documento)].join(" ")).includes(normalizar(busqueda)) &&
    (!desde || f.documento.fecha >= desde) && (!hasta || f.documento.fecha <= hasta)
  ).sort((a,b)=>b.documento.fecha.localeCompare(a.documento.fecha) || b.creado_en.localeCompare(a.creado_en));
  const suma = (e:"emitida"|"borrador") => euros(visibles.filter(f=>f.estado===e).reduce((s,f)=>s+totalesRecibo(f.documento).total,0));
  return <div className="space-y-4">
    <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto]">
      <label className="text-xs text-muted-foreground">Buscar recibo o cliente<Input value={busqueda} placeholder="Número, cliente o mes…" onChange={e=>setBusqueda(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Tipo<select aria-label="Tipo" className={selectClass} value={tipo} onChange={e=>setTipo(e.target.value)}><option value="todos">Todos</option><option value="licencia">Licencias globales</option><option value="mensual">Pagos mensuales</option></select></label>
      <label className="text-xs text-muted-foreground">Estado<select aria-label="Estado" className={selectClass} value={estado} onChange={e=>setEstado(e.target.value)}><option value="todas">Todos</option><option value="emitida">Emitidos</option><option value="borrador">Borradores</option></select></label>
      <label className="text-xs text-muted-foreground">Desde<Input type="date" value={desde} onChange={e=>setDesde(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Hasta<Input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="mt-1" /></label>
    </div>
    <p className="text-xs text-muted-foreground">{visibles.length} de {todas.length} recibos · Emitido: {suma("emitida")} · En borrador: {suma("borrador")}</p>
    {(busqueda || desde || hasta || estado!=="todas" || tipo!=="todos") && <Button variant="ghost" size="sm" onClick={()=>{setBusqueda("");setDesde("");setHasta("");setEstado("todas");setTipo("todos");}}>Limpiar filtros</Button>}
    {!visibles.length && <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{todas.length ? "No hay recibos que coincidan con la búsqueda" : "Todavía no hay recibos"}</p>
      <Button variant="outline" disabled={busy} className="mt-4" onClick={nueva}><FilePlus2 className="mr-2 h-4 w-4" />Crear un recibo</Button>
    </div>}
    {visibles.map(g=><article key={g.estado+g.id} className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{g.numero || "Sin número"} <span className={"ml-2 inline-block rounded-full px-2 py-1 text-xs font-medium "+(g.estado==="emitida"?"bg-green-100 text-green-800":"bg-amber-100 text-amber-800")}>{g.estado==="emitida"?"Emitido":"Borrador"}</span></p><p className="mt-1 break-words text-sm">{g.documento.cliente.nombre || "Cliente pendiente"}</p>
        <p className="mt-1 break-words text-xs text-muted-foreground">{g.documento.fecha.split("-").reverse().join("/")} · {tituloRecibo(g.documento)}</p></div>
      <p className="text-lg font-semibold">{euros(totalesRecibo(g.documento).total)}</p>
      <div className="flex flex-wrap gap-2">
        {previsualizar && <Button size="sm" variant="outline" disabled={busy} onClick={()=>previsualizar(g,g.estado)} aria-label={"Vista previa del PDF de "+(g.numero || "el borrador sin número")}><Eye className="mr-2 h-4 w-4" />Vista previa</Button>}
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>g.estado==="borrador"?editarBorrador(g):editar(g)}><Pencil className="mr-2 h-4 w-4" />{g.estado==="borrador"?"Continuar":"Editar"}</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>duplicar(g)}><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
        <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" disabled={busy} onClick={()=>eliminar(g,g.estado)} aria-label={"Eliminar "+(g.estado==="emitida"?"recibo ":"borrador ")+(g.numero || "sin número")}><Trash2 className="mr-2 h-4 w-4" />Eliminar</Button>
        {g.estado==="emitida" && <Button size="sm" disabled={busy} onClick={()=>descargar(g)}><Download className="mr-2 h-4 w-4" />PDF</Button>}
      </div>
    </article>)}
  </div>;
}
