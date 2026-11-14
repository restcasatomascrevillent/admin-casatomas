import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useProbarLinear, type ConfigLogsWeb, type EquipoLinear, type ResultadoConexionLinear } from "@/hooks/useLogsWeb";

const NINGUNO = "__ninguno__";
const AUTOMATICO = "__automatico__";
const CERRADOS = new Set(["completed", "canceled", "duplicate"]);

type Campos = Pick<ConfigLogsWeb, "linear_modo" | "linear_equipo_id" | "linear_proyecto_id" | "linear_etiquetas" | "linear_estado_reabrir_id">;

/**
 * Al cambiar de equipo, lo que era del equipo anterior (proyecto, etiquetas de
 * equipo, estado al reabrir) deja de valer: se quita para no mandar ids ajenos.
 */
export function cambiosAlElegirEquipo(equipo: EquipoLinear | null, actual: Campos): Partial<Campos> {
  if (!equipo) return { linear_equipo_id: null, linear_proyecto_id: null, linear_etiquetas: [], linear_estado_reabrir_id: null };
  const proyectos = new Set(equipo.proyectos.map((p) => p.id));
  const etiquetas = new Set(equipo.etiquetas.map((e) => e.id));
  const estados = new Set(equipo.estados.map((e) => e.id));
  return {
    linear_equipo_id: equipo.id,
    linear_proyecto_id: actual.linear_proyecto_id && proyectos.has(actual.linear_proyecto_id) ? actual.linear_proyecto_id : null,
    linear_etiquetas: actual.linear_etiquetas.filter((id) => etiquetas.has(id)),
    linear_estado_reabrir_id: actual.linear_estado_reabrir_id && estados.has(actual.linear_estado_reabrir_id) ? actual.linear_estado_reabrir_id : null,
  };
}

/** Aviso de lo que falta para que los tickets lleguen a Linear de verdad (null = nada). */
export function avisoConfigLinear(c: Campos, conexion: ResultadoConexionLinear | null): string | null {
  if (c.linear_modo !== "real") return null;
  if (conexion && !conexion.ok) return "Con «Linear» elegido, los tickets no se crearán hasta que la conexión funcione (mira el mensaje de arriba).";
  if (!c.linear_equipo_id) return "Con «Linear» elegido falta el equipo: pulsa «Probar conexión con Linear» y elígelo. Hasta entonces no se crea ningún ticket.";
  return null;
}

function Pasos() {
  return (
    <details className="rounded-md border bg-muted/30 p-3 text-sm" data-testid="pasos-linear">
      <summary className="cursor-pointer select-none font-medium">Cómo conectar Linear (una vez)</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>En Linear: <strong>Settings › Security &amp; access › Personal API keys › New API key</strong>. Ponle un nombre (por ejemplo «Casa Tomás · Logs») y copia la clave (empieza por <code>lin_api_</code>).</li>
        <li>En Supabase: <strong>Edge Functions › Secrets › Add new secret</strong>, con el nombre <code>LINEAR_API_KEY</code> y la clave como valor. Primero en la demo; en producción, cuando se publique.</li>
        <li>Aquí: pulsa <strong>«Probar conexión con Linear»</strong> y elige el equipo (y, si quieres, el proyecto y las etiquetas).</li>
        <li>Cambia <strong>«Destino de los tickets»</strong> a «Linear» y pulsa <strong>«Guardar configuración»</strong>.</li>
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">La clave se queda en el servidor: el panel nunca la ve ni la guarda. Para dejar de mandar tickets, elige «Destino de pruebas» o «Desactivado».</p>
    </details>
  );
}

function ResultadoConexion({ r }: { r: ResultadoConexionLinear }) {
  if (r.ok) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-50 p-2 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100" role="status" data-testid="conexion-linear" data-estado={r.estado}>
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{r.mensaje}{r.usuario ? ` La clave es de ${r.usuario}.` : ""}</span>
      </p>
    );
  }
  const texto = r.estado === "sin_clave"
    ? "Falta la clave de Linear: sigue los pasos de «Cómo conectar Linear», justo encima."
    : r.mensaje;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-50 p-2 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100" role="alert" data-testid="conexion-linear" data-estado={r.estado}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p>{texto}</p>
        {r.estado === "sin_clave" && <p className="text-xs opacity-80">{r.mensaje}</p>}
      </div>
    </div>
  );
}

