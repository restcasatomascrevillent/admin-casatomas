import { useEffect, useState, type ReactNode } from "react";
import { Bell, CheckCheck, CheckCircle2, ChevronDown, ExternalLink, Info, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAvisosSeccion, useContadorAvisosSeccion, type FiltrosAvisosSeccion } from "@/hooks/useAvisosSeccion";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { agruparPorDia, EVENTO_ABRIR_AVISOS, horaAviso, PARAM_ABRIR_AVISOS, reservaDeAviso, rutaDeAviso, SECCIONES_AVISOS, TIPO_ICON, type SeccionAvisos } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { EstadoReservaAviso, useReservasAvisos } from "@/hooks/useEstadosReservasAvisos";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useSearchParams } from "react-router-dom";
import { useAbrirAviso } from "@/hooks/useAbrirAviso";
import { AjustesAvisosEnVivo } from "@/components/notificaciones/AvisosEnVivo";
import { useEstadoAvisosEnVivo } from "@/hooks/useAvisosEnVivo";
import { avisosEnVivo } from "@/lib/avisosEnVivo/preferencias";

/**
 * Botón «Avisos» de una sección (Reservas, Facturas). 06/11/2026, petición del dueño: los avisos
 * dejan de ser una entrada de la barra lateral y pasan a cada sección. En rojo y con el número de
 * avisos sin revisar; sin ninguno, discreto. Abre un modal con los avisos de la sección, filtros
 * (sin revisar o todos, y por tipo), «Revisado» uno a uno o todos, y el enlace a su origen.
 */
/** `compacto`: el texto «Avisos» solo en pantallas muy anchas (barra única de Facturas › Análisis). */
export function BotonAvisosSeccion({ seccion, className, compacto = false }: { seccion: SeccionAvisos; className?: string; compacto?: boolean }) {
  const [abierto, setAbierto] = useState(false);
  // «Ver» en el aviso de una reserva abre su ficha ENCIMA del modal de avisos (11/11/2026); al cerrarla se
  // vuelve a la lista. El diálogo vive aquí, fuera del modal (que se desmonta al cerrarse).
  const { abrirAviso, abreFicha, dialogoAviso } = useAbrirAviso();
  // «Ver todas» de otra parte de la sección (p. ej. «Requiere atención» de Análisis) abre este modal.
  useEffect(() => {
    const alAbrir = (e: Event) => {
      if ((e as CustomEvent<{ seccion?: string }>).detail?.seccion === seccion) setAbierto(true);
    };
    window.addEventListener(EVENTO_ABRIR_AVISOS, alAbrir);
    return () => window.removeEventListener(EVENTO_ABRIR_AVISOS, alAbrir);
  }, [seccion]);
  // `?avisos=reservas` en la URL (CAS-9, 17/11/2026): los avisos de reservas del Dashboard traen aquí, con el
  // modal ya abierto. Se abre una vez y se quita de la URL (atrás no lo vuelve a abrir).
  const [params, setParams] = useSearchParams();
  const pedido = params.get(PARAM_ABRIR_AVISOS) === seccion;
  useEffect(() => {
    if (!pedido) return;
    setAbierto(true);
    if (seccion === "reservas") avisosEnVivo.marcarVistos();
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.delete(PARAM_ABRIR_AVISOS);
      return n;
    }, { replace: true });
  }, [pedido, seccion, setParams]);
  const pendientes = useContadorAvisosSeccion(seccion);
  const conPendientes = pendientes > 0;
  // En Reservas, late mientras haya algo nuevo sin mirar (AvisosEnVivo); abrirlo lo da por visto.
  const { sinVer } = useEstadoAvisosEnVivo();
  const late = seccion === "reservas" && sinVer > 0;
  const etiqueta = conPendientes
    ? `Avisos: ${pendientes} sin revisar`
    : "Avisos: ninguno sin revisar";

  return (
    <>
      <Button
        type="button"
        variant={conPendientes ? "destructive" : "outline"}
        className={cn(
          "relative h-9 shrink-0 gap-1.5 px-3 pointer-coarse:h-9",
          late && "bg-red-600 text-white ring-2 ring-red-500 ring-offset-2 ring-offset-background hover:bg-red-700 motion-safe:animate-pulse",
          className,
        )}
        onClick={() => {
          setAbierto(true);
          if (seccion === "reservas") avisosEnVivo.marcarVistos();
        }}
        aria-label={etiqueta}
        title={etiqueta}
        data-testid={`avisos-${seccion}`}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        <span className={compacto ? "hidden 2xl:inline" : "hidden sm:inline"}>Avisos</span>
        {conPendientes && (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-flex min-w-6 items-center justify-center rounded-full bg-white px-1.5 text-sm font-bold leading-6 text-destructive"
          >
            {pendientes > 99 ? "99+" : pendientes}
          </span>
        )}
      </Button>
      {abierto && (
        <ModalAvisos
          seccion={seccion}
          abierto={abierto}
          onAbiertoChange={setAbierto}
          pendientes={pendientes}
          abrirAviso={abrirAviso}
          abreFicha={abreFicha}
        />
      )}
      {dialogoAviso}
    </>
  );
}

