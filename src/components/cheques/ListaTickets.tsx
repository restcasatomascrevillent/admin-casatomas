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
  const [datos, setDatos] = useState<Listado | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [compraSeleccionada, setCompraSeleccionada] = useState<string | null>(null);
  useEffect(() => {
    let activo = true;
    setCargando(true); setError("");
    async function cargar() {
      try {
        const { data, error } = await (supabase as unknown as SupabaseClient).rpc("listar_cheques_regalo_v2", { p_pagina: pagina, p_busqueda: busqueda });
        if (error) throw error;
        if (!data || !Array.isArray(data.tickets)) throw new Error("Respuesta de listado inválida");
        if (activo) setDatos({ ...data, tickets: data.tickets.filter((ticket: Ticket) => !!ticket.codigo?.trim() && (ticket.estado === "pagado" || ticket.estado === "cancelado")) } as Listado);
      } catch (e) {
        const detalle = e as { code?: string; message?: string };
        if (activo) { setDatos(null); setError(detalle.code === "PGRST202" ? "Falta instalar la función de listado de tickets en Supabase." : detalle.message || "No se pudo cargar el listado."); }
      } finally { if (activo) setCargando(false); }
    }
    // Agrupa las pulsaciones; al cambiar el texto se descartan las respuestas anteriores.
    const timer = window.setTimeout(() => void cargar(), busqueda ? 250 : 0);
    return () => { activo = false; window.clearTimeout(timer); };
  }, [pagina, busqueda, hoy]);
  // Con alto medido (pestaña Expedición de Cheques.tsx) la lista llena la pestaña: búsqueda,
  // totales y paginación quedan fijos y solo la tabla hace scroll, con la cabecera de columnas pegada
  // (`sticky top-0`; el `bg-background` del thead tapa las filas y la fila conserva su `bg-muted/50`).
  // Suelo de la tabla (como la lista de Suscriptores): 12 rem desde `md` y 32 rem en el móvil;
  // por debajo de ese suelo desplaza la pestaña entera. Sin
  // `overscroll-contain` en la tabla: al llegar a su final, el gesto sigue en la pestaña.
  return <div className="flex min-h-0 flex-1 flex-col gap-3">
    <form role="search" className="flex flex-col sm:flex-row gap-3" onSubmit={e => e.preventDefault()}>
      <Input type="search" aria-label="Buscar tickets por código o comprador" placeholder="Código, comprador, email o teléfono…" value={texto} onChange={e => { setTexto(e.target.value); setPagina(0); }} className="sm:max-w-md h-11" />
      {texto && <Button type="button" variant="outline" className="h-11" onClick={() => { setTexto(""); setPagina(0); }}>Limpiar</Button>}
    </form>
    {cargando && datos && <span role="status" className="sr-only">Filtrando tickets…</span>}
    {cargando && !datos ? <p role="status">Cargando tickets…</p> : error ? <p role="alert" className="rounded-xl border border-destructive/40 p-4">{error}</p> : datos && <>
      <dl aria-label="Resumen de tickets" className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[["Tickets expedidos", datos.expedidos], ["Tickets canjeados", datos.canjeados], ["Tickets caducados", datos.caducados ?? 0], ["Importe con pago confirmado", euro(Number(datos.importe_pagado))]].map(([nombre, valor]) => <div key={nombre} className="min-w-0 rounded-lg border bg-card px-3 py-2"><dt className="text-xs leading-4 text-muted-foreground">{nombre}</dt><dd className="mt-1 break-words text-base font-semibold tabular-nums sm:text-lg">{valor}</dd></div>)}</dl>
      <div className="min-h-[32rem] flex-1 overflow-auto rounded-xl border md:min-h-[12rem]"><table aria-busy={cargando} className="w-full text-sm"><thead className="sticky top-0 z-10 bg-background"><tr className="bg-muted/50">{["Fecha", "Código", "Comprador", "Teléfono", "Importe", "Caducidad", "Días restantes", "Estado"].map((label, i) => <th key={i} className="p-3 text-left whitespace-nowrap">{label}</th>)}</tr></thead><tbody>
        {datos.tickets.map(t => <tr key={t.id} onClick={() => setCompraSeleccionada(t.id)} className={`border-t cursor-pointer hover:brightness-95 ${(t.usado || estadoCaducidad(t.caduca_el, hoy).caducado) ? "bg-red-50 text-red-950 dark:bg-red-950/30 dark:text-red-100" : t.estado === "pagado" ? "bg-emerald-50 text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" : ""}`}><td className="p-3 whitespace-nowrap">{t.creado_en ? new Date(t.creado_en).toLocaleString("es-ES") : "Sin fecha registrada"}</td><td className="p-3 font-mono whitespace-nowrap"><button type="button" aria-label={`Ver compra ${t.codigo}`} className="underline underline-offset-4 rounded focus-visible:outline focus-visible:outline-2" onClick={e => { e.stopPropagation(); setCompraSeleccionada(t.id); }}>{t.codigo}</button></td><td className="p-3">{t.comprador_nombre}</td><td className="p-3 whitespace-nowrap">{t.comprador_telefono || "—"}</td><td className="p-3 whitespace-nowrap">{euro(Number(t.importe_eur))}</td><td className="p-3 whitespace-nowrap">{fechaCaducidad(t.caduca_el)}</td><td className="p-3 whitespace-nowrap">{t.usado || t.estado !== "pagado" ? "—" : estadoCaducidad(t.caduca_el, hoy).texto}</td><td className="p-3 whitespace-nowrap">{t.estado === "cancelado" ? "Cancelado" : t.estado !== "pagado" ? "Pendiente de pago" : t.usado ? "Canjeado" : estadoCaducidad(t.caduca_el, hoy).caducado ? "Caducado" : "Disponible"}</td></tr>)}
        {!datos.tickets.length && <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">No hay tickets que coincidan con la búsqueda.</td></tr>}
      </tbody></table></div>
      <div className="flex items-center justify-between gap-3"><Button variant="outline" disabled={cargando || pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button><p className="text-sm">Página {pagina + 1} de {Math.max(1, Math.ceil(datos.coincidencias / 50))}</p><Button variant="outline" disabled={cargando || (pagina + 1) * 50 >= datos.coincidencias} onClick={() => setPagina(p => p + 1)}>Siguiente</Button></div>
    </>}
    <DetalleCompra id={compraSeleccionada} onClose={() => setCompraSeleccionada(null)} />
  </div>;
}
