import { useEffect, useState, type ReactNode } from "react";
import { Bell, CheckCheck, ExternalLink, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAvisosSeccion, useContadorAvisosSeccion, type FiltrosAvisosSeccion } from "@/hooks/useAvisosSeccion";
import type { NotificacionDashboard } from "@/hooks/useNotificacionesDashboard";
import { agruparPorDia, EVENTO_ABRIR_AVISOS, horaAviso, rutaDeAviso, SECCIONES_AVISOS, TIPO_ICON, type SeccionAvisos } from "@/lib/avisos";
import { cn } from "@/lib/utils";
import { EstadoReservaAviso, useEstadosReservasAvisos } from "@/hooks/useEstadosReservasAvisos";
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
  // Se abre en «Sin revisar» si hay alguno; si no, en «Todos» (para ver el historial).
  const [filtros, setFiltros] = useState<FiltrosAvisosSeccion>({
    // Siempre en «Sin revisar» (12/11/2026, petición del dueño: «que salgan los sin revisar por defecto»).
    estado: "sin_revisar",
    tipo: "todos",
  });
  const { avisos, loading, cargandoMas, hayMas, error, cargarMas, marcarRevisado, marcarTodosRevisados } =
    useAvisosSeccion(seccion, filtros, abierto);
  const grupos = agruparPorDia(avisos);
  // Estado actual de cada reserva avisada (12/11/2026, petición del dueño).
  const estados = useEstadosReservasAvisos(avisos);
  const haySinRevisar = avisos.some((n) => !n.leida) || pendientes > 0;
  const etiquetaTipo = (tipo: string) => config.tipos.find((t) => t.tipo === tipo)?.etiqueta ?? tipo;

  const irAlOrigen = (n: NotificacionDashboard) => {
    void marcarRevisado(n.id);
    // La ficha de una reserva se abre encima y el modal sigue debajo; ir a otra pantalla lo cierra.
    if (!abreFicha(n)) onAbiertoChange(false);
    abrirAviso(n);
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
            {pendientes > 0 ? `${pendientes} sin revisar.` : "Ninguno sin revisar."} Pulsa un aviso para ir a lo que lo
            ha generado.
          </DialogDescription>
        </DialogHeader>

        {seccion === "reservas" && <AjustesAvisosEnVivo className="shrink-0 rounded-md border px-3 py-2" />}

        <div className="flex shrink-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado">
            <Chip activo={filtros.estado === "sin_revisar"} onClick={() => setFiltros((f) => ({ ...f, estado: "sin_revisar" }))}>
              Sin revisar
            </Chip>
            <Chip activo={filtros.estado === "todos"} onClick={() => setFiltros((f) => ({ ...f, estado: "todos" }))}>
              Todos
            </Chip>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto h-9 gap-1.5"
              onClick={() => void marcarTodosRevisados()}
              disabled={!haySinRevisar}
            >
              <CheckCheck className="h-4 w-4" aria-hidden="true" />
              Marcar todos como revisados
            </Button>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por tipo">
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
          ) : avisos.length === 0 ? (
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
                      return (
                        <li key={n.id} className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 p-3", !n.leida && "bg-destructive/5")}>
                          <Icono
                            className={cn("mt-0.5 h-4 w-4 shrink-0", !n.leida ? "text-destructive" : "text-muted-foreground")}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
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
                          <div className="ml-7 flex shrink-0 gap-1.5 sm:ml-0">
                            {ruta && (
                              <Button variant="outline" size="sm" className="h-9 gap-1" onClick={() => irAlOrigen(n)} aria-label={`Ver: ${n.titulo}`}>
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                Ver
                              </Button>
                            )}
                            {!n.leida && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-9"
                                onClick={() => void marcarRevisado(n.id)}
                                aria-label={`Marcar como revisado: ${n.titulo}`}
                              >
                                Revisado
                              </Button>
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
