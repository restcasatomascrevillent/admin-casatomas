import { Fragment, useState } from "react";
import { describeDevice } from "@/lib/audit-device";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  ArrowRight,
  ChevronDown,
  Euro,
  Eye,
  Gift,
  KeyRound,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  MessageSquare,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { format, isSameYear, isToday, isYesterday } from "date-fns";
import { es } from "date-fns/locale";
import { cn } from "@/lib/utils";
import {
  resumirCambios,
  TABLA_LABEL,
  type AuditLogEntry,
  type AuditLogGrupo,
} from "@/hooks/useAuditLog";
import {
  camposLegibles,
  camposArchivoLegibles,
  etiquetaCampo,
  puedeRevertir,
  resumenEntrada,
  tipoEvento,
  valorLegible,
} from "@/lib/auditoria";
import { RevertirCambioDialog } from "./RevertirCambioDialog";

/**
 * Aspecto de cada acción: nombre, icono, color de la marca (`className`) y
 * color sólido del punto del desglose de «Por día» / «Por mes» (`punto`).
 */
export const ACCION_UI: Record<
  string,
  { label: string; icon: typeof LogIn; className: string; punto: string }
> = {
  login: {
    label: "Inicio de sesión",
    icon: LogIn,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    punto: "bg-emerald-500",
  },
  intento_login: {
    label: "Intento pendiente",
    icon: LogIn,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    punto: "bg-amber-500",
  },
  login_fallido: {
    label: "Acceso fallido",
    icon: LogIn,
    className: "bg-destructive/10 text-destructive",
    punto: "bg-destructive",
  },
  acceso: {
    label: "Acceso con sesión",
    icon: LogIn,
    className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    punto: "bg-emerald-500",
  },
  acceso_denegado: {
    label: "Acceso denegado",
    icon: LogIn,
    className: "bg-destructive/10 text-destructive",
    punto: "bg-destructive",
  },
  logout: {
    label: "Cierre de sesión",
    icon: LogOut,
    className: "bg-muted text-muted-foreground",
    punto: "bg-muted-foreground/60",
  },
  crear: {
    label: "Creación",
    icon: Plus,
    className: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    punto: "bg-blue-500",
  },
  actualizar: {
    label: "Cambio",
    icon: Pencil,
    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
    punto: "bg-amber-500",
  },
  eliminar: {
    label: "Eliminación",
    icon: Trash2,
    className: "bg-destructive/10 text-destructive",
    punto: "bg-destructive",
  },
  ejecutar: {
    label: "Acción",
    icon: Activity,
    className: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
    punto: "bg-violet-500",
  },
};
const EVENTO_LABEL: Record<string, string> = {
  consulta_ia: "Pregunta a la IA",
  regeneracion_ia: "Regenerar respuesta",
  mensaje_ia: "Historial de la IA",
  cambiar_precio: "Cambio de precio",
  cambiar_visibilidad: "Cambio de visibilidad",
  canjear_cheque: "Canje de cheque",
  cambiar_permisos: "Cambio de permisos",
  cambiar_roles: "Cambio de roles",
  cambiar_credenciales: "Credenciales",
  bloquear_acceso: "Acceso bloqueado",
  desbloquear_acceso: "Acceso desbloqueado",
  reversion: "Reversión",
};
/** Icono propio de los eventos concretos; si no hay, el de la acción. */
const EVENTO_ICONO: Record<string, typeof LogIn> = {
  consulta_ia: Sparkles,
  regeneracion_ia: Sparkles,
  crear_chat_ia: MessageSquare,
  eliminar_chat_ia: MessageSquare,
  mensaje_ia: MessageSquare,
  cambiar_precio: Euro,
  cambiar_visibilidad: Eye,
  canjear_cheque: Gift,
  cambiar_permisos: ShieldCheck,
  cambiar_roles: ShieldCheck,
  cambiar_credenciales: KeyRound,
  bloquear_acceso: Lock,
  desbloquear_acceso: LockOpen,
  reversion: Undo2,
};
const HERRAMIENTAS: Record<string, string> = {
  estadisticas_globales: "Estadísticas generales",
  resumen_periodo: "Resumen de un período",
  ranking: "Comparación de proveedores y productos",
  filtrar_documentos: "Filtrar facturas y albaranes",
  detalle_documento: "Detalle de un documento",
  historial_precios: "Historial de precios",
  compras_producto: "Compras de un producto",
  gasto_por_categoria: "Gasto por categoría",
  variacion_precios: "Cambios de precios",
  ficha_proveedor: "Ficha de proveedor",
  albaranes_sin_factura: "Albaranes sin factura",
  grafico_precio: "Gráfico de precios",
  buscar_productos: "Buscar productos",
  buscar_facturas: "Buscar facturas",
  consulta_flexible: "Consulta de datos",
};

