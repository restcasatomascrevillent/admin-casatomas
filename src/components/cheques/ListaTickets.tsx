import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

interface Ticket {
  id: string; creado_en: string | null; codigo: string | null; importe_eur: number;
  comprador_nombre: string; destinatario_nombre: string | null; estado: string; usado: boolean;
}
interface Listado { total: number; expedidos: number; canjeados: number; coincidencias: number; importe_pagado: number; tickets: Ticket[] }
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function ListaTickets() {
  const [texto, setTexto] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [pagina, setPagina] = useState(0);
  const [datos, setDatos] = useState<Listado | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let activo = true;
    setCargando(true); setError("");
    async function cargar() {
      try {
        const { data, error } = await (supabase as unknown as SupabaseClient).rpc("listar_cheques_regalo_v2", { p_pagina: pagina, p_busqueda: busqueda });
        if (error) throw error;
        if (!data || !Array.isArray(data.tickets)) throw new Error("Respuesta de listado inválida");
        if (activo) setDatos({ ...data, tickets: data.tickets.filter((ticket: Ticket) => ticket.estado === "pagado" || ticket.estado === "cancelado") } as Listado);
      } catch (e) {
        const detalle = e as { code?: string; message?: string };
        if (activo) { setDatos(null); setError(detalle.code === "PGRST202" ? "Falta instalar la función de listado de tickets en Supabase." : detalle.message || "No se pudo cargar el listado."); }
      } finally { if (activo) setCargando(false); }
    }
    void cargar();
    return () => { activo = false; };
  }, [pagina, revision, busqueda]);
  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">Expedición total de tickets</h2><p className="text-sm text-muted-foreground">Todos los cheques regalo, del más reciente al más antiguo.</p></div><Button variant="outline" disabled={cargando} onClick={() => setRevision(r => r + 1)}>Actualizar</Button></div>
    <form className="flex flex-col sm:flex-row gap-3" onSubmit={e => { e.preventDefault(); setPagina(0); setBusqueda(texto.trim()); setRevision(r => r + 1); }}>
      <Input aria-label="Buscar tickets por código o comprador" placeholder="Buscar por código o comprador…" value={texto} onChange={e => setTexto(e.target.value)} className="sm:max-w-md h-11" />
      <Button type="submit" className="h-11">Buscar</Button>
      {(texto || busqueda) && <Button type="button" variant="outline" className="h-11" onClick={() => { setTexto(""); setBusqueda(""); setPagina(0); }}>Limpiar</Button>}
    </form>
    {cargando ? <p role="status">Cargando tickets…</p> : error ? <p role="alert" className="rounded-xl border border-destructive/40 p-4">{error}</p> : datos && <>
      <div className="grid gap-3 sm:grid-cols-3">{[["Tickets expedidos", datos.expedidos], ["Tickets canjeados", datos.canjeados], ["Importe con pago confirmado", euro(Number(datos.importe_pagado))]].map(([nombre, valor]) => <Card key={nombre}><CardContent className="pt-5"><p className="text-sm text-muted-foreground">{nombre}</p><p className="text-2xl font-semibold mt-1">{valor}</p></CardContent></Card>)}</div>
      <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm"><thead className="bg-muted/50"><tr>{["Fecha", "Código", "Comprador", "Importe", "Estado"].map((label, i) => <th key={i} className="p-3 text-left whitespace-nowrap">{label}</th>)}</tr></thead><tbody>
        {datos.tickets.map(t => <tr key={t.id} className={`border-t ${t.usado ? "bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100" : t.estado === "pagado" ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" : ""}`}><td className="p-3 whitespace-nowrap">{t.creado_en ? new Date(t.creado_en).toLocaleString("es-ES") : "Sin fecha registrada"}</td><td className="p-3 font-mono whitespace-nowrap">{t.codigo || "Sin expedir"}</td><td className="p-3">{t.comprador_nombre}</td><td className="p-3 whitespace-nowrap">{euro(Number(t.importe_eur))}</td><td className="p-3 whitespace-nowrap">{t.estado === "cancelado" ? "Cancelado" : t.estado !== "pagado" ? "Pendiente de pago" : t.usado ? "Canjeado" : "Disponible"}</td></tr>)}
        {!datos.tickets.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No hay tickets que coincidan con la búsqueda.</td></tr>}
      </tbody></table></div>
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button><p className="text-sm">Página {pagina + 1} de {Math.max(1, Math.ceil(datos.coincidencias / 50))}</p><Button variant="outline" disabled={(pagina + 1) * 50 >= datos.coincidencias} onClick={() => setPagina(p => p + 1)}>Siguiente</Button></div>
    </>}
  </div>;
}
