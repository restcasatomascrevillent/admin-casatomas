// ============================================================================
// EDITAR UNA RESERVA — el diálogo que abre CUALQUIER vista con solo su id.
// ----------------------------------------------------------------------------
// Encargo del dueño (2026-09-30): las reservas se editan SIEMPRE desde el panel
// —en cualquier estado, con cualquier fecha (también pasada) y de cualquier
// canal— y desde cualquier vista donde aparezca una reserva. Por eso este
// diálogo:
//   · recibe SOLO el id: cada vista tiene una parte distinta de la fila (la de
//     Asignación ni siquiera trae el teléfono ni las notas), así que aquí se
//     lee la fila completa, fresca, en el momento de abrir;
//   · no mira el estado ni la fecha para nada: el único filtro es el permiso de
//     la sección «reservas» (la política RLS de UPDATE exige lo mismo);
//   · monta `FormularioReserva` en modo edición (`reservaAEditar`), que es quien
//     guarda. El ESTADO no se cambia aquí: se sigue cambiando con las acciones
//     de siempre (Aceptar, Verificar, Confirmar, Cancelar, Ha llegado…).
//
// Las vistas no lo montan a mano: usan `useEdicionReserva` (src/hooks/), que
// devuelve `editarReserva(id)` y el `dialogoEdicion` que hay que pintar.
// ============================================================================
import { useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Ban, CheckCircle2, Loader2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { supabase } from "@/integrations/supabase/client";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { CLAVE_ASIGNACIONES_MESA } from "@/hooks/useAsignacionesMesa";
import { useAccionesServicioReserva } from "@/hooks/useAccionesServicioReserva";
import { esEstadoVivo } from "@/lib/reservas/estadosReserva";
import { OPCIONES_FILTRO_ESTADO } from "@/lib/reservas/vistaUnificada";
import type { ReservaEditable } from "@/lib/reservas/edicionReserva";
import { FormularioReserva } from "./FormularioReserva";
import { BotonSentarFuera, EtiquetaFuera } from "./SentarFuera";
import { estaSentadaFuera } from "@/lib/reservas/sentarFuera";
import type { ReservaServicio } from "@/lib/reservas/servicioSala";
import { ComoSeHizoReserva, type ReservaConOrigen } from "./ComoSeHizoReserva";

/** Clave de caché de la fila en edición. `FormularioReserva` la invalida al guardar (prefijo "reserva-edicion"). */
const CLAVE_RESERVA_EDICION = "reserva-edicion";

const ETIQUETA_CANAL: Record<string, string> = {
  telefono: "Teléfono",
  web: "Web",
  manual: "Manual",
  presencial: "En local",
};

async function cargarReserva(id: string): Promise<ReservaEditable | null> {
  // `select("*")`: trae lo que exista en la tabla (marca, llegada_at…) sin
  // nombrar columnas que los tipos generados aún no conocen (mismo patrón que la
  // consulta de la lista de reservas).
  const { data, error } = await supabase.from("reservas").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as ReservaEditable | null) ?? null;
}

/** Nombres de las mesas que ya tiene la reserva (para avisar de qué pasa con ellas al cambiar día, turno o sala). */
async function cargarNombresDeMesas(reservaId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("asignaciones_mesa")
    .select("id, mesas(nombre)")
    .eq("reserva_id", reservaId);
  if (error) throw error;
  return (data ?? [])
    .map((a) => a.mesas?.nombre ?? "")
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
}

