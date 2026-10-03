import { useEffect, useId, useState, type FormEvent } from "react";
import { ChevronRight, Loader2, RefreshCw, Save } from "lucide-react";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  fechaLocalISO,
  useProteccionBotWeb,
  type ChatWebConfig,
  type ChatWebConfigUpdate,
} from "@/hooks/useProteccionBotWeb";
import { SeccionBot } from "./SeccionBot";

// ---------------------------------------------------------------------------
// Límites editables. min/max son cotas de cordura para la UI; la función
// chat-web es quien los aplica de verdad.
// ---------------------------------------------------------------------------
type CampoNumerico =
  | "presupuesto_dia_usd"
  | "max_req_dia"
  | "max_req_ip_hora"
  | "max_req_sesion_hora"
  | "max_turnos"
  | "duracion_max_min"
  | "max_chars"
  | "max_output_tokens"
  | "alerta_pct";

interface DefCampo {
  clave: CampoNumerico;
  etiqueta: string;
  ayuda: string;
  min: number;
  max: number;
  step: number;
  decimal?: boolean;
  sufijo?: string;
}

const CAMPOS_NUMERICOS: DefCampo[] = [
  { clave: "presupuesto_dia_usd", etiqueta: "Presupuesto diario", ayuda: "Al alcanzarlo, el bot se pausa hasta mañana.", min: 0.1, max: 500, step: 0.5, decimal: true, sufijo: "$" },
  { clave: "alerta_pct", etiqueta: "Aviso al llegar a", ayuda: "Porcentaje del presupuesto que dispara el aviso.", min: 1, max: 100, step: 5, sufijo: "%" },
  { clave: "max_req_dia", etiqueta: "Peticiones al día", ayuda: "Total de mensajes que atiende en un día.", min: 1, max: 100000, step: 50 },
  { clave: "max_req_ip_hora", etiqueta: "Por IP y hora", ayuda: "Frena a un mismo visitante o bot externo.", min: 1, max: 1000, step: 1 },
  { clave: "max_req_sesion_hora", etiqueta: "Por sesión y hora", ayuda: "Mensajes por conversación abierta en una hora.", min: 1, max: 1000, step: 1 },
  { clave: "max_turnos", etiqueta: "Turnos por conversación", ayuda: "Mensajes del cliente antes de cerrar la charla.", min: 1, max: 200, step: 1 },
  { clave: "duracion_max_min", etiqueta: "Duración máxima", ayuda: "Minutos que puede durar una conversación.", min: 1, max: 1440, step: 5, sufijo: "min" },
  { clave: "max_chars", etiqueta: "Caracteres por mensaje", ayuda: "Mensajes más largos se rechazan.", min: 20, max: 5000, step: 50 },
  { clave: "max_output_tokens", etiqueta: "Tokens de respuesta", ayuda: "Longitud máxima de cada respuesta del bot.", min: 50, max: 8000, step: 50 },
];

type FormLimites = Record<CampoNumerico, string> & { telefono: string; url_reservas: string };

function configAForm(c: ChatWebConfig): FormLimites {
  const form = { telefono: c.telefono ?? "", url_reservas: c.url_reservas ?? "" } as FormLimites;
  for (const campo of CAMPOS_NUMERICOS) form[campo.clave] = String(c[campo.clave] ?? "");
  return form;
}

function formsIguales(a: FormLimites, b: FormLimites): boolean {
  return (Object.keys(a) as (keyof FormLimites)[]).every((k) => a[k].trim() === b[k].trim());
}

function validarForm(form: FormLimites): Partial<Record<keyof FormLimites, string>> {
  const errores: Partial<Record<keyof FormLimites, string>> = {};
  for (const campo of CAMPOS_NUMERICOS) {
    const texto = form[campo.clave].trim().replace(",", ".");
    const n = Number(texto);
    if (texto === "" || !Number.isFinite(n)) errores[campo.clave] = "Obligatorio";
    else if (!campo.decimal && !Number.isInteger(n)) errores[campo.clave] = "Sin decimales";
    else if (n < campo.min || n > campo.max) errores[campo.clave] = `Entre ${campo.min} y ${campo.max}`;
  }
  const digitos = form.telefono.replace(/\D/g, "");
  if (digitos.length < 9) errores.telefono = "Teléfono no válido (mín. 9 dígitos)";
  const url = form.url_reservas.trim();
  if (url) {
    try {
      const u = new URL(url);
      if (u.protocol !== "https:" && u.protocol !== "http:") errores.url_reservas = "Debe empezar por https://";
    } catch {
      errores.url_reservas = "URL no válida";
    }
  }
  return errores;
}

