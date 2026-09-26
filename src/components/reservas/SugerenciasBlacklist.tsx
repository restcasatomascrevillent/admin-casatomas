import { useState, type ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, addDays } from "date-fns";
import { es } from "date-fns/locale";
import {
  ShieldAlert,
  Phone,
  Mail,
  Loader2,
  CheckCircle,
  CheckCircle2,
  XCircle,
  CalendarIcon,
  CalendarOff,
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
  type HistorialClienteSugerencia,
} from "@/hooks/useSugerenciasBlacklist";

/** Caducidad por defecto de un veto aprobado desde una sugerencia: 90 días.
 * Un veto perpetuo por una falta es desproporcionado (RGPD: dato personal
 * con finalidad y plazo) — 90 días da margen de sobra para que el patrón de
 * ausencias se repita o no, y queda editable en el propio diálogo. */
const DIAS_CADUCIDAD_POR_DEFECTO = 90;

// ============================================================================
// DENSIDAD — copiada de ListaReservasAvanzada.tsx (commit a8383a4)
// ============================================================================
// Esta bandeja llega a tener 194 sugerencias pendientes. Como tarjeta, cada
// una medía ~345 px: unos 67.000 px de scroll, inmanejable. Se pasa a fila de
// tabla con la MISMA densidad que la lista de reservas, para que las dos
// pantallas de la pestaña se lean igual:
//   · alto de fila fijo (`ALTO_FILA`), relleno de celda propio (`CELDA`),
//   · acciones a la IZQUIERDA, en columna pegajosa y de ancho fijo,
//   · paginación de 50 (`TAMANO_PAGINA`),
//   · nada recortado: la prosa trunca CON su texto entero en `title`, las
//     insignias no truncan nunca (alto fijo + `whitespace-nowrap`).
// Las constantes están duplicadas a propósito: ListaReservasAvanzada.tsx las
// declara locales y no hay módulo compartido; extraerlo obligaría a tocar ese
// fichero, que ahora mismo lleva otro agente.
// ============================================================================

/** Filas por página, igual que la lista de reservas. 194 filas montadas de
 * golpe es justo el problema que se viene a arreglar. */
const TAMANO_PAGINA = 50;

/** 56 px por fila. Se sostiene porque ninguna celda pasa de dos líneas
 * `leading-tight` y todas las insignias tienen alto fijo. */
const ALTO_FILA = "h-14";
/** Sustituye el `p-4` que trae el primitivo `TableCell`. */
const CELDA = "px-1.5 py-2 align-middle xl:px-3";

/** El primitivo `Badge` no trae `whitespace-nowrap` ni alto fijo y es de uso
 * global, así que no se parchea allí: se aplica en cada sitio de llamada. */
const INSIGNIA =
  "h-5 shrink-0 gap-1 whitespace-nowrap px-1.5 py-0 text-[11px] font-medium lg:px-1 lg:text-[10px] xl:px-1.5 xl:text-[11px]";
const INSIGNIA_SECUNDARIA = "h-4 shrink-0 gap-1 whitespace-nowrap px-1 py-0 text-[10px] font-medium";

const ANCHO_ACCIONES = "w-[176px] xl:w-[188px]";
const ANCHO_MOTIVO = "w-[128px] xl:w-[152px]";
/** El `max-w` es imprescindible: con `truncate` (que implica `nowrap`) una
 * tabla de layout automático reclamaría el ancho del nombre más largo de la
 * página. `min-width: 0` por dentro no basta. */
const ANCHO_CLIENTE = "min-w-[130px] max-w-[200px] xl:max-w-[330px] 2xl:max-w-[560px]";
const ANCHO_HISTORIAL = "w-[124px] xl:w-[158px]";
const ANCHO_FECHA = "w-[74px] xl:w-[116px]";

/** Ancho FIJO de cada botón de acción. "Rechazar" y "Aprobar" miden distinto,
 * así que sin fijarlo el segundo botón caería en una X diferente en cada fila. */
const ANCHO_BOTON = "w-[82px] xl:w-[88px]";

