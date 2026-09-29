import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  MapPin,
  Users,
  Phone,
  Mail,
  MessageSquare,
  Lock,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEspaciosReserva } from "@/hooks/useEspaciosReserva";
import { useDisponibilidadCalculada } from "@/hooks/useDisponibilidad";
import { marcaDeEspacio, marcaDeReserva } from "@/lib/reservas/negocios";
import { NegocioBadge } from "./NegocioBadge";
import { useCanAccessSection } from "@/hooks/useUserRole";
import {
  type ReservaParaVerificar,
  difiereSolicitudDeOferta,
  verificarConHoraYSala,
  rechazarReserva,
} from "@/hooks/useVerificacionReservas";

interface ModalVerificacionReservaProps {
  reserva: ReservaParaVerificar | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

const SIN_ZONA = "__sin_zona__";

/** "13:00:00" | "13:00" -> "13:00". */
function horaCorta(hora: string | null | undefined): string {
  return (hora ?? "").slice(0, 5);
}

/**
 * Verificar una solicitud pendiente: el cliente pidió una hora y aquí se
 * decide QUÉ HORA SE LE DA. Ver `useVerificacionReservas.ts` para el contrato
 * completo con el backend (columnas hora_solicitada/espacio_solicitado_id,
 * migración 20260920010000).
 *
 * DOS COSAS DISTINTAS, DOS SITIOS DISTINTOS (2026-09-29). Hasta ahora la hora
 * y la sala compartían el recuadro "Se le ofrece", como si las dos fueran
 * parte de lo que se le comunica al cliente. Desde que la sala no sale en
 * ningún correo (punto 7 del contrato de `emails-reserva/plantillas.ts`) eso
 * era mentira: la hora se le dice, la sala es organización interna del
 * comedor. Por eso arriba va la comparación de HORA (lo único que el cliente
 * verá) y abajo, separada, la sala.
 *
 * NO SE BORRA NADA para volver atrás: `espacio_solicitado_id` se sigue
 * leyendo y escribiendo, y devolver la sala al bloque de arriba es mover el
 * `<Select>` de sitio. El "de momento" del dueño sigue siendo un "de momento".
 *
 * Ámbito deliberadamente MÁS ESTRECHO que la versión anterior de este modal:
 * antes se podían editar nombre/teléfono/email/fecha/comensales aquí. La
 * migración congela SOLO hora/espacio como "lo solicitado" — nombre, fecha y
 * comensales no forman parte de lo que se responde ni del correo de
 * comparación que arma `emails-reserva` a partir de esas columnas. Se
 * muestran como contexto de solo-lectura; corregir un dato de contacto ya no
 * es cosa de esta pantalla (se sigue pudiendo editar la reserva desde otro
 * sitio si hiciera falta).
 */
export function ModalVerificacionReserva({
  reserva,
  open,
  onOpenChange,
  onSuccess,
}: ModalVerificacionReservaProps) {
  const { canAccess: canEdit, loading: permisosLoading } = useCanAccessSection("reservas", "edit");
  const { data: espacios } = useEspaciosReserva();

  const [horaDecidida, setHoraDecidida] = useState("");
  const [salaAsignada, setSalaAsignada] = useState<string | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState<"verificar" | "rechazar" | null>(null);

  useEffect(() => {
    if (open && reserva) {
      // La HORA arranca en la que pidió el cliente: no tocar nada y pulsar
      // "Verificar con esta hora" es darle exactamente lo que pidió.
      setHoraDecidida(horaCorta(reserva.hora_solicitada ?? reserva.hora));
      // La SALA arranca en la que la reserva tenga asignada AHORA MISMO, no
      // en `espacio_solicitado_id`. Es un dato interno y el cliente no lo
      // pide nunca (ver `lib/reservas/solicitudPropuesta.ts`: "la sala nunca
      // la pidió el cliente"). Arrancar en "lo solicitado" borraba sin avisar
      // la sala de una reserva a la que ya se le había puesto una.
      setSalaAsignada(reserva.espacio_id ?? null);
    }
  }, [open, reserva]);

  const fecha = reserva?.fecha || "";
  const comensales = reserva?.numero_comensales || 1;
  // Negocio de la reserva (Casa Tomás / Touza · El Reservado): las horas, el
  // aforo y las zonas que se pueden ofrecer son solo las de ese negocio.
  const marca = marcaDeReserva(reserva);

  // Motor de disponibilidad (supabase/functions/_shared/disponibilidad.ts vía
  // useDisponibilidad.ts) recalculado para la ZONA que se esté ofreciendo
  // ahora mismo en el formulario: cambiar de zona recalcula qué horas caben.
  const { data: disponibilidad, isLoading: cargandoHoras, isError: errorHoras } = useDisponibilidadCalculada(
    fecha,
    { comensales, espacioId: salaAsignada, marca },
  );

  const opcionesHora = useMemo(() => {
    const delMotor = disponibilidad ? disponibilidad.huecos.filter((h) => h.ofrecido).map((h) => h.hora) : [];
    const set = new Set(delMotor);
    // La hora actualmente seleccionada se incluye SIEMPRE, aunque el motor ya
    // no la ofrezca de fábrica (p.ej. se llenó mientras tanto): así el Select
    // nunca queda en un valor sin opción visible. Elegir una hora DISTINTA
    // sigue limitado a lo que el motor permite — nada de texto libre.
    if (horaDecidida) set.add(horaDecidida);
    return Array.from(set).sort();
  }, [disponibilidad, horaDecidida]);

  const opcionesEspacio = useMemo(() => {
    const activos = (espacios ?? []).filter((e: any) => e.activa && marcaDeEspacio(e) === marca);
    if (salaAsignada && !activos.some((e: any) => e.id === salaAsignada)) {
      const actual = (espacios ?? []).find((e: any) => e.id === salaAsignada);
      if (actual) return [...activos, actual];
    }
    return activos;
  }, [espacios, salaAsignada, marca]);

  if (!reserva) return null;

  const pedidoHora = horaCorta(reserva.hora_solicitada ?? reserva.hora);

  // SOLO LA HORA. La sala no entra en esta comparación porque no sale en
  // ningún correo del cliente: avisar de que "difiere" por un cambio de sala
  // era alarmar al personal por algo que el cliente jamás va a ver. Mismo
  // criterio, literalmente la misma función, que el correo real (ver
  // `difiereSolicitudDeOferta` en useVerificacionReservas.ts).
  const cambiaLaHora = horaCorta(horaDecidida) !== pedidoHora;
  const yaDiferiaAlAbrir = difiereSolicitudDeOferta(reserva);
  const puedeEditar = canEdit && !permisosLoading;

  const cerrar = () => {
    if (accionEnCurso) return;
    onOpenChange(false);
  };

  const ejecutar = async (
    accion: "verificar" | "rechazar",
    fn: () => Promise<{ ok: boolean }>,
  ) => {
    setAccionEnCurso(accion);
    try {
      const resultado = await fn();
      if (resultado.ok) {
        onOpenChange(false);
        onSuccess();
      }
    } finally {
      setAccionEnCurso(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={cerrar}>
      {/* `max-w-xl` (576 px) y no el `max-w-lg` (512) de antes: con 512 el pie
          se quedaba a 1 px de no caber, que no es margen, es suerte. Con 576
          sobran ~64 px para que una etiqueta o una tipografía distinta no
          vuelvan a sacar barra horizontal. */}
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Verificar solicitud
            <NegocioBadge marca={marca} />
          </DialogTitle>
          <DialogDescription>
            {reserva.nombre || "Cliente sin nombre"} ·{" "}
            {fecha ? format(new Date(`${fecha}T00:00:00`), "d MMM yyyy", { locale: es }) : "sin fecha"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Contexto del cliente — solo lectura, no es parte de lo que se decide aquí */}
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5 text-sm">
            {reserva.telefono && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Phone className="h-3.5 w-3.5 shrink-0" /> {reserva.telefono}
              </p>
            )}
            {reserva.email && (
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <Mail className="h-3.5 w-3.5 shrink-0" /> {reserva.email}
              </p>
            )}
            <p className="flex items-center gap-1.5 text-muted-foreground">
              <Users className="h-3.5 w-3.5 shrink-0" /> {reserva.numero_comensales} comensales
              {reserva.canal && (
                <Badge variant="outline" className="ml-1 text-[10px] font-normal">
                  {reserva.canal}
                </Badge>
              )}
            </p>
            {reserva.notas_cliente && (
              <p className="flex items-start gap-1.5 text-muted-foreground italic">
                <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />"{reserva.notas_cliente}"
              </p>
            )}
          </div>

          {yaDiferiaAlAbrir && (
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 p-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Esta reserva ya tenía guardada una hora distinta a la que pidió el cliente.
            </div>
          )}

          {/* LA HORA: lo único que se le dice al cliente. Lo pedido a la
              izquierda, lo que se le va a decir a la derecha, y a simple
              vista si no coinciden — es tal cual lo que leerá en el correo
              ("pediste X, te damos Y"). */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pidió el cliente</p>
              <div className="rounded-lg border bg-background p-3 h-[58px] flex items-center">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" /> {pedidoHora || "—"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <p
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  cambiaLaHora ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                Se le confirma
              </p>
              <div
                className={cn(
                  "rounded-lg border p-3 h-[58px] flex items-center",
                  cambiaLaHora
                    ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800"
                    : "bg-background",
                )}
              >
                <Select
                  value={horaDecidida}
                  onValueChange={setHoraDecidida}
                  disabled={!puedeEditar || !!accionEnCurso}
                >
                  <SelectTrigger className="h-8 text-sm" aria-label="Hora que se le confirma al cliente">
                    <SelectValue placeholder={cargandoHoras ? "Cargando…" : "Hora"} />
                  </SelectTrigger>
                  <SelectContent>
                    {opcionesHora.map((h) => (
                      <SelectItem key={h} value={h}>
                        {h}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {cambiaLaHora && (
            <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Hora distinta a la que pidió: en el correo verá que pidió las {pedidoHora || "—"} y que se le dan las{" "}
              {horaCorta(horaDecidida) || "—"}.
            </p>
          )}

          {/* LA SALA: no sale en ningún correo del cliente, así que no puede
              estar en el recuadro de arriba junto a la hora. Es reparto de
              comedor. Ver el comentario de cabecera del componente. */}
          <div className="space-y-1.5 border-t pt-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Solo para el restaurante</p>
            <div className="flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <Select
                value={salaAsignada ?? SIN_ZONA}
                onValueChange={(v) => setSalaAsignada(v === SIN_ZONA ? null : v)}
                disabled={!puedeEditar || !!accionEnCurso}
              >
                <SelectTrigger className="h-8 text-sm" aria-label="Sala que se le asigna por dentro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_ZONA}>Sin sala asignada</SelectItem>
                  {opcionesEspacio.map((e: any) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">
              La sala no se le dice al cliente: sirve para repartir el comedor.
            </p>
          </div>

          {errorHoras && (
            <p className="text-xs text-destructive">
              No se pudieron calcular las horas disponibles ahora mismo. Puedes verificar con la hora que pidió o
              rechazar; para darle otra hora, inténtalo de nuevo en un momento.
            </p>
          )}

          {!permisosLoading && !canEdit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Solo lectura: tu usuario no tiene permiso para verificar reservas.
            </div>
          )}
        </div>

        {/* TRES botones, no cuatro. Antes había "Aceptar tal cual" y "Enviar
            propuesta" como si fueran dos caminos; no lo son: se le da una
            hora y ya está. Un solo botón de guardar manda SIEMPRE lo que se
            ve en pantalla (coincida o no con lo pedido), que además arregla
            el que "Aceptar tal cual" tiraba a la basura la sala recién
            asignada. Y con tres botones cabe todo: los cuatro se salían por
            la derecha a 1024 px y el modal sacaba barra horizontal
            (`overflow-y-auto` obliga a `overflow-x: auto`, así que lo que no
            cabe genera scroll en vez de verse). `flex-wrap` es el cinturón
            por si algún día crece una etiqueta. */}
        <DialogFooter className="flex-col sm:flex-row sm:flex-wrap gap-2">
          {puedeEditar && (
            <Button
              variant="destructive"
              onClick={() => ejecutar("rechazar", () => rechazarReserva(reserva))}
              disabled={!!accionEnCurso}
              className="sm:mr-auto"
            >
              {accionEnCurso === "rechazar" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-2 h-4 w-4" />
              )}
              Rechazar
            </Button>
          )}
          <Button variant="outline" onClick={cerrar} disabled={!!accionEnCurso}>
            Cerrar
          </Button>
          {puedeEditar && (
            <Button
              onClick={() =>
                ejecutar("verificar", () =>
                  verificarConHoraYSala(reserva, { hora: horaDecidida, espacio_id: salaAsignada }),
                )
              }
              disabled={!!accionEnCurso || !horaDecidida}
            >
              {accionEnCurso === "verificar" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Verificar con esta hora
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