/** Linear «para tontos»: probar la clave del servidor y elegir equipo, proyecto, etiquetas y estado en desplegables. */
export function ConexionLinear({ valores, onCambio }: { valores: Campos; onCambio: (c: Partial<Campos>) => void }) {
  const probar = useProbarLinear();
  const [errorLlamada, setErrorLlamada] = useState<string | null>(null);
  const r = probar.data ?? null;
  const equipos = r?.ok ? r.equipos : [];
  const equipo = equipos.find((e) => e.id === valores.linear_equipo_id) ?? null;
  const equipoDesconocido = r?.ok && valores.linear_equipo_id && !equipo;
  const aviso = avisoConfigLinear(valores, r);
  const estadosReabrir = equipo?.estados.filter((e) => !CERRADOS.has(e.tipo)) ?? [];

  const onProbar = () => {
    setErrorLlamada(null);
    probar.mutate(undefined, {
      onSuccess: (res) => {
        // Con un solo equipo, se elige solo.
        if (res.ok && res.equipos.length === 1 && !valores.linear_equipo_id) onCambio(cambiosAlElegirEquipo(res.equipos[0], valores));
      },
      onError: (e) => setErrorLlamada(e.message),
    });
  };

  return (
    <div className="space-y-3" data-testid="seccion-linear">
      <p className="text-sm text-muted-foreground">
        Los errores que afectan a clientes o que se repiten se convierten en tickets. Con «Destino de pruebas» solo se guardan aquí (sin tocar Linear); con «Linear» se crean de verdad, como mucho los que digas al día.
      </p>
      <Pasos />
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" className="h-11 gap-2" onClick={onProbar} disabled={probar.isPending} data-testid="probar-linear">
          {probar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Probar conexión con Linear
        </Button>
        {!r && !errorLlamada && valores.linear_equipo_id && (
          <span className="text-xs text-muted-foreground">Equipo guardado: <code>{valores.linear_equipo_id}</code>. Pruébala para ver los nombres.</span>
        )}
      </div>
      {errorLlamada && <p className="text-sm text-destructive" role="alert">{errorLlamada}</p>}
      {r && <ResultadoConexion r={r} />}

      <div className="flex flex-wrap gap-6">
        <div className="space-y-1">
          <Label className="text-xs">Destino de los tickets</Label>
          <Select value={valores.linear_modo} onValueChange={(v) => onCambio({ linear_modo: v as Campos["linear_modo"] })}>
            <SelectTrigger className="h-11 w-full sm:w-72" aria-label="Destino de los tickets"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="prueba">Destino de pruebas (no toca Linear)</SelectItem>
              <SelectItem value="real">Linear (de verdad)</SelectItem>
              <SelectItem value="desactivado">Desactivado (no se crean tickets)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {r?.ok && equipos.length > 0 && (
          <>
            <div className="space-y-1">
              <Label className="text-xs">Equipo</Label>
              <Select value={equipo?.id ?? NINGUNO} onValueChange={(v) => onCambio(cambiosAlElegirEquipo(equipos.find((e) => e.id === v) ?? null, valores))}>
                <SelectTrigger className="h-11 w-full sm:w-72" aria-label="Equipo de Linear"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NINGUNO}>Elige un equipo…</SelectItem>
                  {equipos.map((e) => <SelectItem key={e.id} value={e.id}>{e.nombre}{e.clave ? ` (${e.clave})` : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {equipo && (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Proyecto (opcional)</Label>
                  <Select value={valores.linear_proyecto_id ?? NINGUNO} onValueChange={(v) => onCambio({ linear_proyecto_id: v === NINGUNO ? null : v })}>
                    <SelectTrigger className="h-11 w-full sm:w-72" aria-label="Proyecto de Linear"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NINGUNO}>Sin proyecto</SelectItem>
                      {equipo.proyectos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Si un error resuelto vuelve, el ticket pasa a</Label>
                  <Select value={valores.linear_estado_reabrir_id ?? AUTOMATICO} onValueChange={(v) => onCambio({ linear_estado_reabrir_id: v === AUTOMATICO ? null : v })}>
                    <SelectTrigger className="h-11 w-full sm:w-72" aria-label="Estado al reabrir"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUTOMATICO}>Automático{equipo.estadoReabrirPorDefecto ? ` («${equipo.estadoReabrirPorDefecto.nombre}»)` : ""}</SelectItem>
                      {estadosReabrir.map((s) => <SelectItem key={s.id} value={s.id}>{s.nombre}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </>
        )}
      </div>

      {equipo && equipo.etiquetas.length > 0 && (
        <fieldset className="space-y-1">
          <legend className="text-xs font-medium">Etiquetas para los tickets (opcional)</legend>
          <div className="flex flex-wrap gap-x-4">
            {equipo.etiquetas.map((e) => (
              <label key={e.id} className="flex min-h-9 items-center gap-2 text-sm">
                <Checkbox
                  checked={valores.linear_etiquetas.includes(e.id)}
                  disabled={!valores.linear_etiquetas.includes(e.id) && valores.linear_etiquetas.length >= 10}
                  onCheckedChange={(v) => onCambio({ linear_etiquetas: v === true ? [...valores.linear_etiquetas, e.id] : valores.linear_etiquetas.filter((x) => x !== e.id) })}
                />
                {e.nombre}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {equipoDesconocido && <p className="text-sm text-amber-700 dark:text-amber-300">El equipo guardado ya no aparece en Linear (o la clave no lo ve): elige otro.</p>}
      {aviso && <p className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-300" data-testid="aviso-linear"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{aviso}</p>}

      <details className="text-sm">
        <summary className="cursor-pointer select-none text-xs text-muted-foreground">Avanzado: escribir los ids a mano</summary>
        <div className="mt-2 flex flex-wrap gap-4">
          <div className="space-y-1">
            <Label htmlFor="l-eq" className="text-xs">Equipo (id)</Label>
            <Input id="l-eq" className="h-11 w-full sm:w-72" value={valores.linear_equipo_id ?? ""} onChange={(e) => onCambio({ linear_equipo_id: e.target.value.trim() || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="l-pr" className="text-xs">Proyecto (id, opcional)</Label>
            <Input id="l-pr" className="h-11 w-full sm:w-72" value={valores.linear_proyecto_id ?? ""} onChange={(e) => onCambio({ linear_proyecto_id: e.target.value.trim() || null })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="l-et" className="text-xs">Etiquetas (ids, separadas por comas)</Label>
            <Input id="l-et" className="h-11 w-full sm:w-72" value={valores.linear_etiquetas.join(", ")} onChange={(e) => onCambio({ linear_etiquetas: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="l-re" className="text-xs">Estado al reabrir (id, opcional)</Label>
            <Input id="l-re" className="h-11 w-full sm:w-72" value={valores.linear_estado_reabrir_id ?? ""} onChange={(e) => onCambio({ linear_estado_reabrir_id: e.target.value.trim() || null })} />
          </div>
        </div>
      </details>
    </div>
  );
}
