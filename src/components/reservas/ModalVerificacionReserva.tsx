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
  ArrowRight,
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
  objetivoAceptarComoSolicitado,
  difiereSolicitudDeOferta,
  aceptarComoSolicitado,
  verificarConContraoferta,
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
 * Verificar una solicitud pendiente con posible contraoferta de hora/zona.
 * Ver `useVerificacionReservas.ts` para el contrato completo con el backend
 * (columnas hora_solicitada/espacio_solicitado_id, migración 20260920010000).
 *
 * Ámbito deliberadamente MÁS ESTRECHO que la versión anterior de este modal:
 * antes se podían editar nombre/teléfono/email/fecha/comensales aquí. La
 * migración congela SOLO hora/espacio como "lo solicitado" — nombre, fecha y
 * comensales no forman parte de la contraoferta ni del correo de comparación
 * que arma `emails-reserva` a partir de esas columnas. Se muestran como
 * contexto de solo-lectura; corregir un dato de contacto ya no es cosa de
 * esta pantalla (se sigue pudiendo editar la reserva desde otro sitio si
 * hiciera falta).
 */
export function ModalVerificacionReserva({
  reserva,
  open,
  onOpenChange,
  onSuccess,
}: ModalVerificacionReservaProps) {
  const { canAccess: canEdit, loading: permisosLoading } = useCanAccessSection("reservas", "edit");
  const { data: espacios } = useEspaciosReserva();

  const [horaOferta, setHoraOferta] = useState("");
  const [espacioOferta, setEspacioOferta] = useState<string | null>(null);
  const [accionEnCurso, setAccionEnCurso] = useState<"aceptar" | "contraoferta" | "rechazar" | null>(null);

  // Al abrir (o cambiar de reserva), el formulario arranca en "lo pedido":
  // no tocar nada + "Aceptar tal cual" equivale a aceptar la solicitud
  // exactamente como llegó. Cambiar hora o zona es la excepción deliberada.
  useEffect(() => {
    if (open && reserva) {
      const objetivo = objetivoAceptarComoSolicitado(reserva);
      setHoraOferta(horaCorta(objetivo.hora));
      setEspacioOferta(objetivo.espacio_id);
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
    { comensales, espacioId: espacioOferta, marca },
  );

  const opcionesHora = useMemo(() => {
    const delMotor = disponibilidad ? disponibilidad.huecos.filter((h) => h.ofrecido).map((h) => h.hora) : [];
    const set = new Set(delMotor);
    // La hora actualmente seleccionada se incluye SIEMPRE, aunque el motor ya
    // no la ofrezca de fábrica (p.ej. se llenó mientras tanto): así el Select
    // nunca queda en un valor sin opción visible. Elegir una hora DISTINTA
    // sigue limitado a lo que el motor permite — nada de texto libre.
    if (horaOferta) set.add(horaOferta);
    return Array.from(set).sort();
  }, [disponibilidad, horaOferta]);

  const opcionesEspacio = useMemo(() => {
    const activos = (espacios ?? []).filter((e: any) => e.activa && marcaDeEspacio(e) === marca);
    if (espacioOferta && !activos.some((e: any) => e.id === espacioOferta)) {
      const actual = (espacios ?? []).find((e: any) => e.id === espacioOferta);
      if (actual) return [...activos, actual];
    }
    return activos;
  }, [espacios, espacioOferta, marca]);

  if (!reserva) return null;

  const pedidoHora = horaCorta(reserva.hora_solicitada ?? reserva.hora);
  const pedidoEspacioId =
    reserva.espacio_solicitado_id !== undefined ? reserva.espacio_solicitado_id : reserva.espacio_id ?? null;

  const nombreZona = (id: string | null) => {
    if (!id) return "Sin zona asignada";
    return (espacios ?? []).find((e: any) => e.id === id)?.nombre || "Zona eliminada";
  };

  const hayContraoferta = horaCorta(horaOferta) !== pedidoHora || espacioOferta !== pedidoEspacioId;
  const yaDiferiaAlAbrir = difiereSolicitudDeOferta(reserva);
  const puedeEditar = canEdit && !permisosLoading;

  const cerrar = () => {
    if (accionEnCurso) return;
    onOpenChange(false);
  };

  const ejecutar = async (
    accion: "aceptar" | "contraoferta" | "rechazar",
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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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
          {/* Contexto del cliente — solo lectura, no forma parte de la contraoferta */}
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
              Esta reserva ya se había ofrecido con una hora o zona distinta a la solicitada originalmente.
            </div>
          )}

          {/* Comparación: lo pedido vs. lo que se va a ofrecer. A simple vista si difieren —
              es exactamente lo que verá el cliente en el correo ("pediste X, te ofrecemos Y"). */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pidió el cliente</p>
              <div className="rounded-lg border p-3 space-y-1.5 bg-background h-[72px] flex flex-col justify-center">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" /> {pedidoHora || "—"}
                </p>
                <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" /> {nombreZona(pedidoEspacioId)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <p
                className={cn(
                  "text-xs font-medium uppercase tracking-wide",
                  hayContraoferta ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                )}
              >
                Se le ofrece{hayContraoferta ? " (contraoferta)" : ""}
              </p>
              <div
                className={cn(
                  "rounded-lg border p-3 space-y-1.5",
                  hayContraoferta
                    ? "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800"
                    : "bg-background",
                )}
              >
                <Select value={horaOferta} onValueChange={setHoraOferta} disabled={!puedeEditar || !!accionEnCurso}>
                  <SelectTrigger className="h-8 text-sm">
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
                <Select
                  value={espacioOferta ?? SIN_ZONA}
                  onValueChange={(v) => setEspacioOferta(v === SIN_ZONA ? null : v)}
                  disabled={!puedeEditar || !!accionEnCurso}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_ZONA}>Sin zona asignada</SelectItem>
                    {opcionesEspacio.map((e: any) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {errorHoras && (
            <p className="text-xs text-destructive">
              No se pudieron calcular las horas disponibles ahora mismo. Puedes aceptar tal cual o rechazar; para
              ofrecer otra hora, inténtalo de nuevo en un momento.
            </p>
          )}

          {!permisosLoading && !canEdit && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2">
              <Lock className="h-3.5 w-3.5 shrink-0" />
              Solo lectura: tu usuario no tiene permiso para verificar reservas.
            </div>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
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
          {puedeEditar && hayContraoferta && (
            <Button
              onClick={() =>
                ejecutar("contraoferta", () =>
                  verificarConContraoferta(reserva, { hora: horaOferta, espacio_id: espacioOferta }),
                )
              }
              disabled={!!accionEnCurso || !horaOferta}
            >
              {accionEnCurso === "contraoferta" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="mr-2 h-4 w-4" />
              )}
              Enviar propuesta
            </Button>
          )}
          {puedeEditar && (
            <Button
              onClick={() => ejecutar("aceptar", () => aceptarComoSolicitado(reserva))}
              disabled={!!accionEnCurso}
            >
              {accionEnCurso === "aceptar" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-2 h-4 w-4" />
              )}
              Aceptar tal cual
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