/** Caja de un dato del detalle (campo y valor). */
const CAJA_DATO = "min-w-0 rounded-md border border-border/70 bg-background p-2.5";

function DetalleEntrada({ entrada }: { entrada: AuditLogEntry }) {
  const d = entrada.detalles ?? {};
  const evento = tipoEvento(entrada);
  const chat = ["consulta_ia", "regeneracion_ia"].includes(evento);
  const archivo = entrada.tabla === "storage.objects";
  const cambios =
    entrada.accion === "actualizar"
      ? resumirCambios(entrada.detalles).filter(
          (c) => c.antes !== "[oculto]" && c.despues !== "[oculto]",
        )
      : [];
  return (
    <div className="space-y-3">
      {chat ? (
        <>
          <div className="rounded-md bg-muted/60 p-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">Pregunta del usuario</p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {String(d.pregunta ?? "Sin pregunta registrada")}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-background p-3">
            <p className="mb-1 text-xs font-semibold text-muted-foreground">
              Respuesta de la IA de facturas
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {String(d.respuesta ?? "Sin respuesta registrada")}
            </p>
          </div>
          {Array.isArray(d.herramientas) && d.herramientas.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold text-muted-foreground">
                Consultas realizadas por la IA
              </p>
              <ol className="space-y-2">
                {d.herramientas.map(
                  (
                    h: {
                      nombre?: string;
                      argumentos?: unknown;
                      resultado?: string;
                    },
                    i: number,
                  ) => (
                    <li key={i} className="rounded-md border border-border/70 bg-background p-2 text-xs">
                      <p className="font-medium">
                        {i + 1}.{" "}
                        {HERRAMIENTAS[h.nombre ?? ""] ??
                          etiquetaCampo(h.nombre ?? "Consulta")}{" "}
                        ·{" "}
                        {h.resultado === "fallida"
                          ? "Fallida"
                          : h.resultado === "no_ejecutada"
                            ? "No ejecutada"
                            : "Completada"}
                      </p>
                      {camposLegibles(h.argumentos).map((c) => (
                        <p key={c.campo} className="mt-1 break-words">
                          {c.etiqueta}: {c.valor}
                        </p>
                      ))}
                    </li>
                  ),
                )}
              </ol>
            </div>
          )}
          {d.conversacion_id != null && (
            <p className="break-all text-xs text-muted-foreground">
              Conversación: {String(d.conversacion_id)}
            </p>
          )}
          {typeof d.duracion_ms === "number" && (
            <p className="text-xs text-muted-foreground">
              Tiempo de respuesta:{" "}
              {(d.duracion_ms / 1000).toLocaleString("es-ES", {
                maximumFractionDigits: 1,
              })}{" "}
              s
            </p>
          )}
        </>
      ) : d.credenciales_actualizadas ? (
        <p className="text-sm">
          Credenciales actualizadas. La contraseña no se guarda en la auditoría.
        </p>
      ) : archivo ? (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {camposArchivoLegibles(entrada).map((c) => (
            <div key={c.campo} className={CAJA_DATO}>
              <dt className="text-xs font-medium text-muted-foreground">{c.etiqueta}</dt>
              <dd className="mt-0.5 break-words">{c.valor}</dd>
            </div>
          ))}
        </dl>
      ) : cambios.length > 0 ? (
        // Antes → después: lo de antes tachado en rojo suave, lo nuevo en verde.
        <dl className="grid grid-cols-1 gap-2 text-sm lg:grid-cols-2">
          {cambios.map((c) => (
            <div key={c.campo} className={CAJA_DATO}>
              <dt className="text-xs font-medium text-muted-foreground">{etiquetaCampo(c.campo)}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="min-w-0 rounded bg-red-50 px-1.5 py-0.5 text-red-800 line-through decoration-red-400/70 [overflow-wrap:anywhere] dark:bg-red-950/40 dark:text-red-300">
                  <span className="sr-only">Antes: </span>
                  {valorLegible(c.campo, c.antes)}
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-800 [overflow-wrap:anywhere] dark:bg-emerald-950/40 dark:text-emerald-300">
                  <span className="sr-only">Ahora: </span>
                  {valorLegible(c.campo, c.despues)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {camposLegibles(d.despues ?? d.antes ?? d).map((c) => (
            <div key={c.campo} className={CAJA_DATO}>
              <dt className="text-xs font-medium text-muted-foreground">{c.etiqueta}</dt>
              <dd className="mt-0.5 whitespace-pre-wrap break-words">
                {c.valor}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {d.evento_original_id != null && (
        <p className="break-all text-xs text-muted-foreground">
          Cambio original: {String(d.evento_original_id)}
        </p>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="inline-flex cursor-pointer items-center py-2 font-medium hover:text-foreground pointer-coarse:min-h-11">
          Detalles técnicos
        </summary>
        <div className="space-y-0.5">
          <p className="break-all">Registro de auditoría: {entrada.id}</p>
          {entrada.actor_user_id && (
            <p className="break-all">Usuario: {entrada.actor_user_id}</p>
          )}
          {entrada.registro_id && (
            <p className="break-all">Registro afectado: {entrada.registro_id}</p>
          )}
          {entrada.user_agent && (
            <p className="break-all">Navegador: {entrada.user_agent}</p>
          )}
          {entrada.session_id && (
            <p className="break-all">Sesión: {entrada.session_id}</p>
          )}
          {entrada.request_id && (
            <p className="break-all">Petición: {entrada.request_id}</p>
          )}
        </div>
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2">
          {JSON.stringify(d, null, 2)}
        </pre>
      </details>
    </div>
  );
}

/** «Hoy · miércoles 18 de noviembre», «Ayer · …» o la fecha (con año si no es el actual). */
function etiquetaDia(fecha: Date): string {
  const dia = format(
    fecha,
    isSameYear(fecha, new Date()) ? "EEEE d 'de' MMMM" : "EEEE d 'de' MMMM 'de' yyyy",
    { locale: es },
  );
  if (isToday(fecha)) return `Hoy · ${dia}`;
  if (isYesterday(fecha)) return `Ayer · ${dia}`;
  return dia.charAt(0).toUpperCase() + dia.slice(1);
}

/** Deja cortar un correo largo justo detrás de la «@» (y no a mitad de palabra) cuando no cabe en una línea. */
function conCortes(texto: string) {
  const partes = texto.split("@");
  if (partes.length < 2) return texto;
  return partes.flatMap((parte, i) => (i === 0 ? [parte] : ["@", <wbr key={i} />, parte]));
}

interface FilaAuditoriaProps {
  grupo: AuditLogGrupo;
  abierta: boolean;
  onToggle: () => void;
  onRevertir: (entrada: AuditLogEntry) => void;
}

/**
 * Un registro: icono de color según lo que pasó, la frase de qué ha pasado
 * como titular y, debajo, quién, en qué sección y desde dónde. A la derecha,
 * la hora. En el móvil todo va en una columna; desde 768 px quién va en su
 * propia columna para poder repasar la lista por persona.
 */
function FilaAuditoria({ grupo, abierta, onToggle, onRevertir }: FilaAuditoriaProps) {
  const entrada = grupo.entradas[0];
  const ui = ACCION_UI[grupo.accion] ?? ACCION_UI.actualizar;
  const evento = tipoEvento(entrada);
  const Icon = EVENTO_ICONO[evento] ?? ui.icon;
  const fecha = new Date(grupo.created_at);
  const resultado = String(
    entrada.resultado ?? entrada.detalles?.resultado ??
      (["login_fallido", "acceso_denegado"].includes(entrada.accion)
        ? "fallida"
        : "completada"),
  );
  const dispositivo = describeDevice(entrada.user_agent);
  const sinAutor =
    grupo.actor_origin === "historico" ||
    (!grupo.actor_email && !grupo.actor_user_id && !grupo.actor_origin);
  return (
    <article className={cn("min-w-0", abierta && "bg-primary/[0.03]")}>
      <button
        type="button"
        className={cn(
          "grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none md:grid-cols-[2.25rem_minmax(0,1fr)_minmax(9rem,12rem)_auto] lg:grid-cols-[2.25rem_minmax(0,1fr)_minmax(10rem,16rem)_auto] lg:px-4",
          abierta && "shadow-[inset_3px_0_0_0_hsl(var(--primary))]",
        )}
        aria-expanded={abierta}
        aria-controls={`detalle-${grupo.key}`}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={cn(
            "col-start-1 row-span-3 row-start-1 flex h-9 w-9 items-center justify-center rounded-full md:row-span-2",
            ui.className,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <p className="col-start-2 row-start-1 break-words text-sm font-medium leading-snug text-foreground">
          {resumenEntrada(entrada)}
          {grupo.entradas.length > 1
            ? ` (${grupo.entradas.length} cambios)`
            : ""}
        </p>
        <span className="col-start-2 row-start-2 text-xs font-medium text-foreground/75 [overflow-wrap:anywhere] md:col-start-3 md:row-span-2 md:row-start-1 md:pt-px md:text-sm md:font-normal">
          {conCortes(grupo.actor_label)}
        </span>
        <div className="col-start-2 row-start-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground md:row-start-2">
          <Badge
            variant="outline"
            className={cn("gap-1 border-transparent px-1.5 py-0 font-medium", ui.className)}
          >
            {EVENTO_LABEL[evento] ?? ui.label}
          </Badge>
          <span>
            {TABLA_LABEL[grupo.tabla ?? ""] ??
              etiquetaCampo(grupo.tabla ?? "Panel")}
          </span>
          {(resultado === "fallida" || resultado === "parcial") && (
            <span className="font-medium text-destructive">
              {resultado === "parcial"
                ? "Resultado parcial"
                : "Fallida"}
            </span>
          )}
          {/* En el móvil el dispositivo y la IP se ven al desplegar, para que la fila respire. */}
          <span className="hidden sm:inline">{dispositivo}</span>
          {entrada.ip_address && (
            <span className="hidden sm:inline">IP: {entrada.ip_address}</span>
          )}
          {entrada.device_id && (
            <span className="sr-only">{entrada.device_id}</span>
          )}
        </div>
        {sinAutor && (
          <p className="col-start-2 row-start-4 text-xs italic text-muted-foreground md:col-span-2 md:row-start-3">
            El registro original no conservó el autor.
          </p>
        )}
        <span className="col-start-3 row-span-2 row-start-1 flex flex-col items-end gap-1.5 md:col-start-4">
          <time
            className="whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:text-sm"
            dateTime={grupo.created_at}
            title={format(fecha, "d MMM yyyy, HH:mm:ss", { locale: es })}
          >
            {format(fecha, "HH:mm")}
          </time>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform motion-reduce:transition-none",
              abierta && "rotate-180",
            )}
            aria-hidden="true"
          />
        </span>
      </button>
      {abierta && (
        <div
          id={`detalle-${grupo.key}`}
          className="space-y-4 border-t border-border/60 bg-muted/25 px-3 pb-4 pt-3 md:pl-[3.75rem] lg:pl-16 lg:pr-4"
        >
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Cuándo:</dt>
              <dd className="min-w-0 font-medium">
                {format(fecha, "EEEE d 'de' MMMM 'de' yyyy, HH:mm:ss", { locale: es })}
              </dd>
            </div>
            <div className="flex min-w-0 gap-1.5">
              <dt className="shrink-0 text-muted-foreground">Dispositivo:</dt>
              <dd className="min-w-0 break-words font-medium">
                {dispositivo}
                {entrada.ip_address ? ` · IP ${entrada.ip_address}` : ""}
              </dd>
            </div>
          </dl>
          {grupo.entradas.map((e) => (
            <div key={e.id} className="space-y-3">
              <DetalleEntrada entrada={e} />
              {puedeRevertir(e) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onRevertir(e)}
                  className="gap-2 bg-background"
                >
                  <Undo2 className="h-4 w-4" /> Revertir este cambio
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export interface TablaEntradasAuditoriaProps {
  grupos: AuditLogGrupo[];
  expandidas: Set<string>;
  onToggle: (key: string) => void;
  /**
   * Pone una cabecera fija con el día («Hoy · …», «Ayer · …») cada vez que
   * cambia de día. Para la lista suelta; en «Por día» y «Por mes» el día ya
   * lo dice el bloque.
   */
  separarPorDia?: boolean;
}

/** Lista plana de registros (un separador fino entre filas, sin tarjetas dentro de tarjetas). */
export function TablaEntradasAuditoria({
  grupos,
  expandidas,
  onToggle,
  separarPorDia = false,
}: TablaEntradasAuditoriaProps) {
  const [revertir, setRevertir] = useState<AuditLogEntry | null>(null);
  let diaAnterior = "";
  return (
    <>
      <div className="divide-y divide-border/60">
        {grupos.map((grupo) => {
          const fecha = new Date(grupo.created_at);
          const dia = format(fecha, "yyyy-MM-dd");
          const nuevoDia = separarPorDia && dia !== diaAnterior;
          diaAnterior = dia;
          return (
            <Fragment key={grupo.key}>
              {nuevoDia && (
                <h2 className="sticky top-0 z-10 bg-[color-mix(in_srgb,hsl(var(--muted))_45%,hsl(var(--card)))] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground lg:px-4">
                  {etiquetaDia(fecha)}
                </h2>
              )}
              <FilaAuditoria
                grupo={grupo}
                abierta={expandidas.has(grupo.key)}
                onToggle={() => onToggle(grupo.key)}
                onRevertir={setRevertir}
              />
            </Fragment>
          );
        })}
      </div>
      {revertir && (
        <RevertirCambioDialog
          entrada={revertir}
          onClose={() => setRevertir(null)}
        />
      )}
    </>
  );
}
