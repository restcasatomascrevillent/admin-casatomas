import { useEffect, useState, type ReactNode } from "react";
import { Loader2, Play, Save } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import {
  useCatalogoEventos,
  useConfigLogs,
  useGuardarConfigLogs,
  useProcesarAhora,
  type CambiosConfigLogs,
  type ConfigLogsWeb,
  type Entorno,
  type EstadoRecogidaDatos,
} from "@/hooks/useLogsWeb";
import { fmtFechaHora, NOMBRE_CATEGORIA, NOMBRE_TIPO } from "./calculos";
import { Interruptor } from "./Controles";
import { ConexionLinear } from "./ConexionLinear";

const ENTORNOS: Entorno[] = ["produccion", "demo", "local"];
const NOMBRE_ENTORNO: Record<Entorno, string> = { produccion: "Producción", demo: "Demo", local: "Local" };

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <Card variante="plana">
      <CardHeader className="px-0 pb-2"><CardTitle className="text-sm font-medium">{titulo}</CardTitle></CardHeader>
      <CardContent className="space-y-3 px-0">{children}</CardContent>
    </Card>
  );
}

function Numero({ id, etiqueta, valor, onCambio, min, max, ayuda }: { id: string; etiqueta: string; valor: number; onCambio: (n: number) => void; min: number; max: number; ayuda?: string }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">{etiqueta}</Label>
      <Input id={id} type="number" inputMode="numeric" className="h-11 w-36" min={min} max={max} value={valor}
        onChange={(e) => onCambio(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
      {ayuda && <p className="text-[11px] text-muted-foreground">{ayuda}</p>}
    </div>
  );
}

const lineas = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

/** Configuración de Logs + cobertura (qué se observa y desde cuándo) + estado del proceso. */
export function PestanaConfiguracion({ estado }: { estado: EstadoRecogidaDatos | undefined }) {
  const cfg = useConfigLogs();
  const catalogo = useCatalogoEventos();
  const guardar = useGuardarConfigLogs();
  const procesar = useProcesarAhora();
  const [borrador, setBorrador] = useState<ConfigLogsWeb | null>(null);
  useEffect(() => {
    if (cfg.data) setBorrador(cfg.data);
  }, [cfg.data]);

  if (cfg.isError) return <EstadoErrorCarga titulo="la configuración de Logs" error={cfg.error} onReintentar={() => cfg.refetch()} />;
  if (!borrador) return <Loader2 className="mt-6 h-5 w-5 animate-spin" />;
  const b = borrador;
  const set = <K extends keyof ConfigLogsWeb>(k: K, v: ConfigLogsWeb[K]) => setBorrador({ ...b, [k]: v });
  const conmutar = (k: "entornos_aceptados" | "entornos_ticket", e: Entorno, si: boolean) =>
    set(k, si ? [...new Set([...b[k], e])] : b[k].filter((x) => x !== e));

  const onGuardar = () => {
    const { entorno_bd: _e, actualizado_en: _a, ...cambios } = b;
    guardar.mutate(cambios as CambiosConfigLogs, {
      onSuccess: () => toast.success("Configuración guardada"),
      onError: (e) => toast.error(`No se pudo guardar: ${e.message}`),
    });
  };
  const p = estado?.proceso;

  return (
    <div className="space-y-6 pt-3" data-testid="pestana-configuracion">
      <Seccion titulo="Proceso en segundo plano (cada 5 minutos)">
        <p className="text-sm">
          Última pasada correcta: <strong>{fmtFechaHora(p?.ultimo_proceso_ok)}</strong> · última: {fmtFechaHora(p?.ultimo_proceso_fin)} · purga: {fmtFechaHora(p?.ultima_purga)}
        </p>
        {p?.ultimo_error && <p className="text-xs text-destructive">Avisos: {p.ultimo_error}</p>}
        {p?.ultimo_resumen && Object.keys(p.ultimo_resumen).length > 0 && (
          <pre className="max-h-40 overflow-auto rounded bg-muted/60 p-2 text-[11px]">{JSON.stringify(p.ultimo_resumen, null, 1)}</pre>
        )}
        <Button variant="outline" className="h-11 gap-2" disabled={procesar.isPending}
          onClick={() => procesar.mutate(undefined, {
            onSuccess: (r) => toast.success(r?.ocupado ? "Ya había un proceso en marcha" : "Procesado: agrupación y tickets al día"),
            onError: (e) => toast.error(e.message),
          })}>
          {procesar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Procesar ahora
        </Button>
      </Seccion>

      <Seccion titulo="Cobertura: qué se observa y desde cuándo">
        <p className="text-xs text-muted-foreground">
          No hay históricos anteriores al primer evento de cada tipo. La actividad solo se recoge de visitantes que aceptan «Estadísticas» (y no con Global Privacy Control);
          los errores, de todos. No se graban pantallas ni pulsaciones: solo eventos estructurados. Touza y el panel no envían actividad.
        </p>
        <div className="overflow-x-auto">
          <Table data-testid="tabla-cobertura">
            <TableHeader>
              <TableRow><TableHead>Evento</TableHead><TableHead>Categoría</TableHead><TableHead>Fuente</TableHead><TableHead>Consentimiento</TableHead><TableHead>Datos desde</TableHead><TableHead className="hidden lg:table-cell">Qué significa</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {(catalogo.data ?? []).map((c) => {
                const desde = estado?.primer_evento_por_tipo?.[c.tipo];
                return (
                  <TableRow key={c.tipo}>
                    <TableCell className="text-sm">{NOMBRE_TIPO[c.tipo] ?? c.tipo}<span className="block text-[11px] text-muted-foreground">{c.tipo}</span></TableCell>
                    <TableCell className="text-xs">{NOMBRE_CATEGORIA[c.categoria]}</TableCell>
                    <TableCell className="text-xs">{c.fuente.replace("_", " ")}</TableCell>
                    <TableCell className="text-xs">{c.requiere_consentimiento ? "Sí" : "No (técnico)"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{desde ? fmtFechaHora(desde) : <Badge variant="outline">sin datos aún</Badge>}</TableCell>
                    <TableCell className="hidden max-w-md text-xs text-muted-foreground lg:table-cell">{c.descripcion}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Seccion>

      <Seccion titulo="Ingesta de los últimos días">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Día</TableHead><TableHead className="text-right">Aceptados</TableHead><TableHead className="text-right">Duplicados</TableHead><TableHead className="text-right">Descartados</TableHead><TableHead className="text-right">Rechazados</TableHead><TableHead className="text-right">Bots</TableHead></TableRow></TableHeader>
            <TableBody>
              {(estado?.ingesta ?? []).map((d) => (
                <TableRow key={d.dia}>
                  <TableCell>{d.dia}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.aceptados}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.duplicados}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.descartados}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.rechazados}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.bots}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground">Duplicados = reenvíos del navegador que no se guardan dos veces. Descartados = límites, rutas excluidas o sin consentimiento. Rechazados = no válidos u origen no aceptado.</p>
      </Seccion>

      <Seccion titulo="Fuentes y entornos">
        <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
          <Interruptor id="c-act" etiqueta="Actividad del navegador" valor={b.recoger_actividad} onCambio={(v) => set("recoger_actividad", v)} />
          <Interruptor id="c-errn" etiqueta="Errores del navegador" valor={b.recoger_errores_navegador} onCambio={(v) => set("recoger_errores_navegador", v)} />
          <Interruptor id="c-pet" etiqueta="Peticiones técnicas" valor={b.recoger_peticiones} onCambio={(v) => set("recoger_peticiones", v)} />
          <Interruptor id="c-srv" etiqueta="Errores de las funciones" valor={b.recoger_errores_servidor} onCambio={(v) => set("recoger_errores_servidor", v)} />
          <Interruptor id="c-int" etiqueta="Integraciones y cron" valor={b.recoger_integraciones} onCambio={(v) => set("recoger_integraciones", v)} />
          <Interruptor id="c-host" etiqueta="Despliegues (Vercel)" valor={b.recoger_hosting} onCambio={(v) => set("recoger_hosting", v)} />
        </div>
        <div className="flex flex-wrap gap-8 text-sm">
          {(["entornos_aceptados", "entornos_ticket"] as const).map((k) => (
            <fieldset key={k} className="space-y-1">
              <legend className="text-xs font-medium">{k === "entornos_aceptados" ? "Se aceptan eventos de" : "Pueden abrir tickets"}</legend>
              {ENTORNOS.map((e) => (
                <label key={e} className="flex min-h-9 items-center gap-2">
                  <Checkbox checked={b[k].includes(e)} onCheckedChange={(v) => conmutar(k, e, v === true)} /> {NOMBRE_ENTORNO[e]}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Esta base de datos es de <strong>{NOMBRE_ENTORNO[b.entorno_bd]}</strong>.</p>
      </Seccion>

      <Seccion titulo="Exclusiones">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="c-rutas" className="text-xs">Rutas excluidas (una por línea, por prefijo)</Label>
            <Textarea id="c-rutas" rows={4} value={b.rutas_excluidas.join("\n")} onChange={(e) => set("rutas_excluidas", lineas(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="c-msg" className="text-xs">Mensajes de error ignorados (contiene)</Label>
            <Textarea id="c-msg" rows={4} value={b.mensajes_ignorados.join("\n")} onChange={(e) => set("mensajes_ignorados", lineas(e.target.value))} />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">El tráfico interno se marca visitando la web con <code>?ct_interno=1</code> (y se desmarca con <code>?ct_interno=0</code>). Bots y pruebas automáticas se marcan solos.</p>
      </Seccion>

      <Seccion titulo="Umbrales de ticket">
        <div className="flex flex-wrap gap-6">
          <Numero id="u-oc" etiqueta="Ocurrencias" valor={b.umbral_ocurrencias} min={1} max={100000} onCambio={(n) => set("umbral_ocurrencias", n)} />
          <Numero id="u-ses" etiqueta="Sesiones distintas" valor={b.umbral_sesiones} min={1} max={100000} onCambio={(n) => set("umbral_sesiones", n)} ayuda="No aplica a errores del servidor" />
          <Numero id="u-vent" etiqueta="En las últimas (horas)" valor={b.umbral_ventana_horas} min={1} max={720} onCambio={(n) => set("umbral_ventana_horas", n)} />
          <Numero id="u-404" etiqueta="404 en 24 h" valor={b.umbral_404_diario} min={1} max={100000} onCambio={(n) => set("umbral_404_diario", n)} />
        </div>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Interruptor id="u-404s" etiqueta="Los 404 pueden abrir ticket (si superan su umbral)" valor={b.tickets_404} onCambio={(v) => set("tickets_404", v)} />
          <Interruptor id="u-prueba" etiqueta="No contar pruebas automáticas ni tráfico interno para los umbrales" valor={b.excluir_pruebas_tickets} onCambio={(v) => set("excluir_pruebas_tickets", v)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Si reaparece una incidencia resuelta</Label>
          <Select value={b.reapertura} onValueChange={(v) => set("reapertura", v as ConfigLogsWeb["reapertura"])}>
            <SelectTrigger className="h-11 w-full sm:w-96"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="reabrir">Reabrirla y avisar en el mismo ticket</SelectItem>
              <SelectItem value="nuevo_ticket">Reabrirla y crear un ticket nuevo enlazado</SelectItem>
              <SelectItem value="ignorar">Dejarla resuelta (solo contar)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">Los errores críticos (p. ej. la petición de reserva que falla) abren ticket con la primera ocurrencia. Los de «página antigua tras publicar» no cuentan, salvo que vuelvan a fallar después de recargar.</p>
      </Seccion>

      <Seccion titulo="Linear">
        <ConexionLinear valores={b} onCambio={(c) => setBorrador({ ...b, ...c })} />
        <Numero id="l-max" etiqueta="Tickets nuevos por día (máx.)" valor={b.linear_max_tickets_dia} min={0} max={500} onCambio={(n) => set("linear_max_tickets_dia", n)}
          ayuda="Primero los más graves y con más visitantes afectados; el resto espera al día siguiente." />
      </Seccion>

      <Seccion titulo="IA, retención y límites de coste">
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Interruptor id="ia-on" etiqueta="IA en las incidencias (análisis para el ticket y explicación en sencillo)" valor={b.ia_activada} onCambio={(v) => set("ia_activada", v)} />
        </div>
        <div className="flex flex-wrap gap-6">
          <Numero id="ia-max" etiqueta="Llamadas de IA por día" valor={b.ia_max_analisis_dia} min={0} max={500} onCambio={(n) => set("ia_max_analisis_dia", n)}
            ayuda="Análisis de tickets + explicaciones en sencillo (estas, como mucho la mitad). Cada incidencia se explica una sola vez." />
          <Numero id="r-act" etiqueta="Retención de actividad (días)" valor={b.retencion_actividad_dias} min={7} max={400} onCambio={(n) => set("retencion_actividad_dias", n)} />
          <Numero id="r-err" etiqueta="Retención de errores (días)" valor={b.retencion_errores_dias} min={7} max={730} onCambio={(n) => set("retencion_errores_dias", n)} />
          <Numero id="l-dia" etiqueta="Eventos por día (máx.)" valor={b.limite_eventos_dia} min={100} max={2000000} onCambio={(n) => set("limite_eventos_dia", n)} />
          <Numero id="l-ses" etiqueta="Eventos por sesión (máx.)" valor={b.limite_eventos_sesion} min={20} max={5000} onCambio={(n) => set("limite_eventos_sesion", n)} />
          <Numero id="l-ip" etiqueta="Eventos por IP y minuto" valor={b.limite_eventos_ip_minuto} min={10} max={10000} onCambio={(n) => set("limite_eventos_ip_minuto", n)} />
        </div>
      </Seccion>

      <div className="sticky bottom-0 flex justify-end border-t bg-background py-3">
        <Button className="h-11 gap-2" onClick={onGuardar} disabled={guardar.isPending}>
          {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar configuración
        </Button>
      </div>
    </div>
  );
}