/** Franja ámbar de "pendiente de revisar". Va como sombra interior y NO como
 * `border-l-4`: con `border-collapse`, un borde de verdad empuja el contenido
 * 2 px y los botones dejarían de caer en la misma X. */
const FRANJA_PENDIENTE = "shadow-[inset_4px_0_0_0_#fbbf24]";

const MOTIVO_LABELS: Record<string, string> = {
  no_show: "Ausencia sin avisar",
};

/**
 * Etiqueta visible del motivo y su texto completo para el `title`.
 *
 * Hoy el detector solo produce `no_show`, pero un motivo nuevo llegaría aquí
 * como clave cruda ("max_reservas_telefono"…). Una insignia no trunca nunca
 * —una insignia a medias es justo lo que se rechazó— y tampoco puede crecer
 * sin freno: con `whitespace-nowrap`, una clave larga ensancha su columna y
 * mete scroll horizontal en toda la tabla (medido a 1024 px). Así que a un
 * motivo desconocido se le pone etiqueta corta y el valor entero va en el
 * `title`, que es el mismo trato que `etiquetaPropuestaCorta` da a los textos
 * largos en ListaReservasAvanzada.tsx.
 */
function motivoTextos(motivo: string): { etiqueta: string; titulo: string } {
  const conocido = MOTIVO_LABELS[motivo];
  if (conocido) return { etiqueta: conocido, titulo: conocido };
  return { etiqueta: "Otro motivo", titulo: `Otro motivo: ${motivo}` };
}

// ============================================================================
// Historial
// ============================================================================

interface HistorialResumen {
  /** `null` = la sugerencia no trae snapshot de historial. */
  presente: boolean;
  total: number;
  noShows: number;
  completadas: number;
  canceladas: number;
  reincidente: boolean;
}

function resumirHistorial(h: HistorialClienteSugerencia | null | undefined): HistorialResumen {
  const presente = !!h && Object.keys(h).length > 0;
  return {
    presente,
    total: h?.total_reservas_previas ?? 0,
    noShows: h?.no_shows_previos ?? 0,
    completadas: h?.completadas_previas ?? 0,
    canceladas: h?.canceladas_previas ?? 0,
    reincidente: h?.es_primera_falta === false,
  };
}

/** Frase entera para el `title`: lo compacto de la celda no puede ser lo
 * único que exista, así que el detalle completo va aquí y, sin abreviar, en
 * el diálogo de aprobar. */
function historialTitulo(r: HistorialResumen): string {
  if (!r.presente) return "La sugerencia no trae historial previo registrado.";
  if (r.total === 0) return "Este cliente no tiene ninguna reserva previa registrada.";
  return `Historial previo: ${r.noShows} ausencias, ${r.completadas} completadas, ${r.canceladas} canceladas — ${r.total} reservas previas en total.`;
}

function ChipHistorial({ icono, valor, etiqueta }: { icono: ReactNode; valor: number; etiqueta: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums" title={`${valor} ${etiqueta}`}>
      {icono}
      {valor}
    </span>
  );
}

/**
 * Historial en una sola línea. Solo se pintan los contadores que NO son cero:
 * lo normal en esta bandeja es que un cliente no tenga antecedentes, y cuatro
 * cajas llenas de ceros ocupaban sitio sin decir nada. El detalle entero sigue
 * en el `title` y, completo, en el diálogo de aprobar.
 */
