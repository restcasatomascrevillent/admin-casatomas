import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  ShieldAlert,
  Phone,
  Mail,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  CalendarIcon,
  History,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useCanAccessSection } from "@/hooks/useUserRole";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  useSugerenciasBlacklistPendientes,
  useAprobarSugerenciaBlacklist,
  useRechazarSugerenciaBlacklist,
  MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE,
  type SugerenciaBlacklist,
} from "@/hooks/useSugerenciasBlacklist";

/** Caducidad por defecto de un veto aprobado desde una sugerencia: 90 días.
 * Un veto perpetuo por una falta es desproporcionado (RGPD: dato personal
 * con finalidad y plazo) — 90 días da margen de sobra para que el patrón de
 * ausencias se repita o no, y queda editable en el propio diálogo. */
const DIAS_CADUCIDAD_POR_DEFECTO = 90;

const MOTIVO_LABELS: Record<string, string> = {
  no_show: "Ausencia sin avisar",
};

function motivoLabel(motivo: string): string {
  return MOTIVO_LABELS[motivo] || motivo;
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md bg-muted/50 py-1.5 px-1 text-center">
      <p className="text-sm font-semibold leading-none">{value ?? "—"}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

function TarjetaSugerencia({
  sugerencia,
  canEdit,
}: {
  sugerencia: SugerenciaBlacklist;
  canEdit: boolean;
}) {
  const aprobar = useAprobarSugerenciaBlacklist();
  const rechazar = useRechazarSugerenciaBlacklist();

  const [dialogAprobarAbierto, setDialogAprobarAbierto] = useState(false);
  const [caducaEl, setCaducaEl] = useState<Date>(() => addDays(new Date(), DIAS_CADUCIDAD_POR_DEFECTO));
  const [motivoAprobacion, setMotivoAprobacion] = useState("");

  const h = sugerencia.historial;
  const hayHistorial = !!h && Object.keys(h).length > 0;

  const creada = sugerencia.creada_at
    ? format(new Date(sugerencia.creada_at), "d MMM yyyy, HH:mm", { locale: es })
    : "";

  const handleAprobar = async () => {
    const ok = await aprobar
      .mutateAsync({ id: sugerencia.id, caducaEl: format(caducaEl, "yyyy-MM-dd"), motivo: motivoAprobacion })
      .then(() => true)
      .catch(() => false);
    if (ok) setDialogAprobarAbierto(false);
  };

  return (
    <Card className="border-l-4 border-l-amber-400">
      <CardContent className="p-3 sm:p-4 space-y-3">
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 gap-1">
              <ShieldAlert className="h-3 w-3" />
              {motivoLabel(sugerencia.motivo)}
            </Badge>
            {h?.es_primera_falta === false && (
              <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-300">
                Reincidente
              </Badge>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap flex items-center gap-1">
            <Clock className="h-3 w-3" /> {creada}
          </span>
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">{sugerencia.nombre_cliente || "Cliente sin nombre"}</span>
          {sugerencia.telefono && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Phone className="h-3 w-3" /> {sugerencia.telefono}
            </span>
          )}
          {sugerencia.email && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Mail className="h-3 w-3" /> {sugerencia.email}
            </span>
          )}
        </div>

        {/* Historial que justifica la sugerencia — quien aprueba tiene que poder juzgar, no solo pulsar. */}
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <History className="h-3 w-3" /> Historial de este cliente
          </p>
          {hayHistorial ? (
            <div className="grid grid-cols-4 gap-1.5">
              <Stat label="Ausencias" value={h?.no_shows_previos} />
              <Stat label="Completadas" value={h?.completadas_previas} />
              <Stat label="Canceladas" value={h?.canceladas_previas} />
              <Stat label="Total previas" value={h?.total_reservas_previas} />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sin historial previo registrado.</p>
          )}
        </div>

        {!canEdit ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2">
            <Lock className="h-3.5 w-3.5 shrink-0" />
            Solo lectura: tu usuario no tiene permiso para aprobar o rechazar sugerencias.
          </div>
        ) : (
          <div className="flex gap-2 justify-end pt-1">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={rechazar.isPending}>
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Rechazar
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Rechazar esta sugerencia?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {sugerencia.nombre_cliente || "Este cliente"} no se añadirá a la lista negra. Esta reserva no
                    volverá a proponerse: si quieres, puedes dejar una nota para el equipo.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <RechazarForm
                  onConfirmar={(nota) => rechazar.mutate({ id: sugerencia.id, nota })}
                  pendiente={rechazar.isPending}
                />
              </AlertDialogContent>
            </AlertDialog>

            <Dialog open={dialogAprobarAbierto} onOpenChange={setDialogAprobarAbierto}>
              <Button size="sm" onClick={() => setDialogAprobarAbierto(true)} disabled={aprobar.isPending}>
                <CheckCircle className="h-3.5 w-3.5 mr-1" />
                Aprobar
              </Button>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Aprobar y añadir a lista negra</DialogTitle>
                  <DialogDescription>
                    {sugerencia.nombre_cliente || "Este cliente"} quedará bloqueado para reservar hasta la fecha de
                    caducidad. Un veto sin plazo no está permitido — es un dato personal con finalidad y plazo, no
                    indefinido.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label className="text-sm">Caduca el</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className="w-full justify-start text-left font-normal">
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {format(caducaEl, "d MMM yyyy", { locale: es })}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={caducaEl}
                          onSelect={(d) => d && setCaducaEl(d)}
                          disabled={(d) => d <= new Date()}
                          initialFocus
                          className="pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      Por defecto, {DIAS_CADUCIDAD_POR_DEFECTO} días desde hoy. Puedes cambiarla.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm">Motivo (opcional)</Label>
                    <Textarea
                      value={motivoAprobacion}
                      onChange={(e) => setMotivoAprobacion(e.target.value)}
                      placeholder={`Ausencia sin avisar (${sugerencia.motivo})`}
                      rows={2}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogAprobarAbierto(false)} disabled={aprobar.isPending}>
                    Cancelar
                  </Button>
                  <Button onClick={handleAprobar} disabled={aprobar.isPending}>
                    {aprobar.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                    Aprobar
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RechazarForm({ onConfirmar, pendiente }: { onConfirmar: (nota: string) => void; pendiente: boolean }) {
  const [nota, setNota] = useState("");
  return (
    <>
      <div className="py-2">
        <Textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Nota para el equipo (opcional): por qué se rechaza…"
          rows={2}
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
        <AlertDialogAction onClick={() => onConfirmar(nota)} disabled={pendiente}>
          {pendiente ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
          Rechazar sugerencia
        </AlertDialogAction>
      </AlertDialogFooter>
    </>
  );
}

/**
 * Bandeja de sugerencias de blacklist pendientes de revisar — el sistema
 * propone (ausencias detectadas por el cron diario), una persona decide.
 * Pensada para ir ENCIMA de la tabla de `GestionBlacklist.tsx`, dentro de la
 * misma pestaña "Blacklist" — no es una pantalla/navegación nueva.
 */
export function SugerenciasBlacklist() {
  const { data: sugerencias, isLoading, isError, error, refetch } = useSugerenciasBlacklistPendientes();
  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const migracionPendiente = isError && error instanceof Error && error.message === MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE;

  if (migracionPendiente) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground border rounded-md p-2.5 bg-muted/30">
        <Lock className="h-3.5 w-3.5 shrink-0" />
        {MENSAJE_MIGRACION_SUGERENCIAS_PENDIENTE}
      </div>
    );
  }

  if (isError) {
    return <EstadoErrorCarga titulo="las sugerencias de lista negra" error={error} onReintentar={() => refetch()} />;
  }

  if (!sugerencias || sugerencias.length === 0) {
    return (
      <p className="text-xs text-muted-foreground flex items-center gap-1.5 px-1">
        <ShieldAlert className="h-3.5 w-3.5" />
        Sin sugerencias de lista negra pendientes.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          Sugerencias pendientes
          <Badge variant="secondary">{sugerencias.length}</Badge>
        </h3>
        <p className="text-xs text-muted-foreground">Ausencias detectadas automáticamente. Revísalas antes de que caduquen de interés.</p>
      </div>
      {sugerencias.map((s) => (
        <TarjetaSugerencia key={s.id} sugerencia={s} canEdit={canEdit} />
      ))}
    </div>
  );
}