/**
 * Color de cada fila en los avisos de Reservas (CAS-9, 17/11/2026, petición del dueño: «diferentes tipos de colores
 * de filas»): azul la reserva nueva (hay que verificarla), rojo la cancelada (solo revisar) y, desde el 18/11/2026,
 * verde la que ha confirmado el cliente con el enlace del correo (solo revisar). Revisada, más clara.
 */
const TONO_AVISO_RESERVA: Record<string, { borde: string; fondo: string; fondoRevisado: string; icono: string }> = {
  reserva_nueva: {
    borde: "border-l-sky-500",
    fondo: "bg-sky-50 dark:bg-sky-950/40",
    fondoRevisado: "bg-sky-50/40 dark:bg-sky-950/15",
    icono: "text-sky-700 dark:text-sky-300",
  },
  reserva_confirmada: {
    borde: "border-l-emerald-500",
    fondo: "bg-emerald-50 dark:bg-emerald-950/40",
    fondoRevisado: "bg-emerald-50/40 dark:bg-emerald-950/15",
    icono: "text-emerald-700 dark:text-emerald-300",
  },
  reserva_cancelada: {
    borde: "border-l-red-500",
    fondo: "bg-red-50 dark:bg-red-950/40",
    fondoRevisado: "bg-red-50/40 dark:bg-red-950/15",
    icono: "text-red-700 dark:text-red-300",
  },
};

