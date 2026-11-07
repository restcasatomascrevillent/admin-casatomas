import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, History, ListChecks, Loader2, Play, RefreshCw, Save, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  type ResultadoPrueba,
  useCentroModelos,
  useGuardarModeloFuncion,
  useProbarModelo,
  useSincronizarModelos,
} from "@/hooks/useModelosIa";
import { haceCuanto } from "@/lib/servicios";
import {
  type FuncionModelo,
  type ModeloDisponible,
  avisosFuncion,
  formatoPrecio,
  formatoUsd,
  modeloActual,
  modelosSeleccionables,
  motivoNoElegible,
} from "@/lib/modelosIa";
import { Bloque } from "./Bloque";

/** Valor del selector para «sin modelo en la tabla» (Radix no admite ""). */
const DEL_CODIGO = "__codigo__";

const fecha = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" }) : "—";

function LineaPrueba({ r }: { r: ResultadoPrueba }) {
  return r.ok ? (
    <p role="status" className="flex items-start gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        {r.modelo} responde en {(r.latencia_ms ?? 0).toLocaleString("es-ES")} ms: «{r.respuesta}»
      </span>
    </p>
  ) : (
    <p role="alert" className="flex items-start gap-1.5 text-sm text-destructive">
      <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{r.modelo}: {r.error}</span>
    </p>
  );
}

/** Opción del selector; deshabilitada con el motivo si la función usa herramientas y el modelo no las admite. */
function OpcionModelo({ f, o }: { f: FuncionModelo; o: ModeloDisponible }) {
  const motivo = motivoNoElegible(f, o);
  return (
    <SelectItem value={o.id} disabled={motivo != null} title={motivo ?? undefined}>
      {o.id} · {motivo ? "no admite herramientas (ver «Probar»)" : formatoPrecio(o)}
    </SelectItem>
  );
}