function descripcion(reserva: ReservaEditable): string {
  const dia = new Date(`${String(reserva.fecha).slice(0, 10)}T12:00:00`);
  const fecha = Number.isNaN(dia.getTime()) ? "sin fecha" : format(dia, "EEEE, d 'de' MMMM yyyy", { locale: es });
  const estado = OPCIONES_FILTRO_ESTADO.find((o) => o.value === reserva.estado)?.label ?? reserva.estado;
  const canal = reserva.canal ? ETIQUETA_CANAL[reserva.canal] ?? reserva.canal : null;
  return [
    reserva.nombre || "Sin nombre",
    fecha,
    String(reserva.hora ?? "").slice(0, 5),
    `Estado: ${estado}`,
    canal ? `Canal: ${canal}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface EditarReservaDialogProps {
  /** La reserva a editar. El diálogo se monta solo cuando hay una (ver `useEdicionReserva`). */
  reservaId: string;
  onClose: () => void;
}

export function EditarReservaDialog({ reservaId, onClose }: EditarReservaDialogProps) {
  const { canAccess: puedeEditar, loading: permisosCargando } = useCanAccessSection("reservas", "edit");

  // Esc, la X y un clic fuera cierran el diálogo: con cambios sin guardar eso tiraba
  // lo escrito sin avisar. El formulario dice si los hay (un ref basta: solo se lee
  // al intentar cerrar) y aquí se pide confirmación antes de descartarlos. Al
  // guardar, `onSuccess` cierra directamente: lo guardado ya no se pierde.
  const hayCambiosSinGuardar = useRef(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const intentarCerrar = () => {
    if (hayCambiosSinGuardar.current) setConfirmarDescarte(true);
    else onClose();
  };

  const reserva = useQuery({
    queryKey: [CLAVE_RESERVA_EDICION, reservaId],
    queryFn: () => cargarReserva(reservaId),
    enabled: puedeEditar,
    // Fresca al ABRIR (`gcTime: 0`: nada de caché de una apertura anterior, se edita
    // lo que hay AHORA en la BD y no lo que pintó la lista hace un rato) y QUIETA
    // mientras está abierto: si se refrescara al volver a la ventana, el formulario
    // compararía lo escrito contra datos nuevos y un cambio ajeno podría acabar
    // pisado con el valor antiguo que sigue en pantalla.
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const mesas = useQuery({
    queryKey: [CLAVE_ASIGNACIONES_MESA, "reserva", reservaId],
    queryFn: () => cargarNombresDeMesas(reservaId),
    enabled: puedeEditar && !!reserva.data,
  });

  let cuerpo: ReactNode;
  if (permisosCargando) {
    cuerpo = <Cargando texto="Comprobando permisos…" />;
  } else if (!puedeEditar) {
    cuerpo = (
      <div className="space-y-3">
        <p className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
          <Lock className="h-4 w-4 shrink-0" aria-hidden />
          Tu usuario no tiene permiso para editar reservas.
        </p>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  } else if (reserva.isLoading) {
    cuerpo = <Cargando texto="Cargando la reserva…" />;
  } else if (reserva.isError) {
    cuerpo = (
      <EstadoErrorCarga titulo="la reserva" error={reserva.error} onReintentar={() => void reserva.refetch()} />
    );
  } else if (!reserva.data) {
    cuerpo = (
      <div className="space-y-3">
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          Esta reserva ya no existe: puede que la hayan borrado desde otra pantalla.
        </p>
        <Button variant="outline" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    );
  } else {
    cuerpo = (
      <>
        {/* Verificar / Confirmar / Cancelar desde la ficha (11/11/2026): la Lista ya no tiene tabla con esos botones. */}
        <AccionesEstado reserva={reserva.data} onHecho={onClose} />
        {/* «Sentar fuera» (10/11/2026): dónde está sentada, fuera de las salas; cambiar o volver dentro. */}
        <AvisoSentadaFuera reserva={reserva.data as never} />
        <FormularioReserva
          // `key`: si cambia de reserva, el formulario arranca de cero con sus datos.
          key={reserva.data.id}
          reservaAEditar={reserva.data}
          mesasAsignadas={mesas.data ?? []}
          onSuccess={onClose}
          onCambiosSinGuardar={(hay) => {
            hayCambiosSinGuardar.current = hay;
          }}
        />
        {/* «Cómo se hizo la reserva»: hora, canal, tiempo en el formulario, dispositivo e historial. */}
        <ComoSeHizoReserva reserva={reserva.data as unknown as ReservaConOrigen} />
      </>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(abierto) => !abierto && intentarCerrar()}>
        {/* 11/11/2026 (dueño: tablet «perfecto»): el pie «Guardar cambios» es `sticky bottom-0` y, con el relleno de 24 px del
            diálogo, dejaba una franja por debajo por la que asomaban los campos; `-bottom-6` lo pega al borde real. */}
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto [&_form>div.sticky:last-child]:-bottom-6">
          <DialogHeader>
            <DialogTitle>Editar reserva</DialogTitle>
            <DialogDescription>{reserva.data ? descripcion(reserva.data) : "Datos de la reserva."}</DialogDescription>
          </DialogHeader>
          {cuerpo}
        </DialogContent>
      </Dialog>
      {/* Encima del editor (y de lo que lo haya abierto, p. ej. el detalle de una
          llamada): Esc cierra SOLO la capa de más arriba, o sea, esta pregunta. */}
      <AlertDialog open={confirmarDescarte} onOpenChange={setConfirmarDescarte}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Has modificado esta reserva y no has guardado. Si sales ahora, se pierde lo que has escrito.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction onClick={onClose}>Descartar cambios</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Cargando({ texto }: { texto: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      {texto}
    </div>
  );
}

/** En el editor: «Fuera · Touza · Mesa 4» y, con «Editar», cambiar el sitio o volver dentro (diálogo de Hoy). */
function AvisoSentadaFuera({ reserva }: { reserva: ReservaServicio & { salida_at?: string | null } }) {
  const { canAccess: puedeEditar } = useCanAccessSection("reservas", "edit");
  if (!estaSentadaFuera(reserva)) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-[#0050FF]/40 bg-[#0050FF]/5 p-3 text-sm">
      <EtiquetaFuera reserva={reserva} className="text-sm" />
      <span className="text-muted-foreground">Sentada fuera de las salas: no ocupa mesa ni cuenta en ningún espacio.</span>
      {puedeEditar && <BotonSentarFuera reserva={reserva} className="ml-auto h-11 w-auto px-4 text-sm" />}
    </div>
  );
}

/**
 * El estado, desde la ficha (11/11/2026, petición del dueño al unir Libro y Tabla en la Lista): pendiente →
 * «Verificar»; verificada → «Confirmar»; pendiente, verificada o confirmada → «Cancelar» (con pregunta). Son
 * las acciones de siempre (`useAccionesServicioReserva`: correo al cliente y aviso); al acabar bien se cierra
 * la ficha, que es lo que se ve cambiado en la Lista.
 */
function AccionesEstado({ reserva, onHecho }: { reserva: ReservaEditable; onHecho: () => void }) {
  const { aceptar, confirmar, cancelar, estaEnCurso } = useAccionesServicioReserva();
  const [preguntarCancelar, setPreguntarCancelar] = useState(false);
  const estado = String(reserva.estado ?? "");
  if (!esEstadoVivo(estado)) return null;
  const ocupado = estaEnCurso(String(reserva.id));
  const hacer = async (accion: () => Promise<{ ok: boolean }>) => {
    if ((await accion()).ok) onHecho();
  };
  const fila = reserva as unknown as Parameters<typeof confirmar>[0];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3" data-testid="acciones-estado">
      {estado === "pendiente" && (
        <Button className="h-11 gap-2 text-base" disabled={ocupado} onClick={() => void hacer(() => aceptar(reserva as unknown as Parameters<typeof aceptar>[0]))}>
          <CheckCircle2 className="h-5 w-5" aria-hidden /> Verificar
        </Button>
      )}
      {estado === "verificada" && (
        <Button className="h-11 gap-2 text-base" disabled={ocupado} onClick={() => void hacer(() => confirmar(fila))}>
          <CheckCircle2 className="h-5 w-5" aria-hidden /> Confirmar
        </Button>
      )}
      <Button
        variant="outline"
        className="ml-auto h-11 gap-2 border-red-300 text-base text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
        disabled={ocupado}
        onClick={() => setPreguntarCancelar(true)}
      >
        <Ban className="h-5 w-5" aria-hidden /> Cancelar reserva
      </Button>
      <AlertDialog open={preguntarCancelar} onOpenChange={setPreguntarCancelar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar la reserva?</AlertDialogTitle>
            <AlertDialogDescription>
              {reserva.nombre || "Sin nombre"}: pasa a «Cancelada»{reserva.email ? " y se le avisa por correo" : ""}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>No, dejarla</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={() => void hacer(() => cancelar(fila))}>
              Sí, cancelar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