function Chip({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={onClick}
      className={cn(
        "min-h-9 rounded-full border px-3 text-sm transition-colors",
        activo ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function ModalAvisos({
  seccion,
  abierto,
  onAbiertoChange,
  pendientes,
  abrirAviso,
  abreFicha,
}: {
  seccion: SeccionAvisos;
  abierto: boolean;
  onAbiertoChange: (abierto: boolean) => void;
  pendientes: number;
  abrirAviso: ReturnType<typeof useAbrirAviso>["abrirAviso"];
  abreFicha: ReturnType<typeof useAbrirAviso>["abreFicha"];
}) {
  const config = SECCIONES_AVISOS[seccion];
  const esReservas = seccion === "reservas";
  // Se abre en «Sin revisar» si hay alguno; si no, en «Todos» (para ver el historial).
  const [filtros, setFiltros] = useState<FiltrosAvisosSeccion>({
    // Siempre en «Sin revisar» (12/11/2026, petición del dueño: «que salgan los sin revisar por defecto»).
    estado: "sin_revisar",
    tipo: "todos",
  });
  const { avisos, loading, cargandoMas, hayMas, error, cargarMas, marcarRevisado, marcarTodosRevisados } =
    useAvisosSeccion(seccion, filtros, abierto);
  // Cada reserva avisada (12/11/2026: su estado; 17/11/2026, CAS-9: también lo que necesita «Verificar»).
  const reservas = useReservasAvisos(avisos);
  // 18/11/2026, petición del dueño: en azul solo las reservas que hay que verificar. Una «Reserva nueva» cuya reserva
  // ya no está pendiente (verificada, confirmada, cancelada) no sale en «Sin revisar»; la base de datos ya la da por
  // revisada (20261212720000), esto lo cubre mientras la lista abierta no se relee.
  const yaNoPorVerificar = (n: NotificacionDashboard) => {
    if (!esReservas || n.tipo !== "reserva_nueva" || filtros.estado !== "sin_revisar") return false;
    const id = reservaDeAviso(n);
    const estado = id ? reservas.get(id)?.estado : undefined;
    return estado !== undefined && estado !== "pendiente";
  };
  const grupos = agruparPorDia(avisos.filter((n) => !yaNoPorVerificar(n)));
  const estados = new Map([...reservas].map(([id, r]) => [id, r.estado]));
  const { canAccess: puedeEditarReservas } = useCanAccessSection("reservas", "edit");
  const { aceptar, estaEnCurso } = useAccionesServicioReserva();
  const haySinRevisar = avisos.some((n) => !n.leida) || pendientes > 0;
  const etiquetaTipo = (tipo: string) => config.tipos.find((t) => t.tipo === tipo)?.etiqueta ?? tipo;

  const irAlOrigen = (n: NotificacionDashboard) => {
    // En Reservas «Ver» solo enseña la reserva: el aviso se cierra con «Verificar» o «Revisado» (CAS-9). En el
    // resto de secciones, ir al origen lo da por revisado, como siempre.
    if (!esReservas) void marcarRevisado(n.id);
    // La ficha de una reserva se abre encima y el modal sigue debajo; ir a otra pantalla lo cierra.
    if (!abreFicha(n)) onAbiertoChange(false);
    abrirAviso(n);
  };

  /** «Verificar» desde el aviso (CAS-9): la misma acción que en la ficha (correo al cliente) y el aviso queda revisado. */
  const verificarDesdeAviso = async (n: NotificacionDashboard) => {
    const id = reservaDeAviso(n);
    const reserva = id ? reservas.get(id) : undefined;
    if (!reserva) return;
    const r = await aceptar(reserva);
    if (r.ok) void marcarRevisado(n.id);
  };

  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-1.5rem)] max-w-2xl flex-col gap-3 p-4 sm:p-6">
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-destructive" aria-hidden="true" />
            {config.titulo}
          </DialogTitle>
          <DialogDescription>
            {pendientes > 0 ? `${pendientes} sin revisar.` : "Ninguno sin revisar."}{" "}
            {esReservas
              ? "«Verificar» confirma la reserva al cliente y quita el aviso; «Ver» abre la reserva."
              : "Pulsa un aviso para ir a lo que lo ha generado."}
          </DialogDescription>
          {esReservas && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="leyenda-avisos-reservas">
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-l-sky-500 bg-sky-100 dark:bg-sky-900/60" aria-hidden="true" />Nueva: verificar</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-l-emerald-500 bg-emerald-100 dark:bg-emerald-900/60" aria-hidden="true" />Confirmada por el cliente: revisar</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm border-l-4 border-l-red-500 bg-red-100 dark:bg-red-900/60" aria-hidden="true" />Cancelada: revisar</span>
            </p>
          )}
        </DialogHeader>

        {/* Sonido y avisos del ordenador, plegados (12/11/2026, captura del dueño en el móvil: ocupaban media pantalla). */}
        {seccion === "reservas" && (
          <details className="group shrink-0 rounded-md border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <Volume2 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              Sonido y avisos en este dispositivo
              <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <AjustesAvisosEnVivo className="border-t px-3 py-2" />
          </details>
        )}

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado">
            <Chip activo={filtros.estado === "sin_revisar"} onClick={() => setFiltros((f) => ({ ...f, estado: "sin_revisar" }))}>
              Sin revisar
            </Chip>
            <Chip activo={filtros.estado === "todos"} onClick={() => setFiltros((f) => ({ ...f, estado: "todos" }))}>
              Todos
            </Chip>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-9 gap-1.5 px-2"
              onClick={() => void marcarTodosRevisados()}
              disabled={!haySinRevisar}
              aria-label="Marcar todos como revisados"
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Revisar todos
            </Button>
          </div>
          {/* En el móvil, un desplegable en vez de chips (12/11/2026, capturas del dueño: Facturas tiene 15 tipos y en Reservas
              «Canceladas» quedaba sola en otra fila). Desde 640 px, los chips. */}
          {config.tipos.length > 1 && (
            <select
              aria-label="Filtrar por tipo"
              value={filtros.tipo}
              onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.target.value }))}
              className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm sm:hidden"
            >
              <option value="todos">Todos los tipos</option>
              {config.tipos.map((t) => (
                <option key={t.tipo} value={t.tipo}>
                  {t.etiqueta}
                </option>
              ))}
            </select>
          )}
          <div className={cn("flex-wrap gap-2", config.tipos.length > 1 ? "hidden sm:flex" : "flex")} role="group" aria-label="Filtrar por tipo">
            <Chip activo={filtros.tipo === "todos"} onClick={() => setFiltros((f) => ({ ...f, tipo: "todos" }))}>
              Todos los tipos
            </Chip>
            {config.tipos.map((t) => (
              <Chip key={t.tipo} activo={filtros.tipo === t.tipo} onClick={() => setFiltros((f) => ({ ...f, tipo: t.tipo }))}>
                {t.etiqueta}
              </Chip>
            ))}
          </div>
        </div>

        <div className="min-h-[12rem] flex-1 overflow-y-auto overscroll-contain rounded-xl border bg-card">
          {loading ? (
            <p className="p-6 text-center text-sm text-muted-foreground" role="status">Cargando avisos…</p>
          ) : error ? (
            <p className="p-6 text-center text-sm text-destructive" role="alert">
              No se pudieron cargar los avisos. Inténtalo de nuevo más tarde.
            </p>
          ) : grupos.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">
              {filtros.estado === "sin_revisar" ? "No hay avisos sin revisar." : "No hay avisos."}
            </p>
          ) : (
            <>
              {grupos.map((g) => (
                <section key={g.etiqueta} aria-label={g.etiqueta}>
                  <h3 className="sticky top-0 z-10 border-b bg-muted/80 px-4 py-1.5 text-xs font-semibold capitalize text-muted-foreground backdrop-blur">
                    {g.etiqueta}
                  </h3>
                  <ul className="divide-y">
                    {g.items.map((n) => {
                      const Icono = TIPO_ICON[n.tipo] || Info;
                      const ruta = rutaDeAviso(n);
                      const tono = esReservas ? TONO_AVISO_RESERVA[n.tipo] : undefined;
                      const idReserva = reservaDeAviso(n);
                      const reserva = idReserva ? reservas.get(idReserva) : undefined;
                      // «Verificar» solo en una reserva nueva que sigue pendiente (y con permiso de editar). Ya verificada,
                      // confirmada o cancelada no hay nada que verificar: queda «Revisado».
                      const conVerificar = esReservas && n.tipo === "reserva_nueva" && puedeEditarReservas && reserva?.estado === "pendiente";
                      return (
                        <li
                          key={n.id}
                          data-tipo-aviso={n.tipo}
                          className={cn(
                            "flex flex-wrap items-start gap-x-3 gap-y-2 p-3",
                            tono ? cn("border-l-4", tono.borde, !n.leida ? tono.fondo : tono.fondoRevisado) : !n.leida && "bg-destructive/5",
                          )}
                        >
                          <Icono
                            className={cn("mt-0.5 h-4 w-4 shrink-0", tono ? tono.icono : !n.leida ? "text-destructive" : "text-muted-foreground")}
                            aria-hidden="true"
                          />
                          {/* En el móvil el texto ocupa toda la fila y los botones bajan debajo (antes se estrujaba en una columna). */}
                          <div className="min-w-0 flex-1 max-sm:basis-[calc(100%-1.75rem)]">
                            <p className={cn("flex flex-wrap items-center gap-1.5 text-sm [overflow-wrap:anywhere]", !n.leida && "font-medium")}>
                              {n.titulo}
                              <EstadoReservaAviso aviso={n} estados={estados} />
                            </p>
                            {n.mensaje && <p className="mt-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">{n.mensaje}</p>}
                            <p className="mt-1 text-xs text-muted-foreground">
                              {horaAviso(n.created_at)} · {etiquetaTipo(n.tipo)}
                              {n.leida && " · Revisado"}
                            </p>
                          </div>
                          <div className="ml-7 flex shrink-0 gap-1.5 max-sm:w-[calc(100%-1.75rem)] sm:ml-0">
                            {ruta && (
                              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => irAlOrigen(n)} aria-label={`Ver: ${n.titulo}`}>
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                Ver
                              </Button>
                            )}
                            {conVerificar ? (
                              <Button
                                size="sm"
                                className="h-9 gap-1 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
                                disabled={!reserva || estaEnCurso(reserva.id)}
                                onClick={() => void verificarDesdeAviso(n)}
                                aria-label={`Verificar la reserva: ${n.titulo}${n.mensaje ? `, ${n.mensaje}` : ""}`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                Verificar
                              </Button>
                            ) : (
                              !n.leida && (
                                <Button
                                  variant={tono ? "outline" : "ghost"}
                                  size="sm"
                                  className="h-9 gap-1"
                                  onClick={() => void marcarRevisado(n.id)}
                                  aria-label={`Marcar como revisado: ${n.titulo}`}
                                >
                                  Revisado
                                </Button>
                              )
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {hayMas && (
                <div className="p-3 text-center">
                  <Button variant="outline" className="h-11" onClick={() => void cargarMas()} disabled={cargandoMas}>
                    {cargandoMas ? "Cargando…" : "Cargar más"}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