function formAUpdate(form: FormLimites): ChatWebConfigUpdate {
  const update: ChatWebConfigUpdate = {
    telefono: form.telefono.trim(),
    url_reservas: form.url_reservas.trim() || null,
  };
  for (const campo of CAMPOS_NUMERICOS) update[campo.clave] = Number(form[campo.clave].trim().replace(",", "."));
  return update;
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
const fmtUsd = new Intl.NumberFormat("es-ES", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtNum = new Intl.NumberFormat("es-ES");

function fmtDia(dia: string | null): string {
  if (!dia) return "—";
  const d = new Date(`${dia}T12:00:00`);
  return d.toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit" });
}

function Stat({ etiqueta, valor, className }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums leading-tight", className)}>{valor}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sección
// ---------------------------------------------------------------------------
export function SeccionProteccion() {
  const { config, uso, usoHoy, noDisponible, isLoading, isError, error, refetch, updateConfig } = useProteccionBotWeb();
  const switchId = useId();
  const [confirmarApagar, setConfirmarApagar] = useState(false);

  const descripcion = "Común a los tres idiomas: interruptor general, gasto del día y límites contra abusos.";

  if (isLoading) {
    return (
      <SeccionBot titulo="Protección y consumo" descripcion={descripcion}>
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label="Cargando protección del bot" />
        </div>
      </SeccionBot>
    );
  }

  if (noDisponible) {
    return (
      <SeccionBot titulo="Protección y consumo" descripcion={descripcion}>
        <p className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
          Pendiente de aplicar la migración (<span className="font-mono text-xs">20260926120000_chat_web_proteccion.sql</span>
          ). Cuando esté aplicada, aquí verás el consumo y los límites del bot.
        </p>
      </SeccionBot>
    );
  }

  if (isError || !config) {
    return (
      <SeccionBot titulo="Protección y consumo" descripcion={descripcion}>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-destructive">
            {isError
              ? `No se pudo cargar: ${error instanceof Error ? error.message : "error desconocido"}`
              : "No hay fila de configuración en chat_web_config."}
          </p>
          <Button size="sm" variant="outline" className="h-11" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </SeccionBot>
    );
  }

  const coste = Number(usoHoy?.coste_usd ?? 0);
  const presupuesto = Number(config.presupuesto_dia_usd ?? 0);
  const pct = presupuesto > 0 ? Math.min(100, (coste / presupuesto) * 100) : 0;
  const nivel = pct >= 100 ? "agotado" : pct >= config.alerta_pct ? "alerta" : "ok";
  const hoy = fechaLocalISO();
  const guardandoActivo = updateConfig.isPending && updateConfig.variables?.activo !== undefined;

  const cambiarActivo = (valor: boolean) => {
    if (!valor) setConfirmarApagar(true);
    else updateConfig.mutate({ activo: true });
  };

  return (
    <SeccionBot titulo="Protección y consumo" descripcion={descripcion}>
      {/* Interruptor general */}
      <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2.5">
        <div className="min-w-0 space-y-0.5">
          <Label htmlFor={switchId}>Bot activo</Label>
          <p className="text-xs text-muted-foreground">
            {config.activo
              ? "El chat de la web responde a los clientes."
              : "Apagado: la web muestra un aviso con el teléfono en lugar del chat."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {guardandoActivo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />}
          <Switch id={switchId} checked={config.activo} onCheckedChange={cambiarActivo} disabled={updateConfig.isPending} />
        </div>
      </div>

      <AlertDialog open={confirmarApagar} onOpenChange={setConfirmarApagar}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Apagar el bot de la web?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de responder en los tres idiomas hasta que lo vuelvas a activar. Los clientes verán el teléfono
              de contacto en su lugar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => updateConfig.mutate({ activo: false })}
            >
              Apagar bot
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Consumo de hoy */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Hoy</p>
        <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="col-span-2 space-y-1.5 rounded-md border px-3 py-2 lg:col-span-1">
            <dt className="text-xs text-muted-foreground">Coste / presupuesto</dt>
            <dd className="space-y-1.5">
              <span
                className={cn(
                  "block text-lg font-semibold tabular-nums leading-tight",
                  nivel === "alerta" && "text-amber-600 dark:text-amber-500",
                  nivel === "agotado" && "text-destructive",
                )}
              >
                {fmtUsd.format(coste)}
                <span className="text-sm font-normal text-muted-foreground"> / {fmtUsd.format(presupuesto)}</span>
              </span>
              <Progress
                value={pct}
                aria-label={`Presupuesto diario consumido: ${Math.round(pct)}%`}
                className={cn(
                  "h-1.5",
                  nivel === "alerta" && "[&>div]:bg-amber-500",
                  nivel === "agotado" && "[&>div]:bg-destructive",
                )}
              />
            </dd>
          </div>
          <Stat etiqueta="Peticiones" valor={fmtNum.format(Number(usoHoy?.peticiones ?? 0))} />
          <Stat etiqueta="Conversaciones" valor={fmtNum.format(Number(usoHoy?.conversaciones ?? 0))} />
          <Stat
            etiqueta="Rechazadas"
            valor={fmtNum.format(Number(usoHoy?.rechazadas ?? 0))}
            className={Number(usoHoy?.rechazadas ?? 0) > 0 ? "text-amber-600 dark:text-amber-500" : undefined}
          />
        </dl>
      </div>

      {/* Últimos 7 días */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Últimos 7 días</p>
        {uso.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin actividad registrada.</p>
        ) : (
          <div className="rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="h-8 px-3">Día</TableHead>
                  <TableHead className="h-8 px-3 text-right">Peticiones</TableHead>
                  <TableHead className="h-8 px-3 text-right">Conversaciones</TableHead>
                  <TableHead className="h-8 px-3 text-right">Rechazadas</TableHead>
                  <TableHead className="h-8 px-3 text-right">Coste</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {uso.map((u) => (
                  <TableRow key={u.dia ?? ""}>
                    <TableCell className="px-3 py-1.5 capitalize">{u.dia === hoy ? "Hoy" : fmtDia(u.dia)}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmtNum.format(Number(u.peticiones ?? 0))}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmtNum.format(Number(u.conversaciones ?? 0))}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmtNum.format(Number(u.rechazadas ?? 0))}</TableCell>
                    <TableCell className="px-3 py-1.5 text-right tabular-nums">{fmtUsd.format(Number(u.coste_usd ?? 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <FormularioLimites config={config} guardar={updateConfig.mutateAsync} />
    </SeccionBot>
  );
}

// ---------------------------------------------------------------------------
// Formulario de límites (plegado por defecto, con su propio Guardar)
// ---------------------------------------------------------------------------
interface FormularioLimitesProps {
  config: ChatWebConfig;
  guardar: (updates: ChatWebConfigUpdate) => Promise<unknown>;
}

function FormularioLimites({ config, guardar }: FormularioLimitesProps) {
  const baseId = useId();
  const [abierto, setAbierto] = useState(false);
  const [form, setForm] = useState<FormLimites>(() => configAForm(config));
  const [editado, setEditado] = useState(false);
  const [guardando, setGuardando] = useState(false);

  // Mientras no se haya tocado nada, el formulario sigue a la BD (p. ej. tras
  // el refresco periódico o un cambio hecho en otra pestaña).
  useEffect(() => {
    if (!editado) setForm(configAForm(config));
  }, [config, editado]);

  const original = configAForm(config);
  const errores = validarForm(form);
  const hayErrores = Object.keys(errores).length > 0;
  const dirty = !formsIguales(form, original);

  const set = (clave: keyof FormLimites, valor: string) => {
    setEditado(true);
    setForm((f) => ({ ...f, [clave]: valor }));
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (hayErrores || !dirty || guardando) return;
    setGuardando(true);
    try {
      await guardar(formAUpdate(form));
      setEditado(false);
    } catch {
      // El toast ya lo muestra el hook; se conserva lo escrito.
    } finally {
      setGuardando(false);
    }
  };

  const descartar = () => {
    setForm(original);
    setEditado(false);
  };

  const campoId = (clave: string) => `${baseId}-${clave}`;

  return (
    <Collapsible open={abierto} onOpenChange={setAbierto} className="rounded-md border">
      <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-2 rounded-md px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex items-center gap-1.5">
          <ChevronRight className={cn("h-4 w-4 transition-transform", abierto && "rotate-90")} aria-hidden="true" />
          Límites
        </span>
        {dirty && <span className="text-xs font-normal text-amber-600 dark:text-amber-500">Cambios sin guardar</span>}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form onSubmit={onSubmit} noValidate className="space-y-4 border-t px-3 pb-3 pt-3">
          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            {CAMPOS_NUMERICOS.map((c) => {
              const id = campoId(c.clave);
              const err = errores[c.clave];
              return (
                <div key={c.clave} className="space-y-1">
                  <Label htmlFor={id} className="text-xs">
                    {c.etiqueta}
                    {c.sufijo && <span className="text-muted-foreground"> ({c.sufijo})</span>}
                  </Label>
                  <Input
                    id={id}
                    type="number"
                    inputMode={c.decimal ? "decimal" : "numeric"}
                    min={c.min}
                    max={c.max}
                    step={c.decimal ? "0.01" : c.step}
                    value={form[c.clave]}
                    onChange={(e) => set(c.clave, e.target.value)}
                    aria-invalid={!!err}
                    aria-describedby={`${id}-ayuda`}
                    className={cn("h-11 tabular-nums", err && "border-destructive focus-visible:ring-destructive")}
                  />
                  <p id={`${id}-ayuda`} className={cn("text-xs", err ? "text-destructive" : "text-muted-foreground")}>
                    {err ?? c.ayuda}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={campoId("telefono")} className="text-xs">
                Teléfono de contacto
              </Label>
              <Input
                id={campoId("telefono")}
                type="tel"
                autoComplete="off"
                value={form.telefono}
                onChange={(e) => set("telefono", e.target.value)}
                aria-invalid={!!errores.telefono}
                aria-describedby={`${campoId("telefono")}-ayuda`}
                className={cn("h-11", errores.telefono && "border-destructive focus-visible:ring-destructive")}
              />
              <p
                id={`${campoId("telefono")}-ayuda`}
                className={cn("text-xs", errores.telefono ? "text-destructive" : "text-muted-foreground")}
              >
                {errores.telefono ?? "El bot lo da cuando está apagado, sin presupuesto o al limitar."}
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor={campoId("url")} className="text-xs">
                URL de reservas <span className="text-muted-foreground">(opcional)</span>
              </Label>
              <Input
                id={campoId("url")}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://…"
                value={form.url_reservas}
                onChange={(e) => set("url_reservas", e.target.value)}
                aria-invalid={!!errores.url_reservas}
                aria-describedby={`${campoId("url")}-ayuda`}
                className={cn("h-11", errores.url_reservas && "border-destructive focus-visible:ring-destructive")}
              />
              <p
                id={`${campoId("url")}-ayuda`}
                className={cn("text-xs", errores.url_reservas ? "text-destructive" : "text-muted-foreground")}
              >
                {errores.url_reservas ?? "Enlace que ofrece el bot para reservar."}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {dirty && (
              <Button type="button" variant="ghost" size="sm" className="h-11" onClick={descartar} disabled={guardando}>
                Descartar
              </Button>
            )}
            <Button type="submit" size="sm" className="h-11" disabled={!dirty || hayErrores || guardando}>
              {guardando ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />
              )}
              Guardar límites
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