function FilaFuncion({ f, opciones, disponibles }: { f: FuncionModelo; opciones: ModeloDisponible[]; disponibles: ModeloDisponible[] }) {
  const guardar = useGuardarModeloFuncion();
  const probar = useProbarModelo();
  const [modelo, setModelo] = useState(f.modelo ?? DEL_CODIGO);
  const [respaldo, setRespaldo] = useState(f.modelo_respaldo ?? DEL_CODIGO);
  const [notas, setNotas] = useState(f.notas ?? "");
  const [prueba, setPrueba] = useState<ResultadoPrueba | null>(null);
  useEffect(() => {
    setModelo(f.modelo ?? DEL_CODIGO);
    setRespaldo(f.modelo_respaldo ?? DEL_CODIGO);
    setNotas(f.notas ?? "");
  }, [f.modelo, f.modelo_respaldo, f.notas]);

  const actual = modeloActual(f);
  const avisos = avisosFuncion(f, disponibles);
  const elegido = modelo === DEL_CODIGO ? null : modelo;
  const elegidoRespaldo = respaldo === DEL_CODIGO ? null : respaldo;
  const cambiado = elegido !== f.modelo || elegidoRespaldo !== f.modelo_respaldo || (notas.trim() || null) !== (f.notas ?? null);
  // El que se probaría: el del selector, o el que usa hoy.
  const aProbar = elegido ?? (actual.modelo !== "—" ? actual.modelo : null);
  // Lo que ya tiene puesto sigue en la lista aunque haya perdido el precio.
  const conActual = (valor: string | null) =>
    valor && !opciones.some((o) => o.id === valor) ? [{ id: valor, usd_por_m_input: null, usd_por_m_output: null } as ModeloDisponible, ...opciones] : opciones;

  const onGuardar = async () => {
    try {
      await guardar.mutateAsync({ funcion: f.funcion, modelo: elegido, modelo_respaldo: elegidoRespaldo, notas: notas.trim() || null });
      toast.success(`${f.funcion}: ${elegido ? `ahora usa ${elegido}` : "vuelve al modelo del código"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    }
  };
  const onProbar = async () => {
    if (!aProbar) return;
    setPrueba(await probar.mutateAsync({ modelo: aProbar, funcion: f.funcion }));
  };

  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border p-3" data-testid={`modelo-funcion-${f.funcion}`}>
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-mono text-sm font-semibold">{f.funcion}</h3>
        <p className="text-sm text-muted-foreground">
          {formatoUsd(f.coste_usd)} · {(f.llamadas ?? 0).toLocaleString("es-ES")} llamadas en 30 días
          {f.coste_sin_tarifa ? " (parte sin tarifa)" : ""}
        </p>
      </div>
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">Modelo actual:</span>
        <span className="font-mono">{actual.modelo}</span>
        <Badge variant={actual.desdeTabla ? "default" : "secondary"}>{actual.desdeTabla ? "elegido aquí" : "del código"}</Badge>
        {f.modelo_respaldo && <span className="text-muted-foreground">· respaldo <span className="font-mono">{f.modelo_respaldo}</span></span>}
      </p>
      {f.modelo_codigo && <p className="text-xs text-muted-foreground">Sin elegir: {f.modelo_codigo}</p>}
      {f.cambiado_en && f.modelo && (
        <p className="text-xs text-muted-foreground">Cambiado {haceCuanto(f.cambiado_en)} por {f.cambiado_por_email ?? "—"}</p>
      )}
      {avisos.map((a) => (
        <p key={a} role="alert" className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> {a}
        </p>
      ))}

      {f.centralizado ? (
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`modelo-${f.funcion}`}>Modelo</Label>
            <Select value={modelo} onValueChange={setModelo}>
              <SelectTrigger id={`modelo-${f.funcion}`} className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEL_CODIGO}>El del código</SelectItem>
                {conActual(f.modelo).map((o) => (
                  <OpcionModelo key={o.id} f={f} o={o} />
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor={`respaldo-${f.funcion}`}>Respaldo (si OpenAI rechaza el modelo)</Label>
            <Select value={respaldo} onValueChange={setRespaldo}>
              <SelectTrigger id={`respaldo-${f.funcion}`} className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={DEL_CODIGO}>Sin respaldo</SelectItem>
                {conActual(f.modelo_respaldo).map((o) => (
                  <OpcionModelo key={o.id} f={f} o={o} />
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 space-y-1 sm:col-span-2">
            <Label htmlFor={`notas-${f.funcion}`}>Notas</Label>
            <Input id={`notas-${f.funcion}`} className="h-11" value={notas} maxLength={2000} onChange={(e) => setNotas(e.target.value)} placeholder="Por qué se cambió…" />
          </div>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button type="button" className="h-11 gap-2" disabled={!cambiado || guardar.isPending} onClick={() => void onGuardar()}>
              {guardar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
              Guardar
            </Button>
            <Button type="button" variant="outline" className="h-11 gap-2" disabled={!aProbar || probar.isPending} onClick={() => void onProbar()}
              title={aProbar ? `Una llamada mínima a ${aProbar}` : undefined}>
              {probar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
              Probar{aProbar ? ` ${aProbar}` : ""}
            </Button>
          </div>
          {prueba && <div className="sm:col-span-2"><LineaPrueba r={prueba} /></div>}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Esta función aún tiene el modelo fijo en el código: no se puede cambiar desde aquí.</p>
      )}
    </li>
  );
}

/**
 * Super Admin › Servicios › Modelos: qué modelo de OpenAI usa cada función,
 * cambiarlo y probarlo, la lista de modelos de la cuenta (con los nuevos
 * marcados) y el historial de cambios. Los avisos de modelos nuevos o
 * retirados llegan a la campana (cron diario de ia-modelos-openai).
 */
export function PestanaModelos() {
  const q = useCentroModelos();
  const sincronizar = useSincronizarModelos();
  const [soloInteres, setSoloInteres] = useState(true);
  const centro = q.data?.disponible ? q.data.centro : null;
  const opciones = useMemo(() => modelosSeleccionables(centro?.disponibles ?? []), [centro]);
  const lista = useMemo(
    () => (centro?.disponibles ?? []).filter((d) => !soloInteres || d.de_interes),
    [centro, soloInteres],
  );
  const nuevos = (centro?.disponibles ?? []).filter((d) => d.nuevo && d.de_interes).length;

  const onSincronizar = async () => {
    try {
      const r = await sincronizar.mutateAsync();
      const n = r.nuevos?.length ?? 0;
      toast.success(r.primera_carga ? `Lista cargada: ${r.total ?? 0} modelos` : `Lista actualizada: ${r.total ?? 0} modelos, ${n} ${n === 1 ? "nuevo" : "nuevos"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo actualizar la lista");
    }
  };

  if (q.isLoading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Cargando los modelos…
      </p>
    );
  }
  if (q.isError) {
    return (
      <div role="alert" className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
        <p>No se pudieron cargar los modelos: {q.error instanceof Error ? q.error.message : "error desconocido"}.</p>
        <Button type="button" variant="outline" className="h-11" onClick={() => void q.refetch()}>Reintentar</Button>
      </div>
    );
  }
  if (!centro) {
    return (
      <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        Falta aplicar en Supabase la migración 20261107500000_ia_modelos_centro. Cuando esté, aquí saldrán los modelos.
      </p>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3 pb-4">
      <Bloque
        id="modelos-por-funcion"
        titulo="Modelo por función"
        icono={<Bot />}
        descripcion="Lo que se elige aquí manda sobre los secretos; «El del código» deja la función como estaba. Las funciones lo leen cada minuto."
      >
        <ul className="flex min-w-0 flex-col gap-2">
          {centro.funciones.map((f) => (
            <FilaFuncion key={f.funcion} f={f} opciones={opciones} disponibles={centro.disponibles} />
          ))}
        </ul>
      </Bloque>

      <Bloque
        id="modelos-disponibles"
        titulo={<>Modelos de la cuenta de OpenAI{nuevos > 0 && <Badge className="ml-2">{nuevos} {nuevos === 1 ? "nuevo" : "nuevos"}</Badge>}</>}
        icono={<ListChecks />}
        descripcion={centro.ultima_lista ? `Última lectura ${haceCuanto(centro.ultima_lista)}. Se lee sola cada día.` : "Todavía no se ha leído la lista."}
        acciones={
          <>
            <div className="flex items-center gap-2">
              <Switch id="solo-interes" checked={soloInteres} onCheckedChange={setSoloInteres} />
              <Label htmlFor="solo-interes" className="text-sm">Solo GPT, o y embeddings</Label>
            </div>
            <Button type="button" variant="outline" className="h-11 gap-2" disabled={sincronizar.isPending} onClick={() => void onSincronizar()}>
              <RefreshCw className={sincronizar.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} aria-hidden="true" />
              Actualizar lista
            </Button>
          </>
        }
      >
        {lista.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay modelos que mostrar.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y rounded-md border text-sm">
            {lista.map((d) => (
              <li key={d.id} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="break-all font-mono">{d.id}</span>
                  {d.nuevo && !d.retirado_en && <Badge>Nuevo</Badge>}
                  {d.retirado_en && <Badge variant="destructive">Retirado {fecha(d.retirado_en)}</Badge>}
                </span>
                <span className="flex flex-wrap items-center gap-3 text-muted-foreground">
                  <span className={d.usd_por_m_input == null ? "text-amber-700 dark:text-amber-400" : undefined}>{formatoPrecio(d)}</span>
                  <span>{fecha(d.creado_openai)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Bloque>

      <Bloque id="modelos-historial" titulo="Historial de cambios" icono={<History />}>
        {centro.historial.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ningún cambio todavía.</p>
        ) : (
          <ul className="flex min-w-0 flex-col divide-y rounded-md border text-sm">
            {centro.historial.map((h) => (
              <li key={`${h.funcion}-${h.cambiado_en}`} className="flex min-w-0 flex-col gap-0.5 px-3 py-2">
                <span>
                  <span className="font-mono font-semibold">{h.funcion}</span>: {h.modelo_anterior ?? "el del código"} → <span className="font-mono">{h.modelo_nuevo ?? "el del código"}</span>
                  {h.respaldo_nuevo !== h.respaldo_anterior && <> · respaldo {h.respaldo_nuevo ?? "ninguno"}</>}
                </span>
                <span className="text-xs text-muted-foreground">{new Date(h.cambiado_en).toLocaleString("es-ES")} · {h.cambiado_por_email ?? "—"}</span>
                {h.notas && <span className="text-xs text-muted-foreground">{h.notas}</span>}
              </li>
            ))}
          </ul>
        )}
      </Bloque>
    </div>
  );
}
