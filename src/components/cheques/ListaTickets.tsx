import { estadoCaducidad, fechaCaducidad } from "@/lib/cheques/caducidad";
import { useHoyCheques } from "@/hooks/useHoyCheques";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetalleCompra } from "./DetalleCompra";

interface Ticket {
  caduca_el?: string | null;
  id: string; creado_en: string | null; codigo: string | null; importe_eur: number;
  comprador_nombre: string; comprador_telefono?: string | null; destinatario_nombre: string | null; estado: string; usado: boolean;
}
interface Listado { caducados?: number; disponibles?: number; total: number; expedidos: number; canjeados: number; coincidencias: number; importe_pagado: number; tickets: Ticket[] }
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);

export function ListaTickets() {
  const hoy = useHoyCheques();
  const [texto, setTexto] = useState("");
  const busqueda = texto.trim();
  const [pagina, setPagina] = useState(0);
  const [tamano, setTamano] = useState(5);
  const [orden, setOrden] = useState("fecha_desc");
  const [estado, setEstado] = useState("todos");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const fechasInvalidas = !!desde && !!hasta && desde > hasta;
  const hayFiltros = !!texto || estado !== "todos" || !!desde || !!hasta || orden !== "fecha_desc";
  function limpiar() {
    setTexto(""); setEstado("todos"); setDesde(""); setHasta(""); setOrden("fecha_desc"); setPagina(0);
  }
  const [datos, setDatos] = useState<Listado | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [compraSeleccionada, setCompraSeleccionada] = useState<string | null>(null);
  useEffect(() => {
    if (fechasInvalidas) { setCargando(false); return; }
    let activo = true;
    setCargando(true); setError("");
    async function cargar() {
      try {
        const { data, error } = await (supabase as unknown as SupabaseClient).rpc("listar_cheques_regalo_v3", { p_pagina: pagina, p_busqueda: busqueda, p_tamano: tamano, p_orden: orden, p_estado: estado, p_desde: desde || null, p_hasta: hasta || null });
        if (error) throw error;
        if (!data || !Array.isArray(data.tickets)) throw new Error("Respuesta de listado inválida");
        if (activo && pagina > 0 && pagina >= Math.max(1, Math.ceil(data.coincidencias / tamano))) {
          setPagina(Math.max(0, Math.ceil(data.coincidencias / tamano) - 1)); return;
        }
        if (activo) setDatos({ ...data, tickets: data.tickets.filter((ticket: Ticket) => !!ticket.codigo?.trim() && (ticket.estado === "pagado" || ticket.estado === "cancelado")) } as Listado);
      } catch (e) {
        const detalle = e as { code?: string; message?: string };
        if (activo) { setDatos(null); setError(detalle.code === "PGRST202" ? "Falta instalar la función de listado de tickets en Supabase." : detalle.message || "No se pudo cargar el listado."); }
      } finally { if (activo) setCargando(false); }
    }
    // Agrupa las pulsaciones; al cambiar el texto se descartan las respuestas anteriores.
    const timer = window.setTimeout(() => void cargar(), busqueda ? 250 : 0);
    return () => { activo = false; window.clearTimeout(timer); };
  }, [pagina, busqueda, hoy, tamano, orden, estado, desde, hasta, fechasInvalidas]);
  // Cada página crece con sus filas: la tabla no tiene contenedor de scroll.
  return <div className="flex min-w-0 flex-col gap-3">
    <form role="search" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(0,1fr))_auto] items-end" onSubmit={e => e.preventDefault()}>
      <label className="grid min-w-0 gap-1 text-xs font-medium">Buscar<Input type="search" aria-label="Buscar tickets por código o comprador" placeholder="Código, comprador, email o teléfono…" value={texto} onChange={e => { setTexto(e.target.value); setPagina(0); }} className="h-11" /></label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">Estado<select aria-label="Filtrar por estado" value={estado} onChange={e => { setEstado(e.target.value); setPagina(0); }} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
        <option value="todos">Todos</option><option value="disponible">Disponibles</option><option value="canjeado">Canjeados</option><option value="caducado">Caducados</option><option value="cancelado">Cancelados</option>
      </select></label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">Desde<Input aria-label="Fecha desde" type="date" value={desde} max={hasta || undefined} onChange={e => { setDesde(e.target.value); setPagina(0); }} className="h-11 min-w-0" /></label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">Hasta<Input aria-label="Fecha hasta" type="date" value={hasta} min={desde || undefined} onChange={e => { setHasta(e.target.value); setPagina(0); }} className="h-11 min-w-0" /></label>
      <label className="grid min-w-0 gap-1 text-xs font-medium">Ordenar por<select aria-label="Ordenar tickets" value={orden} onChange={e => { setOrden(e.target.value); setPagina(0); }} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
        <option value="fecha_desc">Más recientes</option><option value="fecha_asc">Más antiguos</option><option value="importe_asc">Importe: menor a mayor</option><option value="importe_desc">Importe: mayor a menor</option><option value="comprador_asc">Comprador: A–Z</option><option value="comprador_desc">Comprador: Z–A</option><option value="caducidad_asc">Caducidad: más próxima</option><option value="caducidad_desc">Caducidad: más lejana</option>
      </select></label>
      {hayFiltros && <Button type="button" variant="outline" className="h-11" onClick={limpiar}>Limpiar</Button>}
    </form>
    {fechasInvalidas && <p role="alert" className="text-sm text-destructive">La fecha inicial no puede ser posterior a la final.</p>}
    {cargando && datos && <span role="status" className="sr-only">Filtrando tickets…</span>}
    {cargando && !datos ? <p role="status">Cargando tickets…</p> : error ? <p role="alert" className="rounded-xl border border-destructive/40 p-4">{error}</p> : datos && <>
      <dl aria-label="Resumen de tickets" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[["Tickets expedidos", datos.expedidos], ["Tickets canjeados", datos.canjeados], ["Tickets caducados", datos.caducados ?? 0], ["Importe con pago confirmado", euro(Number(datos.importe_pagado))]].map(([nombre, valor]) => <div key={nombre} className="min-w-0 rounded-lg border bg-card px-3 py-2"><dt className="text-xs leading-4 text-muted-foreground">{nombre}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums sm:text-lg">{valor}</dd></div>)}</dl>
      <div className="min-w-0 rounded-xl xl:border"><table aria-busy={cargando} className="block w-full text-sm xl:table xl:table-fixed"><thead className="hidden bg-background xl:table-header-group"><tr className="bg-muted/50">{["Fecha", "Código", "Comprador", "Teléfono", "Importe", "Caducidad", "Días restantes", "Estado"].map((label, i) => <th key={i} className="p-2 text-left break-words">{label}</th>)}</tr></thead><tbody className="grid gap-3 xl:table-row-group">
        {datos.tickets.map(t => <tr key={t.id} onClick={() => setCompraSeleccionada(t.id)} className={`grid grid-cols-2 rounded-xl border xl:table-row xl:rounded-none xl:border-x-0 xl:border-b-0 cursor-pointer hover:brightness-95 ${(t.usado || estadoCaducidad(t.caduca_el, hoy).caducado) ? "bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100" : t.estado === "pagado" ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" : ""}`}><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Fecha</span>{t.creado_en ? new Date(t.creado_en).toLocaleString("es-ES") : "Sin fecha registrada"}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Código</span><button type="button" aria-label={`Ver compra ${t.codigo}`} className="underline underline-offset-4 rounded focus-visible:outline focus-visible:outline-2" onClick={e => { e.stopPropagation(); setCompraSeleccionada(t.id); }}>{t.codigo}</button></td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Comprador</span>{t.comprador_nombre}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Teléfono</span>{t.comprador_telefono || "—"}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Importe</span>{euro(Number(t.importe_eur))}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Caducidad</span>{fechaCaducidad(t.caduca_el)}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Días restantes</span>{t.usado || t.estado !== "pagado" ? "—" : estadoCaducidad(t.caduca_el, hoy).texto}</td><td className="min-w-0 p-2 break-words [overflow-wrap:anywhere]"><span className="mb-1 block text-xs font-medium opacity-70 xl:hidden">Estado</span>{t.estado === "cancelado" ? "Cancelado" : t.estado !== "pagado" ? "Pendiente de pago" : t.usado ? "Canjeado" : estadoCaducidad(t.caduca_el, hoy).caducado ? "Caducado" : "Disponible"}</td></tr>)}
        {!datos.tickets.length && <tr><td colSpan={8} className="block p-6 text-center text-muted-foreground xl:table-cell">No hay tickets que coincidan con los filtros.</td></tr>}
      </tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">Por página<select aria-label="Tickets por página" className="h-10 rounded-md border border-input bg-background px-2" value={tamano} onChange={e => { setTamano(Number(e.target.value)); setPagina(0); }}><option value={5}>5</option><option value={10}>10</option><option value={20}>20</option></select></label>
        <p role="status" className="text-sm text-muted-foreground">{datos.coincidencias ? pagina * tamano + 1 : 0}–{Math.min((pagina + 1) * tamano, datos.coincidencias)} de {datos.coincidencias} tickets</p>
        <nav aria-label="Paginación de tickets" className="flex w-full items-center justify-between gap-2 sm:w-auto">
          <Button variant="outline" disabled={cargando || fechasInvalidas || pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button>
          <p className="text-sm whitespace-nowrap">Página {pagina + 1} de {Math.max(1, Math.ceil(datos.coincidencias / tamano))}</p>
          <Button variant="outline" disabled={cargando || fechasInvalidas || (pagina + 1) * tamano >= datos.coincidencias} onClick={() => setPagina(p => p + 1)}>Siguiente</Button>
        </nav>
      </div>
    </>}
    <DetalleCompra id={compraSeleccionada} onClose={() => setCompraSeleccionada(null)} />
  </div>;
}
