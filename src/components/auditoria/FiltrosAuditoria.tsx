import { useRef, useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AuditLogFiltros } from "@/hooks/useAuditLog";
import { TABLA_LABEL } from "@/hooks/useAuditLog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { SlidersHorizontal, ChevronDown } from "lucide-react";

const GRUPOS_ACCION = [
  {
    label: "Grupos de acciones",
    opciones: [
      ["grupo_cambios", "Todos los cambios de datos"],
      ["grupo_ia", "Toda la actividad de la IA"],
      ["grupo_accesos", "Todos los accesos"],
    ],
  },
  {
    label: "Cambios de datos",
    opciones: [
      ["crear", "Creación"],
      ["actualizar", "Cambio"],
      ["eliminar", "Eliminación"],
      ["cambiar_precio", "Cambiar precio"],
      ["cambiar_visibilidad", "Mostrar / ocultar contenido"],
      ["canjear_cheque", "Canjear cheque regalo"],
    ],
  },
  {
    label: "IA de facturas",
    opciones: [
      ["consulta_ia", "Pregunta a la IA de facturas"],
      ["regeneracion_ia", "Regenerar respuesta de la IA"],
      ["crear_chat_ia", "Crear conversación con la IA"],
      ["eliminar_chat_ia", "Eliminar conversación con la IA"],
      ["mensaje_ia", "Mensajes históricos de la IA"],
    ],
  },
  {
    label: "Usuarios y permisos",
    opciones: [
      ["cambiar_permisos", "Cambiar permisos"],
      ["cambiar_roles", "Cambiar roles"],
      ["cambiar_credenciales", "Cambiar credenciales"],
      ["bloquear_acceso", "Bloquear acceso de usuario"],
      ["desbloquear_acceso", "Desbloquear acceso de usuario"],
      ["reversion", "Revertir un cambio"],
    ],
  },
  {
    label: "Accesos al panel",
    opciones: [
      ["login", "Inicio de sesión"],
      ["logout", "Cierre de sesión"],
      ["login_fallido", "Acceso fallido"],
      ["acceso_denegado", "Acceso denegado"],
      ["acceso", "Acceso con sesión"],
      ["intento_login", "Intento pendiente"],
    ],
  },
  {
    label: "Servidor",
    opciones: [
      ["ejecutar", "Acción del servidor"],
      ["validar_reversion", "Validación para revertir"],
    ],
  },
];
const SELECT_CLASS =
  "h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring";
const INPUT_CLASS = "h-11 w-full min-w-0 max-w-full rounded-lg text-base";

interface Props {
  pendientes: AuditLogFiltros;
  activos: AuditLogFiltros;
  tablas: readonly string[];
  onChange: (filtros: AuditLogFiltros) => void;
  onAplicar: () => void;
  onLimpiar: () => void;
}

