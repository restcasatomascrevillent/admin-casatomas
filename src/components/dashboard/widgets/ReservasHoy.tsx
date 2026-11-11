import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarCheck, ShieldBan, MessageSquare, AlertTriangle, SquarePen } from "lucide-react";
import { AyudaPopover } from "@/components/AyudaPopover";
import { CentroNotificaciones } from "@/components/notificaciones/CentroNotificaciones";
import { useIsCompactNav } from "@/hooks/use-mobile";
import { useTodayReservations, useTodayConfirmedReservations } from "@/hooks/useDashboardStats";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { useEdicionReserva } from "@/hooks/useEdicionReserva";
import { TiraCifras } from "@/components/panel/TiraCifras";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { consultaEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { format } from "date-fns";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { sumarCapacidadPorMarca } from "@/hooks/useDisponibilidad";
import { marcaDeEspacio, MARCA_POR_DEFECTO } from "@/lib/reservas/negocios";
import { estaFueraDeAforo, esSalaPrivada, idsSalasPrivadasActivas } from "@/lib/reservas/salaPrivada";

/**
 * Aforo de Casa Tomás: suma de sus salas activas SIN las privadas (150: el
 * Reservado está FUERA DE AFORO, decisión del dueño del 2026-10-03), igual que el
 * trigger `validar_capacidad_reserva` (que suma por marca). Solo Casa Tomás admite
 * reservas (decisión del dueño, 2026-10-01): las salas de Touza que queden
 * activas no suman, y las reservas de Touza ya no llegan aquí
 * (`useTodayReservations` las descarta). Antes la tarjeta daba un bloque de
 * ocupación por negocio.
 */
type SalaLeida = {
  id?: string;
  nombre?: string;
  capacidad_maxima?: unknown;
  activa?: boolean;
  caracteristicas?: unknown;
  marca?: string | null;
};

function useEspaciosCapacidad() {
  // Misma clave y consulta que `useEspaciosReserva` (07/11/2026): el inicio pedía `espacios_reserva`
  // dos veces a la vez (aquí y en las gráficas, `useIdsSalasPrivadas`). Aquí solo las activas.
  return useQuery({
    ...consultaEspaciosReserva,
    select: (espacios: SalaLeida[]) =>
      (espacios ?? [])
        .filter((e) => e?.activa !== false)
        .map((e) => ({
          id: e.id,
          nombre: e.nombre,
          capacidad_maxima: Number(e.capacidad_maxima) || 0,
          marca: marcaDeEspacio(e),
          // Sala privada (el Reservado): fuera de aforo, no suma su capacidad.
          privada: esSalaPrivada(e),
        })),
    refetchInterval: 60000,
  });
}

const getStatusColor = (p: number) => {
  if (p < 50) return { text: "text-green-600", bar: "bg-green-500", label: "Baja" };
  if (p < 80) return { text: "text-amber-600", bar: "bg-amber-500", label: "Moderada" };
  return { text: "text-red-600", bar: "bg-red-500", label: "Alta" };
};

export function ReservasHoy() {
  const navigate = useNavigate();
  // En tablet vertical / móvil (< 1024px) la campana ya está en la barra superior de
  // DashboardLayout: aquí no se monta una segunda (doble suscripción realtime).
  const navCompacta = useIsCompactNav();
  // Editar una reserva desde el popup de notas (2026-09-30). El popup pasa a ser
  // controlado para poder cerrarlo al abrir el editor (dos diálogos uno encima
  // de otro no se entienden). Hooks ANTES del `return` de error de más abajo.
  const [notasAbiertas, setNotasAbiertas] = useState(false);
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  const { editarReserva, dialogoEdicion } = useEdicionReserva();
  const todasQuery = useTodayReservations();
  const confirmadasQuery = useTodayConfirmedReservations();
  const capacidadQuery = useEspaciosCapacidad();

  const { data: todasReservas } = todasQuery;
  const { data: reservasConfirmadas } = confirmadasQuery;
  const espaciosCapacidad = capacidadQuery.data ?? [];

  const hayError = todasQuery.isError || confirmadasQuery.isError || capacidadQuery.isError;
  const errorDetalle = todasQuery.error || confirmadasQuery.error || capacidadQuery.error;

  const ahora = new Date();
  const horaActual = ahora.getHours();
  const horaActualStr = format(ahora, "HH:mm:ss");

  // Reservas que ocupan plaza. Mismo criterio que el trigger `trg_validar_capacidad`
  // de la base de datos y que la pestaña "Hoy" de Reservas: antes la barra de ocupación
  // contaba solo confirmadas mientras las tarjetas de al lado contaban otra cosa.
  // Las reservas de una sala privada (el Reservado) están FUERA DE AFORO: no entran en ninguna cifra
  // de esta tarjeta (se avisan aparte, más abajo).
  const idsPrivadas = idsSalasPrivadasActivas(espaciosCapacidad);
  const reservasActivas = todasReservas?.filter(r =>
    ["pendiente", "verificada", "confirmada"].includes(r.estado) && !estaFueraDeAforo(r, idsPrivadas)
  ) || [];

  // Desglose por turno (umbral 17:00, el mismo que usa el trigger)
  const reservasComida = reservasActivas.filter(r => parseInt(r.hora.split(':')[0]) < 17);
  const reservasCena = reservasActivas.filter(r => parseInt(r.hora.split(':')[0]) >= 17);
  const comensalesComida = reservasComida.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesCena = reservasCena.reduce((acc, r) => acc + r.numero_comensales, 0);
  const comensalesActivos = reservasActivas.reduce((acc, r) => acc + r.numero_comensales, 0);

  // Ocupación de Casa Tomás contra su aforo (como el trigger).
  const capacidad = sumarCapacidadPorMarca(espaciosCapacidad, MARCA_POR_DEFECTO);
  const porcentaje = capacidad > 0 ? Math.round((comensalesActivos / capacidad) * 100) : 0;
  const colors = getStatusColor(porcentaje);

  // Alertas
  const reservasBlacklist = todasReservas?.filter(r => r.en_blacklist) || [];
  const reservasConNotas = todasReservas?.filter(r => r.notas_cliente && r.notas_cliente.trim() !== '') || [];

  // Estados
  // Salen de las activas (sin el Reservado) para que sumen exactamente las "reservas activas" de arriba.
  const numConfirmadas = reservasActivas.filter(r => r.estado === "confirmada").length;
  const reservasPendientes = reservasActivas.filter(r => r.estado === "pendiente").length;
  const reservasVerificadas = reservasActivas.filter(r => r.estado === "verificada").length;

  // Un fallo de red o de permisos no puede pintarse como "0 reservas, 0% de ocupación".
  if (hayError) {
    return (
      <EstadoErrorCarga
        titulo="las reservas de hoy"
        error={errorDetalle}
        onReintentar={() => {
          todasQuery.refetch();
          confirmadasQuery.refetch();
          capacidadQuery.refetch();
        }}
        className="h-full"
      />
    );
  }

  // Reservas en riesgo
  const reservasEnRiesgo = todasReservas?.filter(r => {
    if (r.estado !== "pendiente") return false;
    const [h, m] = r.hora.split(':').map(Number);
    const horaReserva = new Date();
    horaReserva.setHours(h, m, 0, 0);
    const diffMs = horaReserva.getTime() - ahora.getTime();
    return diffMs > 0 && diffMs <= 60 * 60 * 1000;
  }) || [];

  // Próxima reserva confirmada
  const proximaReserva = (reservasConfirmadas || [])
    .filter(r => r.hora >= horaActualStr)
    .sort((a, b) => a.hora.localeCompare(b.hora))[0];

  // «Próximas» (11/11/2026, dueño: «añade algo más de información y que se pueda clicar para hacer cosas»): las
  // siguientes reservas vivas de hoy, cada una abre su ficha (verificar, confirmar, editar).
  const proximas = reservasActivas
    .filter(r => r.hora >= horaActualStr.slice(0, 5))
    .sort((a, b) => a.hora.localeCompare(b.hora))
    .slice(0, 4);
  const irAReservasHoy = () => navigate('/reservas');

  // Antes era una línea fija bajo la barra de ocupación; ahora vive en la ayuda «ⓘ» de la franja (se abre con un
  // toque) y en el nombre accesible de ese botón, para que la tarjeta quepa con las gráficas sin scroll.
  const desgloseActivas = `${reservasActivas.length} reservas activas (${comensalesActivos} pax, sin canceladas) = ${numConfirmadas} confirmadas + ${reservasVerificadas} verificadas + ${reservasPendientes} pendientes`;

  // COMPACTA (06/10/2026, el Dashboard ocupa el alto de la pantalla sin scroll): cabecera fina, ocupación en una
  // franja, el Reservado en una línea, Comida/Cena y las cuatro cifras en filas bajas. Mismos datos que antes.
  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-4 py-2 sm:px-5">
        <CardTitle className="text-lg font-semibold">Reservas de Hoy</CardTitle>
        <div className="flex items-center gap-2">
          {reservasBlacklist.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <ShieldBan className="h-3 w-3" />
              {reservasBlacklist.length}
            </Badge>
          )}
          {reservasConNotas.length > 0 && (
            <Dialog open={notasAbiertas} onOpenChange={setNotasAbiertas}>
              <DialogTrigger asChild>
                {/* Un <button> real (antes un <div> de Badge): enfocable, con área pulsable de 44px en táctil. */}
                <button
                  type="button"
                  aria-label={`Ver notas y peticiones especiales (${reservasConNotas.length})`}
                  className={cn(badgeVariants({ variant: "secondary" }), "touch-hit gap-1 cursor-pointer hover:bg-secondary/80 active:bg-secondary/70 transition-colors")}
                >
                  <MessageSquare className="h-3 w-3" />
                  {reservasConNotas.length}
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-primary" />
                    Notas y peticiones especiales
                  </DialogTitle>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]">
                  <div className="space-y-3 pr-4">
                    {reservasConNotas.map(r => (
                      <div key={r.id} className="p-3 bg-muted/50 rounded-lg border">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <span className="font-medium">{r.nombre || "Sin nombre"}</span>
                            <span className="text-muted-foreground text-sm ml-2">· {r.numero_comensales} pax</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant="outline">{r.hora.substring(0, 5)}</Badge>
                            {/* Editar datos, día, hora, comensales, sala o notas de esta
                                reserva, sea cual sea su estado. Cierra el popup antes. Sin
                                «Editar» en Reservas no sale (06/11/2026: se oculta, no se
                                desactiva). */}
                            {puedeEditar && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground"
                                aria-label={`Editar la reserva de ${r.nombre || "este cliente"}`}
                                title="Editar la reserva"
                                onClick={() => {
                                  setNotasAbiertas(false);
                                  editarReserva(r.id);
                                }}
                              >
                                <SquarePen className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-sm text-muted-foreground bg-background p-2 rounded italic">
                          "{r.notas_cliente}"
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          )}
          {reservasEnRiesgo.length > 0 && (
            <Badge variant="outline" className="gap-1 border-amber-500 text-amber-600">
              <AlertTriangle className="h-3 w-3" />
              {reservasEnRiesgo.length}
            </Badge>
          )}
          <CalendarCheck className="h-5 w-5 text-primary" />
          {/* La campana vivía en la cabecera del menú lateral (AppSidebar.tsx);
              se mudó aquí para que el cubierto decorativo del sidebar pudiera
              volver, a petición del dueño. */}
          {!navCompacta && <CentroNotificaciones className="h-7 w-7" />}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4 pb-3 pt-0 sm:px-5">
        {/* Ocupación de hoy contra el aforo del restaurante: %, nivel, barra y pax en UNA franja (la barra baja a
            su propia línea en el móvil). El desglose de las reservas activas, en la ayuda «ⓘ». */}
        <div
          data-testid="franja-ocupacion"
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1"
        >
          <div className="flex items-center gap-2">
            <span className={cn("text-2xl font-bold leading-none tabular-nums", colors.text)}>{porcentaje}%</span>
            <Badge variant="outline" className={cn(colors.text, "border-current text-xs")}>
              {colors.label}
            </Badge>
          </div>
          <div
            role="progressbar"
            aria-label="Ocupación de hoy"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, porcentaje)}
            aria-valuetext={`${porcentaje}% (${colors.label})`}
            className="order-last h-2 basis-full overflow-hidden rounded-full bg-background/50 sm:order-none sm:min-w-16 sm:flex-1 sm:basis-auto"
          >
            <div
              className={`h-full ${colors.bar} transition-all duration-500`}
              style={{ width: `${Math.min(100, porcentaje)}%` }}
            />
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {comensalesActivos}/{capacidad} pax · {reservasActivas.length} res.
            </span>
            <AyudaPopover etiqueta={`Desglose: ${desgloseActivas}`}>{desgloseActivas}</AyudaPopover>
          </div>
        </div>
        {/* UNA tira de cifras sin fondos de color: estados, próxima reserva y los dos turnos (umbral 17:00). El color
            solo avisa: Pendientes en ámbar si hay alguna. El turno en curso lleva «· ahora» en su nombre. */}
        <TiraCifras
          data-testid="cifras-hoy"
          cifras={[
            // 11/11/2026: todas se pueden tocar (el día en Reservas, «Pendientes» en la Lista, la próxima abre su ficha).
            { etiqueta: "Activas", valor: reservasActivas.length, onClick: irAReservasHoy },
            { etiqueta: "Confirmadas", valor: numConfirmadas, onClick: irAReservasHoy },
            {
              etiqueta: "Pendientes",
              valor: reservasPendientes,
              tono: reservasPendientes > 0 ? "ambar" : undefined,
              onClick: () => navigate('/reservas?tab=reservas&status=pendiente'),
            },
            {
              etiqueta: "Próxima",
              valor: proximaReserva ? proximaReserva.hora.slice(0, 5) : "—",
              onClick: proximaReserva && puedeEditar ? () => editarReserva(proximaReserva.id) : undefined,
            },
            { etiqueta: horaActual < 17 ? "Comida · ahora" : "Comida", valor: reservasComida.length, detalle: `res. · ${comensalesComida} pax`, onClick: irAReservasHoy },
            { etiqueta: horaActual >= 17 ? "Cena · ahora" : "Cena", valor: reservasCena.length, detalle: `res. · ${comensalesCena} pax`, onClick: irAReservasHoy },
          ]}
        />
        {proximas.length > 0 && (
          <ul aria-label="Próximas reservas de hoy" className="flex flex-wrap gap-1.5" data-testid="proximas-hoy">
            {proximas.map(r => (
              <li key={r.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => (puedeEditar ? editarReserva(r.id) : irAReservasHoy())}
                  className="flex min-h-9 max-w-[16rem] items-center gap-1.5 rounded-full border bg-background px-3 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Abrir la reserva de ${r.nombre || "Sin nombre"}, ${r.hora.slice(0, 5)}, ${r.numero_comensales} personas`}
                >
                  <span className="font-semibold tabular-nums">{r.hora.slice(0, 5)}</span>
                  <span className="truncate">{r.nombre || "Sin nombre"}</span>
                  <span className="tabular-nums text-muted-foreground">· {r.numero_comensales}</span>
                  {r.estado === "pendiente" && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label="pendiente" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {/* Editor de la reserva elegida en el popup de notas. `null` hasta que se pide. */}
      {dialogoEdicion}
    </Card>
  );
}
