import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Users,
  Phone,
  Calendar,
  Clock,
  MessageSquare,
  CheckCircle,
  XCircle,
  PhoneOutgoing,
  AlertTriangle,
  Loader2,
  ChevronDown,
  ChevronUp,
  StickyNote,
  CalendarPlus,
  Settings2,
} from "lucide-react";
import { format } from "date-fns";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { estadoPropuestaVista } from "@/lib/reservas/propuestaCliente";
import { EstadoPropuestaBadge } from "./EstadoPropuestaBadge";

export const MOTIVO_LABELS: Record<string, { label: string; color: string }> = {
  grupo_grande: { label: "Grupo grande", color: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300" },
  sin_disponibilidad: { label: "Sin disponibilidad", color: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  reserva_hoy: { label: "Reserva para hoy", color: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" },
  fuera_horario: { label: "Fuera de horario", color: "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300" },
  corte_horario: { label: "Poco margen", color: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300" },
  max_reservas_telefono: { label: "Límite teléfono", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  max_reservas_email: { label: "Límite email", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  otro: { label: "Otro", color: "bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300" },
};

export const ESTADO_LABELS: Record<string, { label: string; icon: typeof Clock }> = {
  pendiente: { label: "Pendiente", icon: Clock },
  contactado: { label: "Contactado", icon: PhoneOutgoing },
  resuelta: { label: "Resuelta", icon: CheckCircle },
  descartada: { label: "Descartada", icon: XCircle },
};

// La tarjeta de una solicitud del bot. La usan la lista unificada de reservas
// (ListaReservasAvanzada.tsx, vista de móvil) y el diálogo de gestión
// (SolicitudGestionPanel.tsx). La pestaña propia de solicitudes que la montaba
// (`GestionSolicitudes`) ya no existe: las solicitudes viven en la Lista.
export function SolicitudCard({
  solicitud,
  onUpdateEstado,
  onUpdateNotas,
  onConvertir,
  onGestionarPropuesta,
  defaultExpanded = false,
}: {
  solicitud: SolicitudPendiente;
  onUpdateEstado: (id: string, estado: string) => Promise<boolean>;
  onUpdateNotas: (id: string, notas: string) => Promise<boolean>;
  /** Si se pasa, aparece "Convertir en reserva" (abre el alta prerrellenada). */
  onConvertir?: (solicitud: SolicitudPendiente) => void;
  /** Si se pasa, aparece "Propuesta y salas" (abre el diálogo de gestión completo). */
  onGestionarPropuesta?: (solicitud: SolicitudPendiente) => void;
  defaultExpanded?: boolean;
}) {
  const vistaPropuesta = estadoPropuestaVista(solicitud, format(new Date(), "yyyy-MM-dd"));
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [editingNotas, setEditingNotas] = useState(false);
  const [notasDraft, setNotasDraft] = useState(solicitud.notas_internas || "");
  const [saving, setSaving] = useState(false);

  const motivo = MOTIVO_LABELS[solicitud.motivo_rechazo] || MOTIVO_LABELS.otro;
  const createdAt = solicitud.created_at
    ? new Date(solicitud.created_at).toLocaleString("es-ES", {
        day: "2-digit", month: "2-digit", year: "2-digit",
        hour: "2-digit", minute: "2-digit",
      })
    : "";

  const handleSaveNotas = async () => {
    setSaving(true);
    await onUpdateNotas(solicitud.id, notasDraft);
    setEditingNotas(false);
    setSaving(false);
  };

  const handleEstado = async (estado: string) => {
    setSaving(true);
    await onUpdateEstado(solicitud.id, estado);
    setSaving(false);
  };

  const isPendiente = solicitud.estado === "pendiente";

  return (
    <Card className={isPendiente ? "border-l-4 border-l-amber-400" : "opacity-75"}>
      <CardContent className="p-3 sm:p-4 space-y-2">
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className={motivo.color}>{motivo.label}</Badge>
            <Badge variant={isPendiente ? "default" : "secondary"} className="gap-1">
              {(() => {
                const E = ESTADO_LABELS[solicitud.estado]?.icon || Clock;
                return <E className="h-3 w-3" />;
              })()}
              {ESTADO_LABELS[solicitud.estado]?.label || solicitud.estado}
            </Badge>
            {vistaPropuesta && vistaPropuesta.clave !== "borrador" && <EstadoPropuestaBadge vista={vistaPropuesta} />}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{createdAt}</span>
        </div>

        {/* Info principal */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {solicitud.nombre && (
            <span className="font-medium">{solicitud.nombre}</span>
          )}
          {solicitud.telefono && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Phone className="h-3 w-3" />
              <a href={`tel:${solicitud.telefono}`} className="hover:underline">
                {solicitud.telefono}
              </a>
            </span>
          )}
          {solicitud.numero_comensales && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Users className="h-3 w-3" />{solicitud.numero_comensales} pers.
            </span>
          )}
          {solicitud.fecha_solicitada && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {new Date(solicitud.fecha_solicitada).toLocaleDateString("es-ES")}
            </span>
          )}
          {solicitud.hora_solicitada && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className="h-3 w-3" />{solicitud.hora_solicitada}
            </span>
          )}
        </div>

        {/* Descripción del rechazo */}
        {solicitud.descripcion_rechazo && (
          <p className="text-sm text-muted-foreground bg-muted/50 rounded px-2 py-1">
            <AlertTriangle className="h-3 w-3 inline mr-1" />
            {solicitud.descripcion_rechazo}
          </p>
        )}

        {/* Notas del cliente */}
        {solicitud.notas_cliente && (
          <p className="text-sm text-muted-foreground italic">
            <MessageSquare className="h-3 w-3 inline mr-1" />
            "{solicitud.notas_cliente}"
          </p>
        )}

        {/* Notas internas (siempre visible si hay) */}
        {solicitud.notas_internas && !editingNotas && (
          <div className="bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1 text-sm">
            <StickyNote className="h-3 w-3 inline mr-1 text-amber-600" />
            <span className="font-medium text-amber-700 dark:text-amber-400">Nota interna:</span>{" "}
            {solicitud.notas_internas}
          </div>
        )}

        {/* Expandir/Contraer */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full h-7 text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
          {expanded ? "Menos opciones" : "Gestionar"}
        </Button>

        {/* Zona expandida: acciones y notas */}
        {expanded && (
          <div className="space-y-3 pt-2 border-t">
            {/* Editor de notas internas */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <StickyNote className="h-3 w-3" />
                Anotaciones internas
              </label>
              {editingNotas ? (
                <div className="space-y-2">
                  <Textarea
                    value={notasDraft}
                    onChange={(e) => setNotasDraft(e.target.value)}
                    placeholder="Escribe notas internas sobre esta solicitud..."
                    rows={3}
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveNotas} disabled={saving}>
                      {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Guardar
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setEditingNotas(false);
                      setNotasDraft(solicitud.notas_internas || "");
                    }}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  onClick={() => setEditingNotas(true)}
                >
                  <StickyNote className="h-3 w-3 mr-1" />
                  {solicitud.notas_internas ? "Editar nota" : "Añadir nota"}
                </Button>
              )}
            </div>

            {/* Acciones de estado */}
            <div className="flex flex-wrap gap-2">
              {onGestionarPropuesta && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => onGestionarPropuesta(solicitud)}
                >
                  <Settings2 className="h-3 w-3 mr-1" />
                  Propuesta y salas
                </Button>
              )}
              {onConvertir && (solicitud.estado === "pendiente" || solicitud.estado === "contactado") && (
                <Button
                  size="sm"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => onConvertir(solicitud)}
                >
                  <CalendarPlus className="h-3 w-3 mr-1" />
                  Convertir en reserva
                </Button>
              )}
              {solicitud.estado !== "contactado" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => handleEstado("contactado")}
                >
                  <PhoneOutgoing className="h-3 w-3 mr-1" />
                  Contactado
                </Button>
              )}
              {solicitud.estado !== "resuelta" && (
                <Button
                  size="sm"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => handleEstado("resuelta")}
                >
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Resuelta
                </Button>
              )}
              {solicitud.estado !== "descartada" && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => handleEstado("descartada")}
                >
                  <XCircle className="h-3 w-3 mr-1" />
                  Descartar
                </Button>
              )}
              {solicitud.estado !== "pendiente" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  disabled={saving}
                  onClick={() => handleEstado("pendiente")}
                >
                  <Clock className="h-3 w-3 mr-1" />
                  Volver a pendiente
                </Button>
              )}
            </div>

            {/* Enlace directo para llamar */}
            {solicitud.telefono && (
              <a
                href={`tel:${solicitud.telefono}`}
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Phone className="h-3 w-3" />
                Llamar al {solicitud.telefono}
              </a>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
