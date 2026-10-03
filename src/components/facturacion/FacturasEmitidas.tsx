import { useState } from "react";
import { Download, Pencil, Copy, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { euros, totalesFactura } from "./modelo";
import { normalizar } from "./catalogo";
import type { FacturaGuardada } from "@/hooks/useFacturacionOficiososia";

export function FacturasEmitidas({facturas,busy,editar,duplicar,descargar,nueva}: {
  facturas:FacturaGuardada[];busy:boolean;editar:(f:FacturaGuardada)=>void;duplicar:(f:FacturaGuardada)=>void;
  descargar:(f:FacturaGuardada)=>void;nueva:()=>void;
}) {
  const [busqueda,setBusqueda] = useState("");
  const [desde,setDesde] = useState("");
  const [hasta,setHasta] = useState("");
  const visibles = [...facturas].filter(f=>
    normalizar([f.numero,f.documento.cliente.nombre,f.documento.cliente.nif].join(" ")).includes(normalizar(busqueda)) &&
    (!desde || f.documento.fecha >= desde) && (!hasta || f.documento.fecha <= hasta)
  ).sort((a,b)=>b.documento.fecha.localeCompare(a.documento.fecha) || b.creado_en.localeCompare(a.creado_en));
  return <div className="space-y-4">
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <label className="text-xs text-muted-foreground">Buscar factura o cliente<Input value={busqueda} placeholder="Número, cliente o NIF…" onChange={e=>setBusqueda(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Desde<Input type="date" value={desde} onChange={e=>setDesde(e.target.value)} className="mt-1" /></label>
      <label className="text-xs text-muted-foreground">Hasta<Input type="date" value={hasta} onChange={e=>setHasta(e.target.value)} className="mt-1" /></label>
    </div>
    <p className="text-xs text-muted-foreground">{visibles.length} de {facturas.length} facturas · Total mostrado: {euros(visibles.reduce((s,f)=>s+totalesFactura(f.documento).total,0))}</p>
    {!visibles.length && <div className="rounded-xl border border-dashed p-8 text-center">
      <p className="font-medium">{facturas.length ? "No hay facturas que coincidan con la búsqueda" : "Todavía no hay facturas emitidas"}</p>
      <Button variant="outline" disabled={busy} className="mt-4" onClick={nueva}><FilePlus2 className="mr-2 h-4 w-4" />Crear nueva factura</Button>
    </div>}
    {visibles.map(g=><article key={g.id} className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="min-w-0 flex-1"><p className="break-words font-semibold">{g.numero}</p><p className="mt-1 break-words text-sm">{g.documento.cliente.nombre}</p>
        <p className="mt-1 text-xs text-muted-foreground">{g.documento.fecha.split("-").reverse().join("/")} · NIF: {g.documento.cliente.nif}</p></div>
      <p className="text-lg font-semibold">{euros(totalesFactura(g.documento).total)}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>editar(g)}><Pencil className="mr-2 h-4 w-4" />Editar</Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={()=>duplicar(g)}><Copy className="mr-2 h-4 w-4" />Duplicar</Button>
        <Button size="sm" disabled={busy} onClick={()=>descargar(g)}><Download className="mr-2 h-4 w-4" />PDF</Button>
      </div>
    </article>)}
  </div>;
}
