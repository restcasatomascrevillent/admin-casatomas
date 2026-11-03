import { estadoCaducidad, fechaCaducidad } from "@/lib/cheques/caducidad";
import { useHoyCheques } from "@/hooks/useHoyCheques";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Ticket as TicketIcon } from "lucide-react";
import { DetalleCompra } from "./DetalleCompra";

interface Ticket {
  caduca_el?: string | null;
  id: string; creado_en: string | null; codigo: string | null; importe_eur: number;
  comprador_nombre: string; comprador_telefono?: string | null; destinatario_nombre: string | null; estado: string; usado: boolean;
}
interface Listado { caducados?: number; disponibles?: number; total: number; expedidos: number; canjeados: number; coincidencias: number; importe_pagado: number; tickets: Ticket[] }
const euro = (n: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(n);
// Tamaño de página fijo (petición del dueño, 2026-10-16): antes era elegible (5/10/20) con un
// selector «Por página»; ahora siempre son 6 y no hay forma de cambiarlo desde la interfaz.
const tamano = 6;

/** Texto y tono de un ticket: antes decidían el color de fondo de TODA la fila (muy saturado);
 * ahora solo un acento fino en el borde izquierdo de la fila y una píldora en «Estado». */
type Tono = "disponible" | "usado" | "pendiente" | "cancelado";
function estadoTicket(t: Ticket, hoy: string): { texto: string; tono: Tono } {
  if (t.estado === "cancelado") return { texto: "Cancelado", tono: "cancelado" };
  if (t.estado !== "pagado") return { texto: "Pendiente de pago", tono: "pendiente" };
  if (t.usado) return { texto: "Canjeado", tono: "usado" };
  if (estadoCaducidad(t.caduca_el, hoy).caducado) return { texto: "Caducado", tono: "usado" };
  return { texto: "Disponible", tono: "disponible" };
}
const TONOS: Record<Tono, { borde: string; pildora: string }> = {
  disponible: { borde: "border-l-emerald-400 dark:border-l-emerald-700", pildora: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" },
  usado: { borde: "border-l-rose-400 dark:border-l-rose-700", pildora: "bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300" },
  pendiente: { borde: "border-l-amber-300 dark:border-l-amber-700", pildora: "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300" },
  cancelado: { borde: "border-l-border", pildora: "bg-muted text-muted-foreground" },
};

// La tabla pasa de tarjetas apiladas a fila de tabla según el ANCHO REAL de su contenedor
// (container query), no el del viewport: así tiene en cuenta si el sidebar está plegado o no,
// no solo el tamaño de la ventana en la que vive la página. Mismo patrón que ya usa
// EditorSeccionesMenu.tsx, sin añadir el plugin @tailwindcss/container-queries.
const ANCHO_CONTENEDOR = "[container-type:inline-size]";
const TABLA_CLASE = "block w-full text-sm [@container(min-width:60rem)]:table [@container(min-width:60rem)]:table-fixed";
const CABECERA_CLASE = "hidden bg-muted/50 [@container(min-width:60rem)]:table-header-group";
const CUERPO_CLASE = "grid gap-2 [@container(min-width:60rem)]:table-row-group";
const ETIQUETA_MOVIL = "mb-1 block text-xs font-medium text-muted-foreground [@container(min-width:60rem)]:hidden";
const CELDA_CLASE = "min-w-0 p-2 break-words tabular-nums [overflow-wrap:anywhere]";
// Código y caducidad tienen formato fijo generado por el sistema ("CT-" + 12 hex, "dd/mm/aaaa"):
// en modo tabla no deben partirse nunca a media palabra, y si por lo que sea no cupieran, mejor
// un "…" que desbordar sobre la columna de al lado.
const CELDA_SIN_SALTO = "min-w-0 p-2 break-words tabular-nums [overflow-wrap:anywhere] [@container(min-width:60rem)]:overflow-hidden [@container(min-width:60rem)]:whitespace-nowrap [@container(min-width:60rem)]:text-ellipsis";
// Anchos pensados para el contenido real (no un reparto ciego a partes iguales): Código
// ("CT-C08320E6EB6A", monoespacio) y Comprador (nombres completos) son las columnas más
// anchas; Fecha lleva fecha+hora. Teléfono/Importe/Caducidad/Estado son cortas y no
// necesitan tanto hueco — pero sí el mínimo para no partirse a media palabra.
const ANCHOS_COLUMNA = ["w-[12%]", "w-[16%]", "w-[17%]", "w-[11%]", "w-[10%]", "w-[10%]", "w-[12%]", "w-[12%]"];

export function ListaTickets() {
  const hoy = useHoyCheques();
  const [texto, setTexto] = useState("");
  const busqueda = texto.trim();
  const [pagina, setPagina] = useState(0);
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
  }, [pagina, busqueda, hoy, orden, estado, desde, hasta, fechasInvalidas]);
  // Cada página crece con sus filas: la tabla no tiene contenedor de scroll.
  return <div className="flex min-w-0 flex-col gap-3">
    <Card className="rounded-2xl border-[#e5ddd0] shadow-sm overflow-hidden">
      <CardHeader className="bg-[#faf7f1] border-b border-[#eee7dc] p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white border border-[#e5ddd0] text-[#795440]"><TicketIcon className="h-5 w-5" /></div>
          <div><CardTitle className="text-xl sm:text-2xl">Tickets expedidos</CardTitle></div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <form role="search" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,2fr)_repeat(4,minmax(0,1fr))_auto] items-end" onSubmit={e => e.preventDefault()}>
          <label className="grid min-w-0 gap-1 text-xs font-medium">Buscar<Input type="search" aria-label="Buscar tickets por código o comprador" placeholder="Código, comprador, email o teléfono…" value={texto} onChange={e => { setTexto(e.target.value); setPagina(0); }} className="h-10 pointer-coarse:h-11" /></label>
          <label className="grid min-w-0 gap-1 text-xs font-medium">Estado<select aria-label="Filtrar por estado" value={estado} onChange={e => { setEstado(e.target.value); setPagina(0); }} className="h-10 pointer-coarse:h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="todos">Todos</option><option value="disponible">Disponibles</option><option value="canjeado">Canjeados</option><option value="caducado">Caducados</option><option value="cancelado">Cancelados</option>
          </select></label>
          <label className="grid min-w-0 gap-1 text-xs font-medium">Desde<Input aria-label="Fecha desde" type="date" value={desde} max={hasta || undefined} onChange={e => { setDesde(e.target.value); setPagina(0); }} className="h-10 min-w-0" /></label>
          <label className="grid min-w-0 gap-1 text-xs font-medium">Hasta<Input aria-label="Fecha hasta" type="date" value={hasta} min={desde || undefined} onChange={e => { setHasta(e.target.value); setPagina(0); }} className="h-10 min-w-0" /></label>
          <label className="grid min-w-0 gap-1 text-xs font-medium">Ordenar por<select aria-label="Ordenar tickets" value={orden} onChange={e => { setOrden(e.target.value); setPagina(0); }} className="h-10 pointer-coarse:h-11 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="fecha_desc">Más recientes</option><option value="fecha_asc">Más antiguos</option><option value="importe_asc">Importe: menor a mayor</option><option value="importe_desc">Importe: mayor a menor</option><option value="comprador_asc">Comprador: A–Z</option><option value="comprador_desc">Comprador: Z–A</option><option value="caducidad_asc">Caducidad: más próxima</option><option value="caducidad_desc">Caducidad: más lejana</option>
          </select></label>
          {hayFiltros && <Button type="button" variant="outline" className="h-10 pointer-coarse:h-11" onClick={limpiar}>Limpiar</Button>}
        </form>
        {fechasInvalidas && <p role="alert" className="text-sm text-destructive">La fecha inicial no puede ser posterior a la final.</p>}
        {cargando && datos && <span role="status" className="sr-only">Filtrando tickets…</span>}
        {cargando && !datos ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Cargando tickets…</p> : error ? <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">{error}</p> : datos && <>
          <div className={`min-w-0 ${ANCHO_CONTENEDOR} [@container(min-width:60rem)]:rounded-xl [@container(min-width:60rem)]:border [@container(min-width:60rem)]:border-[#eee7dc]`}>
            <table aria-busy={cargando} className={TABLA_CLASE}>
              <colgroup className="hidden [@container(min-width:60rem)]:table-column-group">
                {ANCHOS_COLUMNA.map((ancho, i) => <col key={i} className={ancho} />)}
              </colgroup>
              <thead className={CABECERA_CLASE}><tr>{["Fecha", "Código", "Comprador", "Teléfono", "Importe", "Caducidad", "Días restantes", "Estado"].map((label, i) => <th key={i} className="p-2 text-left text-xs font-medium text-muted-foreground">{label}</th>)}</tr></thead>
              <tbody className={CUERPO_CLASE}>
                {datos.tickets.map(t => {
                  const { texto: estadoTexto, tono } = estadoTicket(t, hoy);
                  // Sin "Queda(n)": en una columna estrecha repetida fila tras fila sobra (en Verificar
                  // cheque y en el detalle de la compra, donde es una frase suelta, sí se conserva.
                  const diasTexto = t.usado || t.estado !== "pagado" ? "—" : estadoCaducidad(t.caduca_el, hoy).texto.replace(/^Quedan? /, "");
                  return <tr key={t.id} onClick={() => setCompraSeleccionada(t.id)} className={`grid grid-cols-2 rounded-xl border-y border-r border-l-4 ${TONOS[tono].borde} [@container(min-width:60rem)]:table-row [@container(min-width:60rem)]:rounded-none [@container(min-width:60rem)]:border-r-0 [@container(min-width:60rem)]:border-b-0 cursor-pointer hover:bg-muted/50`}>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Fecha</span>{t.creado_en ? new Date(t.creado_en).toLocaleString("es-ES") : "Sin fecha registrada"}</td>
                    <td className={CELDA_SIN_SALTO}><span className={ETIQUETA_MOVIL}>Código</span><button type="button" aria-label={`Ver compra ${t.codigo}`} className="touch-hit rounded font-mono underline underline-offset-4 focus-visible:outline focus-visible:outline-2" onClick={e => { e.stopPropagation(); setCompraSeleccionada(t.id); }}>{t.codigo}</button></td>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Comprador</span>{t.comprador_nombre}</td>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Teléfono</span>{t.comprador_telefono || "—"}</td>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Importe</span>{euro(Number(t.importe_eur))}</td>
                    <td className={CELDA_SIN_SALTO}><span className={ETIQUETA_MOVIL}>Caducidad</span>{fechaCaducidad(t.caduca_el)}</td>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Días restantes</span>{diasTexto}</td>
                    <td className={CELDA_CLASE}><span className={ETIQUETA_MOVIL}>Estado</span><span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${TONOS[tono].pildora}`}>{estadoTexto}</span></td>
                  </tr>;
                })}
                {!datos.tickets.length && <tr><td colSpan={8} className="block p-6 text-center text-muted-foreground [@container(min-width:60rem)]:table-cell">No hay tickets que coincidan con los filtros.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#eee7dc] pt-3">
            <p role="status" className="text-sm text-muted-foreground">{datos.coincidencias ? pagina * tamano + 1 : 0}–{Math.min((pagina + 1) * tamano, datos.coincidencias)} de {datos.coincidencias} tickets</p>
            <nav aria-label="Paginación de tickets" className="flex w-full items-center justify-between gap-2 sm:w-auto">
              <Button variant="outline" disabled={cargando || fechasInvalidas || pagina === 0} onClick={() => setPagina(p => p - 1)}>Anterior</Button>
              <p className="text-sm whitespace-nowrap">Página {pagina + 1} de {Math.max(1, Math.ceil(datos.coincidencias / tamano))}</p>
              <Button variant="outline" disabled={cargando || fechasInvalidas || (pagina + 1) * tamano >= datos.coincidencias} onClick={() => setPagina(p => p + 1)}>Siguiente</Button>
            </nav>
          </div>
        </>}
      </CardContent>
    </Card>
    <DetalleCompra id={compraSeleccionada} onClose={() => setCompraSeleccionada(null)} />
  </div>;
}
