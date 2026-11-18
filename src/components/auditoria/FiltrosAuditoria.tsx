import { useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { useIsMobile } from "@/hooks/use-mobile";
import type { AuditLogFiltros } from "@/hooks/useAuditLog";
import { TABLA_LABEL } from "@/hooks/useAuditLog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CLASE_CONTADOR } from "@/components/panel/PestanasPagina";
import { cn } from "@/lib/utils";
import { SlidersHorizontal, ChevronDown, Search, X } from "lucide-react";

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
const ETIQUETA_ACCION = new Map(GRUPOS_ACCION.flatMap((g) => g.opciones as [string, string][]));
const ETIQUETA_CAMPO: Record<keyof AuditLogFiltros, string> = {
  accion: "Acción",
  tabla: "Sección",
  texto: "Búsqueda",
  actor: "Persona",
  desde: "Desde",
  hasta: "Hasta",
  dispositivo: "Dispositivo",
  resultado: "Resultado",
  origen: "Origen",
};
const ORIGENES: Record<string, string> = { usuario: "Personas", servidor: "Procesos", intento: "Intentos", historico: "Histórico" };
const RESULTADOS: Record<string, string> = { completada: "Completado", fallida: "Fallido", parcial: "Parcial", pendiente: "Pendiente" };
/** Campos de «Más opciones»: si alguno está puesto, el bloque se abre solo. */
const CAMPOS_AVANZADOS = ["origen", "resultado", "dispositivo"] as const;

const SELECT_CLASS =
  "h-11 w-full min-w-0 max-w-full rounded-lg border border-input bg-background px-3 text-base text-foreground focus:outline-none focus:ring-2 focus:ring-ring md:h-10 md:text-sm pointer-coarse:h-11 pointer-coarse:text-base";
const INPUT_CLASS = "h-11 w-full min-w-0 max-w-full rounded-lg text-base md:h-10 md:text-sm";
const INPUT_FECHA = `${INPUT_CLASS} appearance-none [&::-webkit-date-and-time-value]:min-w-0 [&::-webkit-date-and-time-value]:text-left`;

function fechaCorta(valor: string): string {
  const fecha = parseISO(valor);
  return Number.isNaN(fecha.getTime()) ? valor : format(fecha, "d MMM yyyy", { locale: es });
}

function legible(campo: keyof AuditLogFiltros, valor: string): string {
  if (campo === "accion") return ETIQUETA_ACCION.get(valor) ?? valor;
  if (campo === "tabla") return TABLA_LABEL[valor] ?? valor;
  if (campo === "origen") return ORIGENES[valor] ?? valor;
  if (campo === "resultado") return RESULTADOS[valor] ?? valor;
  if (campo === "desde" || campo === "hasta") return fechaCorta(valor);
  return valor;
}

/** Filtros aplicados que se enseñan como chips (el origen «sin procesos del servidor» es el de siempre y no cuenta). */
function filtrosVisibles(activos: AuditLogFiltros, ocultar: readonly (keyof AuditLogFiltros)[]) {
  return (Object.entries(activos) as [keyof AuditLogFiltros, string | undefined][])
    .filter(
      ([campo, valor]) =>
        Boolean(valor?.trim()) &&
        !(campo === "origen" && valor === "sin_servidor") &&
        !ocultar.includes(campo),
    )
    .map(([campo, valor]) => ({ campo, texto: `${ETIQUETA_CAMPO[campo] ?? campo}: ${legible(campo, valor!)}` }));
}

interface Props {
  pendientes: AuditLogFiltros;
  activos: AuditLogFiltros;
  tablas: readonly string[];
  onChange: (filtros: AuditLogFiltros) => void;
  onAplicar: () => void;
  onLimpiar: () => void;
  /** Quita esos filtros ya aplicados (la «×» de cada chip y «Limpiar»). Sin él, los chips no llevan «×». */
  onQuitar?: (campos: (keyof AuditLogFiltros)[]) => void;
  /**
   * Campos que ya enseña la fila de categorías rápidas (p. ej. «Platos» pone acción y sección): no salen como chip
   * ni cuentan en el número del botón, para no decir lo mismo dos veces.
   */
  ocultarEnResumen?: readonly (keyof AuditLogFiltros)[];
}

/**
 * Barra de filtros de la auditoría: el buscador siempre a la vista (Intro para buscar), el botón «Filtros» con el
 * número de filtros puestos y, debajo, cada filtro aplicado como un chip que se quita con su «×». En escritorio y
 * tablet el formulario se despliega debajo; en el móvil es una hoja que sube desde abajo.
 */
export function FiltrosAuditoria({
  pendientes,
  activos,
  tablas,
  onChange,
  onAplicar,
  onLimpiar,
  onQuitar,
  ocultarEnResumen = [],
}: Props) {
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [avanzados, setAvanzados] = useState(false);
  const desktopTrigger = useRef<HTMLButtonElement>(null);
  const resumen = filtrosVisibles(activos, ocultarEnResumen);
  const cantidad = resumen.length;
  const cambiar = (campo: keyof AuditLogFiltros, valor: string) =>
    onChange({ ...pendientes, [campo]: valor || undefined });
  const textoSinAplicar = (pendientes.texto ?? "") !== (activos.texto ?? "");
  // Borrador del formulario sin aplicar (la búsqueda tiene su propio aviso: el botón «Buscar» dentro del campo).
  const formularioSinAplicar = Object.keys({ ...pendientes, ...activos }).some(
    (campo) =>
      campo !== "texto" &&
      (pendientes[campo as keyof AuditLogFiltros] ?? "") !== (activos[campo as keyof AuditLogFiltros] ?? ""),
  );
  const hayAvanzados = CAMPOS_AVANZADOS.some((campo) =>
    campo === "origen" ? (pendientes.origen ?? "") !== "sin_servidor" : Boolean(pendientes[campo]),
  );

  const buscador = (
    <form
      role="search"
      className="relative min-w-0 flex-1 md:max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        onAplicar();
      }}
    >
      <Label htmlFor="auditoria-texto" className="sr-only">
        Buscar en auditoría
      </Label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input
        id="auditoria-texto"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        className={cn(
          "rounded-lg pl-9 [&::-webkit-search-cancel-button]:appearance-none",
          textoSinAplicar ? "pr-[4.75rem]" : activos.texto && onQuitar ? "pr-11" : "pr-3",
        )}
        placeholder={mobile ? "Buscar…" : "Buscar plato, vino, persona…"}
        value={pendientes.texto ?? ""}
        onChange={(e) => cambiar("texto", e.target.value)}
      />
      {textoSinAplicar ? (
        <Button type="submit" size="sm" className="absolute right-1 top-1/2 h-8 -translate-y-1/2 px-3 pointer-coarse:h-9">
          Buscar
        </Button>
      ) : (
        activos.texto &&
        onQuitar && (
          <button
            type="button"
            aria-label="Borrar la búsqueda"
            className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary pointer-coarse:h-9 pointer-coarse:w-9"
            onClick={() => onQuitar(["texto"])}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )
      )}
    </form>
  );

  const contador = cantidad > 0 && (
    <>
      {" "}
      <span className={cn(CLASE_CONTADOR, "bg-primary text-primary-foreground")} aria-hidden="true">
        {cantidad}
      </span>
      <span className="sr-only">({cantidad} aplicados)</span>
    </>
  );

  const chips = resumen.length > 0 && (
    <div aria-label="Filtros aplicados" role="group" className="flex min-w-0 flex-wrap items-center gap-1.5">
      {resumen.map(({ campo, texto }) => (
        <span
          key={campo}
          className={cn(
            "inline-flex min-h-7 max-w-full items-center gap-0.5 rounded-full border border-border bg-muted/50 text-xs text-foreground",
            onQuitar ? "py-0.5 pl-2.5 pr-0.5" : "px-2.5 py-1",
          )}
        >
          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{texto}</span>
          {onQuitar && (
            <button
              type="button"
              aria-label={`Quitar el filtro ${texto}`}
              className="relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground before:absolute before:-inset-2 before:content-[''] hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              onClick={() => onQuitar([campo])}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs text-muted-foreground pointer-coarse:h-9"
        onClick={() => (onQuitar ? onQuitar(resumen.map((r) => r.campo)) : onLimpiar())}
        aria-label="Limpiar filtros activos"
      >
        Limpiar
      </Button>
    </div>
  );

  const campos = (
    <>
      <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
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
          <Label htmlFor="auditoria-actor">Persona / proceso</Label>
          <Input
            id="auditoria-actor"
            className={INPUT_CLASS}
            placeholder="Correo o nombre del proceso"
            value={pendientes.actor ?? ""}
            onChange={(e) => cambiar("actor", e.target.value)}
          />
        </div>
        {/* Las dos fechas juntas, también en el móvil (cada una ocupa media fila). */}
        <div className="grid min-w-0 grid-cols-2 gap-3 xl:col-span-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="auditoria-desde">Desde</Label>
            <Input
              id="auditoria-desde"
              type="date"
              className={INPUT_FECHA}
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
              className={INPUT_FECHA}
              style={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
              value={pendientes.hasta ?? ""}
              onChange={(e) => cambiar("hasta", e.target.value)}
            />
          </div>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full justify-between px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground md:h-9 md:w-auto md:gap-2 pointer-coarse:h-11"
        aria-expanded={avanzados}
        aria-controls="auditoria-filtros-avanzados"
        onClick={() => setAvanzados((v) => !v)}
      >
        Más opciones (origen, resultado, dispositivo)
        <ChevronDown
          className={`h-4 w-4 transition-transform ${avanzados ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </Button>
      {avanzados && (
        <div
          id="auditoria-filtros-avanzados"
          className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-3"
        >
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
        </div>
      )}
    </>
  );

  const form = (
    <form
      className={mobile ? "flex min-h-0 flex-1 flex-col" : "space-y-3"}
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
            : "space-y-3"
        }
      >
        {campos}
      </div>
      <div
        className={
          mobile
            ? "grid shrink-0 grid-cols-2 gap-3 border-t bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
            : "flex justify-end gap-2 border-t border-border/60 pt-3"
        }
      >
        <Button
          type="button"
          variant="outline"
          className="h-11 md:h-10 pointer-coarse:h-11"
          onClick={onLimpiar}
        >
          Limpiar
        </Button>
        <Button type="submit" className="h-11 md:h-10 pointer-coarse:h-11">
          Aplicar filtros
        </Button>
      </div>
    </form>
  );

  if (!mobile)
    return (
      <div className="flex min-w-0 shrink-0 flex-col gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className={cn("h-10 shrink-0 gap-2 px-3 pointer-coarse:h-11", open && "bg-muted")}
            aria-label={open ? "Recoger filtros" : "Mostrar filtros"}
            aria-expanded={open}
            aria-controls="auditoria-filtros-escritorio"
            ref={desktopTrigger}
            onClick={() => {
              if (!open) setAvanzados((v) => v || hayAvanzados);
              setOpen((v) => !v);
            }}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filtros
            {contador}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
          {buscador}
          {formularioSinAplicar && !open && (
            <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">Cambios sin aplicar</span>
          )}
        </div>
        {chips}
        {open && (
          <div id="auditoria-filtros-escritorio" className="rounded-lg border border-border bg-card p-4 shadow-sm">
            {form}
          </div>
        )}
      </div>
    );
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        {buscador}
        <Button
          type="button"
          variant="outline"
          className="h-11 shrink-0 gap-2 px-3"
          onClick={() => {
            setAvanzados(hayAvanzados);
            setOpen(true);
          }}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Filtros
          {contador}
        </Button>
      </div>
      {chips}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-0 top-auto bottom-0 h-[88dvh] w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl p-0 overflow-hidden pointer-coarse:top-auto pointer-coarse:h-[min(88dvh,calc(var(--vv-h,100dvh)_-_1rem))] pointer-coarse:bottom-[max(0px,calc(100dvh_-_var(--vv-top,0px)_-_var(--vv-h,100dvh)))] pointer-coarse:max-h-none">
          <DialogHeader className="shrink-0 border-b px-4 py-4 pr-12 text-left">
            <DialogTitle>Filtrar auditoría</DialogTitle>
            <DialogDescription>
              Elige qué quieres ver y pulsa «Aplicar filtros».
            </DialogDescription>
          </DialogHeader>
          {form}
        </DialogContent>
      </Dialog>
    </div>
  );
}