function CeldaHistorial({ resumen }: { resumen: HistorialResumen }) {
  const titulo = historialTitulo(resumen);

  if (!resumen.presente) {
    return (
      <span className="text-[11px] italic leading-tight text-muted-foreground" title={titulo}>
        Sin historial
      </span>
    );
  }
  if (resumen.total === 0) {
    return (
      <span className="text-[11px] leading-tight text-muted-foreground" title={titulo}>
        Sin antecedentes
      </span>
    );
  }
  return (
    <span
      className="flex items-center gap-1.5 whitespace-nowrap text-[11px] leading-tight xl:gap-2 xl:text-xs"
      title={titulo}
    >
      {resumen.noShows > 0 && (
        <ChipHistorial
          icono={<ShieldAlert className="h-3 w-3 shrink-0 text-red-600 dark:text-red-400" />}
          valor={resumen.noShows}
          etiqueta="ausencias previas"
        />
      )}
      {resumen.completadas > 0 && (
        <ChipHistorial
          icono={<CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />}
          valor={resumen.completadas}
          etiqueta="reservas completadas"
        />
      )}
      {resumen.canceladas > 0 && (
        <ChipHistorial
          icono={<CalendarOff className="h-3 w-3 shrink-0 text-muted-foreground" />}
          valor={resumen.canceladas}
          etiqueta="reservas canceladas"
        />
      )}
      <ChipHistorial
        icono={<History className="h-3 w-3 shrink-0 text-muted-foreground" />}
        valor={resumen.total}
        etiqueta="reservas previas en total"
      />
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="rounded-md bg-muted/50 py-1.5 px-1 text-center">
      <p className="text-sm font-semibold leading-none tabular-nums">{value ?? "—"}</p>
      <p className="text-[10px] text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ============================================================================
// Acciones
// ============================================================================

/**
 * Los dos botones de una fila, siempre en el mismo orden y a la misma X.
 *
 * Los dos llevan TEXTO, no icono a secas: aprobar mete a una persona real en
 * la lista negra y rechazar la descarta, y dos botones icónicos del mismo
 * tamaño uno al lado del otro es justo la confusión que no se puede permitir.
 * "Rechazar" va en contorno neutro y "Aprobar" relleno en ámbar (el color de
 * la bandeja) para que se distingan también por color, no solo por posición.
 * Los dos piden confirmación en un diálogo aparte.
 */
function AccionesSugerencia({
  onRechazar,
  onAprobar,
  nombre,
  pendiente,
}: {
  onRechazar: () => void;
  onAprobar: () => void;
  nombre: string;
  pendiente: boolean;
}) {
  const tituloRechazar = `Rechazar la sugerencia de ${nombre} — no se añadirá a la lista negra`;
  const tituloAprobar = `Añadir a ${nombre} a la lista negra — pedirá fecha de caducidad`;
  return (
    <>
      <span className="inline-flex shrink-0" title={tituloRechazar}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={tituloRechazar}
          aria-label={tituloRechazar}
          disabled={pendiente}
          onClick={onRechazar}
          className={cn("h-7 shrink-0 justify-center gap-1 px-1 text-[11px] [&_svg]:size-3.5", ANCHO_BOTON)}
        >
          <XCircle />
          Rechazar
        </Button>
      </span>
      <span className="inline-flex shrink-0" title={tituloAprobar}>
        <Button
          type="button"
          size="sm"
          title={tituloAprobar}
          aria-label={tituloAprobar}
          disabled={pendiente}
          onClick={onAprobar}
          className={cn(
            "h-7 shrink-0 justify-center gap-1 px-1 text-[11px] [&_svg]:size-3.5",
            "bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500",
            ANCHO_BOTON,
          )}
        >
          <CheckCircle />
          Aprobar
        </Button>
      </span>
    </>
  );
}

/** Aviso de solo lectura, del ancho de la columna de acciones. */
function SoloLectura() {
  const texto = "Solo lectura: tu usuario no tiene permiso para aprobar o rechazar sugerencias.";
  return (
    <span className="flex items-center gap-1 text-[11px] text-muted-foreground" title={texto}>
      <Lock className="h-3.5 w-3.5 shrink-0" />
      Solo lectura
    </span>
  );
}

// ============================================================================
// Celdas compartidas entre la tabla (lg+) y las tarjetas (por debajo de lg)
// ============================================================================

function InsigniaMotivo({ motivo }: { motivo: string }) {
  const { etiqueta, titulo } = motivoTextos(motivo);
  return (
    <Badge
      className={cn(INSIGNIA, "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300")}
      title={titulo}
    >
      <ShieldAlert className="h-3 w-3 shrink-0" />
      {etiqueta}
    </Badge>
  );
}

/** Nombre + contacto. Dos líneas `leading-tight`, que es lo que cabe en 56 px. */
function BloqueCliente({ sugerencia, reincidente }: { sugerencia: SugerenciaBlacklist; reincidente: boolean }) {
  const nombre = sugerencia.nombre_cliente || "Cliente sin nombre";
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="truncate font-medium leading-tight" title={nombre}>
          {nombre}
        </p>
        {reincidente && (
          <Badge
            variant="outline"
            className={cn(INSIGNIA_SECUNDARIA, "border-amber-300 text-amber-700 dark:text-amber-400")}
            title="Ya tenía ausencias sin avisar antes de esta"
          >
            Reincidente
          </Badge>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-tight text-muted-foreground xl:text-xs">
        {sugerencia.telefono && (
          <span className="flex shrink-0 items-center gap-0.5 tabular-nums" title={sugerencia.telefono}>
            <Phone className="h-3 w-3 shrink-0" />
            {sugerencia.telefono}
          </span>
        )}
        {sugerencia.email && (
          <span className="flex min-w-0 items-center gap-0.5" title={sugerencia.email}>
            <Mail className="h-3 w-3 shrink-0" />
            <span className="truncate">{sugerencia.email}</span>
          </span>
        )}
        {!sugerencia.telefono && !sugerencia.email && <span className="italic">Sin contacto</span>}
      </div>
    </div>
  );
}

/** Fecha de detección: corta por debajo de xl, entera a partir de xl. Misma
 * información, dos renderizados — nunca se recorta. */
function BloqueFecha({ creadaAt }: { creadaAt: string | null }) {
  if (!creadaAt) return <span className="text-muted-foreground">—</span>;
  const d = new Date(creadaAt);
  const corta = format(d, "dd/MM", { locale: es });
  const larga = format(d, "d MMM yyyy", { locale: es });
  const hhmm = format(d, "HH:mm", { locale: es });
  return (
    <span
      className="flex flex-col text-xs leading-tight xl:flex-row xl:items-baseline xl:gap-2 xl:text-sm"
      title={`Detectada el ${larga} a las ${hhmm}`}
    >
      <span>
        <span className="xl:hidden">{corta}</span>
        <span className="hidden xl:inline">{larga}</span>
      </span>
      <span className="font-medium">{hhmm}</span>
    </span>
  );
}

// ============================================================================
// Bandeja
// ============================================================================

/**
 * Bandeja de sugerencias de blacklist pendientes de revisar — el sistema
 * propone (ausencias detectadas por el cron diario), una persona decide.
 * Pensada para ir ENCIMA de la tabla de `GestionBlacklist.tsx`, dentro de la
 * misma pestaña "Blacklist" — no es una pantalla/navegación nueva.
 */
export function SugerenciasBlacklist() {
  const { data: sugerencias, isLoading, isError, error, refetch } = useSugerenciasBlacklistPendientes();
  const { canAccess: canEdit } = useCanAccessSection("reservas", "edit");

  const aprobar = useAprobarSugerenciaBlacklist();
  const rechazar = useRechazarSugerenciaBlacklist();

  // Un ÚNICO diálogo de cada tipo para toda la bandeja: montar uno por fila
  // serían 100 diálogos en el DOM con la página llena.
  const [aAprobar, setAAprobar] = useState<SugerenciaBlacklist | null>(null);
  const [aRechazar, setARechazar] = useState<SugerenciaBlacklist | null>(null);
  const [caducaEl, setCaducaEl] = useState<Date>(() => addDays(new Date(), DIAS_CADUCIDAD_POR_DEFECTO));
  const [motivoAprobacion, setMotivoAprobacion] = useState("");

  const [pagina, setPagina] = useState(1);

  const abrirAprobar = (s: SugerenciaBlacklist) => {
    // Reset por sugerencia: la caducidad y el motivo de la anterior no se
    // arrastran a la siguiente.
    setCaducaEl(addDays(new Date(), DIAS_CADUCIDAD_POR_DEFECTO));
    setMotivoAprobacion("");
    setAAprobar(s);
  };

  const confirmarAprobar = async () => {
    if (!aAprobar) return;
    const ok = await aprobar
      .mutateAsync({ id: aAprobar.id, caducaEl: format(caducaEl, "yyyy-MM-dd"), motivo: motivoAprobacion })
      .then(() => true)
      .catch(() => false);
    if (ok) setAAprobar(null);
  };

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

  // --- Paginación ----------------------------------------------------------
  // `paginaActual` es un valor derivado y acotado, nunca el estado en bruto:
  // al aprobar/rechazar las últimas de la página final la lista se encoge y
  // sin acotar se quedaría en blanco.
  const totalPaginas = Math.max(1, Math.ceil(sugerencias.length / TAMANO_PAGINA));
  const paginaActual = Math.min(pagina, totalPaginas);
  const primeraDeLaPagina = (paginaActual - 1) * TAMANO_PAGINA;
  const filasPagina = sugerencias.slice(primeraDeLaPagina, primeraDeLaPagina + TAMANO_PAGINA);
  const hayPaginacion = totalPaginas > 1;

  const irAPagina = (destino: number) => {
    setPagina(Math.min(Math.max(1, destino), totalPaginas));
    // Volver arriba: si no, cambias de página y sigues viendo el centro de la
    // lista anterior.
    window.scrollTo({ top: 0 });
  };

  const mutando = aprobar.isPending || rechazar.isPending;
  const nombreDe = (s: SugerenciaBlacklist | null) => s?.nombre_cliente || "este cliente";

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-medium flex items-center gap-1.5">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          Sugerencias pendientes
          <Badge variant="secondary">{sugerencias.length}</Badge>
        </h3>
        <p className="text-xs text-muted-foreground">
          Ausencias detectadas automáticamente. Revísalas antes de que caduquen de interés.
        </p>
      </div>

      {/* Tarjetas compactas por debajo de lg (la tabla no cabe sin recortar) */}
      <div className="space-y-2 lg:hidden">
        {filasPagina.map((s) => {
          const resumen = resumirHistorial(s.historial);
          return (
            <div key={s.id} className={cn("rounded-md border bg-card p-2.5 space-y-1.5", FRANJA_PENDIENTE)}>
              <div className="flex items-start justify-between gap-2">
                <InsigniaMotivo motivo={s.motivo} />
                <span className="shrink-0 text-xs text-muted-foreground">
                  <BloqueFecha creadaAt={s.creada_at} />
                </span>
              </div>
              <BloqueCliente sugerencia={s} reincidente={resumen.reincidente} />
              <div className="flex items-center justify-between gap-2">
                <CeldaHistorial resumen={resumen} />
                <div className="flex shrink-0 items-center gap-1">
                  {canEdit ? (
                    <AccionesSugerencia
                      nombre={nombreDe(s)}
                      pendiente={mutando}
                      onRechazar={() => setARechazar(s)}
                      onAprobar={() => abrirAprobar(s)}
                    />
                  ) : (
                    <SoloLectura />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabla a partir de lg */}
      <Card className="hidden overflow-hidden lg:block">
        <CardContent className="p-0">
          <Table className="text-xs xl:text-sm">
            <TableHeader>
              <TableRow>
                <TableHead
                  aria-label="Acciones"
                  className={cn("sticky left-0 z-30 h-10 border-r border-border/60 bg-card", ANCHO_ACCIONES, CELDA)}
                />
                <TableHead className={cn("h-10 bg-card", ANCHO_MOTIVO, CELDA)}>Motivo</TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_CLIENTE, CELDA)}>Cliente</TableHead>
                <TableHead className={cn("h-10 bg-card", ANCHO_HISTORIAL, CELDA)}>Historial</TableHead>
                <TableHead className={cn("h-10 bg-card whitespace-nowrap", ANCHO_FECHA, CELDA)}>Detectada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filasPagina.map((s) => {
                const resumen = resumirHistorial(s.historial);
                return (
                  <TableRow key={s.id} className={cn("group bg-card hover:bg-muted", ALTO_FILA)}>
                    <TableCell
                      className={cn(
                        "px-1.5 py-2 align-middle xl:px-2",
                        ANCHO_ACCIONES,
                        "sticky left-0 z-10 border-r border-border/60",
                        FRANJA_PENDIENTE,
                        "bg-card group-hover:bg-muted",
                      )}
                    >
                      <div className="flex items-center justify-start gap-1">
                        {canEdit ? (
                          <AccionesSugerencia
                            nombre={nombreDe(s)}
                            pendiente={mutando}
                            onRechazar={() => setARechazar(s)}
                            onAprobar={() => abrirAprobar(s)}
                          />
                        ) : (
                          <SoloLectura />
                        )}
                      </div>
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_MOTIVO)}>
                      <InsigniaMotivo motivo={s.motivo} />
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_CLIENTE)}>
                      <BloqueCliente sugerencia={s} reincidente={resumen.reincidente} />
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_HISTORIAL)}>
                      <CeldaHistorial resumen={resumen} />
                    </TableCell>
                    <TableCell className={cn(CELDA, ANCHO_FECHA, "whitespace-nowrap tabular-nums")}>
                      <BloqueFecha creadaAt={s.creada_at} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Paginación. Vale para las dos vistas. La bandeja va en FIFO, así que
          lo más viejo sin resolver sigue cayendo en la página 1. */}
      {hayPaginacion && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
          <p className="text-sm text-muted-foreground">
            Mostrando{" "}
            <span className="font-medium text-foreground tabular-nums">
              {primeraDeLaPagina + 1}–{primeraDeLaPagina + filasPagina.length}
            </span>{" "}
            de <span className="tabular-nums">{sugerencias.length}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={paginaActual === 1} onClick={() => irAPagina(paginaActual - 1)}>
              Anterior
            </Button>
            <span className="text-sm tabular-nums text-muted-foreground">
              Página {paginaActual} de {totalPaginas}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={paginaActual === totalPaginas}
              onClick={() => irAPagina(paginaActual + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* --- Rechazar: un solo AlertDialog para toda la bandeja ------------ */}
      <AlertDialog open={!!aRechazar} onOpenChange={(abierto) => !abierto && setARechazar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Rechazar esta sugerencia?</AlertDialogTitle>
            <AlertDialogDescription>
              {aRechazar?.nombre_cliente || "Este cliente"} no se añadirá a la lista negra. Esta reserva no volverá a
              proponerse: si quieres, puedes dejar una nota para el equipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {aRechazar && (
            <RechazarForm
              key={aRechazar.id}
              onConfirmar={(nota) => rechazar.mutate({ id: aRechazar.id, nota })}
              pendiente={rechazar.isPending}
            />
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* --- Aprobar: un solo Dialog para toda la bandeja ------------------ */}
      <Dialog open={!!aAprobar} onOpenChange={(abierto) => !abierto && setAAprobar(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Aprobar y añadir a lista negra</DialogTitle>
            <DialogDescription>
              {aAprobar?.nombre_cliente || "Este cliente"} quedará bloqueado para reservar hasta la fecha de caducidad.
              Un veto sin plazo no está permitido — es un dato personal con finalidad y plazo, no indefinido.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* El historial completo, sin abreviar, en el momento en que se
                decide: la fila lo resume, aquí están los cuatro números. */}
            <div className="space-y-1.5">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <History className="h-3 w-3" /> Historial de este cliente
              </p>
              {(() => {
                const r = resumirHistorial(aAprobar?.historial);
                if (!r.presente) {
                  return <p className="text-xs text-muted-foreground italic">Sin historial previo registrado.</p>;
                }
                return (
                  <div className="grid grid-cols-4 gap-1.5">
                    <Stat label="Ausencias" value={r.noShows} />
                    <Stat label="Completadas" value={r.completadas} />
                    <Stat label="Canceladas" value={r.canceladas} />
                    <Stat label="Total previas" value={r.total} />
                  </div>
                );
              })()}
            </div>
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
                placeholder={`Ausencia sin avisar (${aAprobar?.motivo ?? "no_show"})`}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAAprobar(null)} disabled={aprobar.isPending}>
              Cancelar
            </Button>
            <Button onClick={confirmarAprobar} disabled={aprobar.isPending}>
              {aprobar.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckCircle className="h-4 w-4 mr-1" />
              )}
              Aprobar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