export function FiltrosAuditoria({
  pendientes,
  activos,
  tablas,
  onChange,
  onAplicar,
  onLimpiar,
}: Props) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [avanzados, setAvanzados] = useState(false);
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const cantidad = Object.entries(activos).filter(
    ([campo, v]) =>
      Boolean(v?.trim()) && !(campo === "origen" && v === "sin_servidor"),
  ).length;
  const cambiar = (campo: keyof AuditLogFiltros, valor: string) =>
    onChange({ ...pendientes, [campo]: valor || undefined });
  const opcionActiva = GRUPOS_ACCION.flatMap((g) => g.opciones).find(
    ([valor]) => valor === activos.accion,
  )?.[1];
  const resumen = Object.entries(activos)
    .filter(([campo, valor]) => Boolean(valor?.trim()) && !(campo === "origen" && valor === "sin_servidor"))
    .map(([campo, valor]) => {
      const etiquetas: Record<string, string> = { accion: "Acción", tabla: "Sección", texto: "Búsqueda", actor: "Persona", desde: "Desde", hasta: "Hasta", dispositivo: "Dispositivo", resultado: "Resultado", origen: "Origen" };
      const origenes: Record<string, string> = { usuario: "Personas", servidor: "Procesos", intento: "Intentos", historico: "Histórico" };
      const legible = campo === "accion" ? opcionActiva ?? valor : campo === "tabla" ? TABLA_LABEL[valor!] ?? valor : campo === "origen" ? origenes[valor!] ?? valor : valor;
      return `${etiquetas[campo] ?? campo}: ${legible}`;
    });
  const sinAplicar = Object.keys({ ...pendientes, ...activos }).some(
    campo => (pendientes[campo as keyof AuditLogFiltros] ?? "") !== (activos[campo as keyof AuditLogFiltros] ?? ""),
  );

  const form = (
    <form
      className={mobile ? "flex min-h-0 flex-1 flex-col" : "space-y-4"}
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar();
        if (!mobile) desktopTrigger.current?.focus();
        setOpen(false);
      }}
    >
      <div
        className={
          mobile
            ? "min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
            : "space-y-4"
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="auditoria-accion">Tipo de acción</Label>
            <select
              id="auditoria-accion"
              className={SELECT_CLASS}
              value={pendientes.accion ?? ""}
              onChange={(e) => cambiar("accion", e.target.value)}
            >
              <option value="">Todas las acciones</option>
              {GRUPOS_ACCION.map((grupo) => (
                <optgroup key={grupo.label} label={grupo.label}>
                  {grupo.opciones.map(([valor, label]) => (
                    <option key={valor} value={valor}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="auditoria-origen">Origen de la acción</Label>
            <select
              id="auditoria-origen"
              className={SELECT_CLASS}
              value={pendientes.origen ?? ""}
              onChange={(e) => cambiar("origen", e.target.value)}
            >
              <option value="sin_servidor">Sin procesos del servidor</option>
              <option value="">Todos (incluye servidor)</option>
              <option value="usuario">Personas</option>
              <option value="servidor">Procesos / servidor</option>
              <option value="intento">Intentos sin verificar</option>
              <option value="historico">Histórico sin identificar</option>
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="auditoria-seccion">Sección</Label>
            <select
              id="auditoria-seccion"
              className={SELECT_CLASS}
              value={pendientes.tabla ?? ""}
              onChange={(e) => cambiar("tabla", e.target.value)}
            >
              <option value="">Todas las secciones</option>
              {tablas.map((t) => (
                <option key={t} value={t}>
                  {TABLA_LABEL[t] ?? t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="auditoria-texto">Buscar en auditoría</Label>
            <Input
              id="auditoria-texto"
              className={INPUT_CLASS}
              placeholder="Plato, vino o pregunta…"
              value={pendientes.texto ?? ""}
              onChange={(e) => cambiar("texto", e.target.value)}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          className="h-11 w-full justify-between px-0 text-sm md:w-auto md:gap-3"
          aria-expanded={avanzados}
          aria-controls="auditoria-filtros-avanzados"
          onClick={() => setAvanzados((v) => !v)}
        >
          Persona, fechas y otros filtros{" "}
          <ChevronDown
            className={`h-4 w-4 transition-transform ${avanzados ? "rotate-180" : ""}`}
            aria-hidden="true"
          />
        </Button>
        {avanzados && (
          <div
            id="auditoria-filtros-avanzados"
            className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5"
          >
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="auditoria-actor">Persona / proceso</Label>
              <Input
                id="auditoria-actor"
                className={INPUT_CLASS}
                placeholder="Correo o nombre del proceso"
                value={pendientes.actor ?? ""}
                onChange={(e) => cambiar("actor", e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="auditoria-desde">Desde</Label>
              <Input
                id="auditoria-desde"
                type="date"
                className={`${INPUT_CLASS} appearance-none [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left`}
                style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                value={pendientes.desde ?? ""}
                onChange={(e) => cambiar("desde", e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="auditoria-hasta">Hasta</Label>
              <Input
                id="auditoria-hasta"
                type="date"
                className={`${INPUT_CLASS} appearance-none [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left`}
                style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
                value={pendientes.hasta ?? ""}
                onChange={(e) => cambiar("hasta", e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="auditoria-dispositivo">Dispositivo</Label>
              <Input
                id="auditoria-dispositivo"
                className={INPUT_CLASS}
                placeholder="ID del dispositivo"
                value={pendientes.dispositivo ?? ""}
                onChange={(e) => cambiar("dispositivo", e.target.value)}
              />
            </div>
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="auditoria-resultado">Resultado</Label>
              <select
                id="auditoria-resultado"
                className={SELECT_CLASS}
                value={pendientes.resultado ?? ""}
                onChange={(e) => cambiar("resultado", e.target.value)}
              >
                <option value="">Todos los resultados</option>
                <option value="completada">Completado</option>
                <option value="fallida">Fallido</option>
                <option value="parcial">Parcial</option>
                <option value="pendiente">Pendiente</option>
              </select>
            </div>
          </div>
        )}
      </div>
      <div
        className={
          mobile
            ? "grid shrink-0 grid-cols-2 gap-3 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            : "flex justify-end gap-3"
        }
      >
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={onLimpiar}
        >
          Limpiar
        </Button>
        <Button type="submit" className="h-11">
          Aplicar filtros
        </Button>
      </div>
    </form>
  );

  if (!mobile)
    return (
      <Card className="shrink-0 overflow-hidden shadow-none">
        <div className="flex min-w-0 items-center gap-3 px-2 py-1.5">
          <Button
            type="button"
            variant="ghost"
            className="h-11 shrink-0 gap-2 px-3"
            aria-label={open ? "Recoger filtros" : "Mostrar filtros"}
            aria-expanded={open}
            aria-controls="auditoria-filtros-escritorio"
            ref={desktopTrigger}
            onClick={() => setOpen(v => !v)}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filtros
            {cantidad > 0 && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">{cantidad}</span>}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {sinAplicar ? "Cambios sin aplicar" : cantidad > 0 ? "Filtros aplicados" : "Filtra por acción, sección, persona o fecha"}
          </p>
          {cantidad > 0 && <Button type="button" variant="ghost" className="h-11 shrink-0 text-xs" onClick={onLimpiar} aria-label="Limpiar filtros activos">Limpiar</Button>}
        </div>
        {resumen.length > 0 && <div aria-label="Filtros aplicados" className="flex min-w-0 flex-wrap gap-1.5 px-4 pb-3">
          {resumen.map(texto => <span key={texto} className="max-w-full rounded-md bg-muted px-2 py-1 text-xs break-words [overflow-wrap:anywhere]">{texto}</span>)}
        </div>}
        {open && <CardContent id="auditoria-filtros-escritorio" className="border-t bg-muted/10 p-4">{form}</CardContent>}
      </Card>
    );
  return (
    <>
      <Card className="shrink-0">
        <CardContent className="p-2">
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full justify-between px-3"
            onClick={() => {
              setAvanzados(
                Boolean(
                  pendientes.actor ||
                    pendientes.desde ||
                    pendientes.hasta ||
                    pendientes.dispositivo ||
                    pendientes.resultado,
                ),
              );
              setOpen(true);
            }}
          >
            <span className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4" />
              Filtros
              {cantidad > 0 && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs">
                  {cantidad}
                </span>
              )}
            </span>
            <ChevronDown className="h-4 w-4" />
          </Button>
          {opcionActiva && (
            <p className="truncate px-3 pb-2 text-xs text-muted-foreground">
              Tipo: {opcionActiva}
            </p>
          )}
        </CardContent>
      </Card>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-0 top-auto bottom-0 h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl p-0 overflow-hidden pointer-coarse:top-auto pointer-coarse:h-[min(88dvh,calc(var(--vv-h,100dvh)_-_1rem))] pointer-coarse:bottom-[max(0px,calc(100dvh_-_var(--vv-top,0px)_-_var(--vv-h,100dvh)))] pointer-coarse:max-h-none">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left">
            <DialogTitle>Filtrar auditoría</DialogTitle>
            <DialogDescription>
              Elige el tipo de acción y aplica los filtros.
            </DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    </>
  );
}
