import { useState } from "react";
import { describeDevice } from "@/lib/audit-device";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  LogIn,
  LogOut,
  Plus,
  Pencil,
  Trash2,
  Activity,
  Undo2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import {
  resumirCambios,
  TABLA_LABEL,
  type AuditLogEntry,
  type AuditLogGrupo,
} from "@/hooks/useAuditLog";
import {
  camposLegibles,
  etiquetaCampo,
  puedeRevertir,
  resumenEntrada,
  tipoEvento,
  valorLegible,
} from "@/lib/auditoria";
import { RevertirCambioDialog } from "./RevertirCambioDialog";

export const ACCION_UI: Record<
  string,
  { label: string; icon: typeof LogIn; className: string }
> = {
  login: {
    label: "Inicio de sesión",
    icon: LogIn,
    className: "bg-emerald-500/10 text-emerald-600",
  },
  intento_login: {
    label: "Intento pendiente",
    icon: LogIn,
    className: "bg-amber-500/10 text-amber-600",
  },
  login_fallido: {
    label: "Acceso fallido",
    icon: LogIn,
    className: "bg-destructive/10 text-destructive",
  },
  acceso: {
    label: "Acceso con sesión",
    icon: LogIn,
    className: "bg-emerald-500/10 text-emerald-600",
  },
  acceso_denegado: {
    label: "Acceso denegado",
    icon: LogIn,
    className: "bg-destructive/10 text-destructive",
  },
  logout: {
    label: "Cierre de sesión",
    icon: LogOut,
    className: "bg-muted text-muted-foreground",
  },
  crear: {
    label: "Creación",
    icon: Plus,
    className: "bg-blue-500/10 text-blue-600",
  },
  actualizar: {
    label: "Cambio",
    icon: Pencil,
    className: "bg-amber-500/10 text-amber-600",
  },
  eliminar: {
    label: "Eliminación",
    icon: Trash2,
    className: "bg-destructive/10 text-destructive",
  },
  ejecutar: {
    label: "Acción",
    icon: Activity,
    className: "bg-violet-500/10 text-violet-600",
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

function DetalleEntrada({ entrada }: { entrada: AuditLogEntry }) {
  const d = entrada.detalles ?? {};
  const evento = tipoEvento(entrada);
  const chat = ["consulta_ia", "regeneracion_ia"].includes(evento);
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
          <div className="rounded-md bg-muted/50 p-3">
            <p className="mb-1 text-sm font-semibold">Pregunta del usuario</p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {String(d.pregunta ?? "Sin pregunta registrada")}
            </p>
          </div>
          <div className="rounded-md border p-3">
            <p className="mb-1 text-sm font-semibold">
              Respuesta de la IA de facturas
            </p>
            <p className="whitespace-pre-wrap break-words text-sm">
              {String(d.respuesta ?? "Sin respuesta registrada")}
            </p>
          </div>
          {Array.isArray(d.herramientas) && d.herramientas.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold">
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
                    <li key={i} className="rounded-md border p-2 text-xs">
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
      ) : cambios.length > 0 ? (
        <dl className="grid grid-cols-1 gap-2 text-sm lg:grid-cols-2">
          {cambios.map((c) => (
            <div key={c.campo} className="min-w-0 rounded-md border p-2">
              <dt className="font-medium">{etiquetaCampo(c.campo)}</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-muted-foreground line-through [overflow-wrap:anywhere]">
                  {valorLegible(c.campo, c.antes)}
                </span>
                <span aria-label="cambia a">→</span>
                <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                  {valorLegible(c.campo, c.despues)}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          {camposLegibles(d.despues ?? d.antes ?? d).map((c) => (
            <div key={c.campo} className="min-w-0 rounded-md bg-muted/40 p-2">
              <dt className="font-medium">{c.etiqueta}</dt>
              <dd className="whitespace-pre-wrap break-words text-muted-foreground">
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
        <summary className="cursor-pointer py-2">Detalles técnicos</summary>
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
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-muted p-2">
          {JSON.stringify(d, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export interface TablaEntradasAuditoriaProps {
  grupos: AuditLogGrupo[];
  expandidas: Set<string>;
  onToggle: (key: string) => void;
  columnaCuando?: "fecha-hora" | "solo-hora";
}
export function TablaEntradasAuditoria({
  grupos,
  expandidas,
  onToggle,
  columnaCuando = "fecha-hora",
}: TablaEntradasAuditoriaProps) {
  const [revertir, setRevertir] = useState<AuditLogEntry | null>(null);
  return (
    <>
      <div className="space-y-2">
        <div aria-hidden="true" className="hidden grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)_10.5rem] gap-x-4 px-3 pl-9 pb-1 text-xs font-medium text-muted-foreground lg:grid">
          <span>Usuario / origen</span><span>Acción y detalle</span><span className="text-right">{columnaCuando === "solo-hora" ? "Hora" : "Fecha y hora"}</span>
        </div>
        {grupos.map((grupo) => {
          const entrada = grupo.entradas[0];
          const ui = ACCION_UI[grupo.accion] ?? ACCION_UI.actualizar;
          const Icon = ui.icon;
          const evento = tipoEvento(entrada);
          const abierta = expandidas.has(grupo.key);
          const resultado = String(
            entrada.detalles?.resultado ??
              (["login_fallido", "acceso_denegado"].includes(entrada.accion)
                ? "fallida"
                : "completada"),
          );
          return (
            <article
              key={grupo.key}
              className="min-w-0 overflow-hidden rounded-lg border bg-card"
            >
              <button
                type="button"
                className="flex w-full items-start gap-2 p-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-expanded={abierta}
                aria-controls={`detalle-${grupo.key}`}
                onClick={() => onToggle(grupo.key)}
              >
                <ChevronDown
                  className={`mt-1 h-4 w-4 shrink-0 transition-transform ${abierta ? "rotate-180" : ""}`}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1 space-y-2 lg:grid lg:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)_10.5rem] lg:gap-x-4 lg:gap-y-1.5 lg:space-y-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 lg:contents">
                    <span className="break-all text-sm font-semibold lg:col-start-1 lg:row-start-1">
                      {grupo.actor_label}
                    </span>
                    <time
                      className="text-xs text-muted-foreground lg:col-start-3 lg:row-start-1 lg:text-right lg:whitespace-nowrap"
                      dateTime={grupo.created_at}
                    >
                      {format(
                        new Date(grupo.created_at),
                        columnaCuando === "solo-hora"
                          ? "HH:mm:ss"
                          : "d MMM yyyy, HH:mm:ss",
                        { locale: es },
                      )}
                    </time>
                  </div>
                  <p className="break-words text-sm lg:col-start-2 lg:row-start-1">
                    {resumenEntrada(entrada)}
                    {grupo.entradas.length > 1
                      ? ` (${grupo.entradas.length} cambios)`
                      : ""}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 lg:col-start-2 lg:col-span-2 lg:row-start-2">
                    <Badge
                      variant="outline"
                      className={`gap-1 ${ui.className}`}
                    >
                      <Icon className="h-3 w-3" />
                      {EVENTO_LABEL[evento] ?? ui.label}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {TABLA_LABEL[grupo.tabla ?? ""] ??
                        etiquetaCampo(grupo.tabla ?? "Panel")}
                    </span>
                    {(resultado === "fallida" || resultado === "parcial") && (
                      <span className="text-xs font-medium text-destructive">
                        {resultado === "parcial"
                          ? "Resultado parcial"
                          : "Fallida"}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {describeDevice(entrada.user_agent)}
                    </span>
                    {entrada.ip_address && (
                      <span className="text-xs text-muted-foreground">
                        IP: {entrada.ip_address}
                      </span>
                    )}
                    {entrada.device_id && (
                      <span className="sr-only">{entrada.device_id}</span>
                    )}
                  </div>
                  {(grupo.actor_origin === "historico" ||
                    (!grupo.actor_email &&
                      !grupo.actor_user_id &&
                      !grupo.actor_origin)) && (
                    <p className="text-xs text-muted-foreground lg:col-span-3">
                      El registro original no conservó el autor.
                    </p>
                  )}
                </div>
              </button>
              {abierta && (
                <div
                  id={`detalle-${grupo.key}`}
                  className="space-y-3 border-t p-3 lg:bg-muted/10 lg:p-4"
                >
                  {grupo.entradas.map((e) => (
                    <div key={e.id} className="space-y-3">
                      <DetalleEntrada entrada={e} />
                      {puedeRevertir(e) && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setRevertir(e)}
                          className="gap-2"
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
