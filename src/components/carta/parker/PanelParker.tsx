import { useEffect, useRef, useState } from "react";
import { useWatch, type Control, type FieldValues, type Path, type UseFormGetValues, type UseFormSetValue } from "react-hook-form";
import { AlertTriangle, Award, Check, ExternalLink, Loader2, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { urlSegura } from "@/lib/url-segura";
import type { DatosVinoFoto } from "../leerVinoFoto";
import {
  anadaDeNombre,
  faltaParaVerificar,
  fechaCorta,
  filaDeAnada,
  resultadoManual,
  TEXTO_ESTADO,
  TEXTO_MOTIVO,
  textoAnada,
  textoPuntos,
  tonoEstado,
  type EstadoParker,
  type FilaParker,
  type PeticionParker,
  type PuntuacionEtiqueta,
  type ResultadoParker,
} from "./parker";
import type { BusquedaParker } from "./useBusquedaParker";

export interface ValoresParkerForm extends FieldValues {
  nombre?: unknown;
  denominacion_origen?: unknown;
  anada?: unknown;
  sin_anada?: boolean;
}

interface Props<T extends ValoresParkerForm> {
  control: Control<T>;
  getValues: UseFormGetValues<T>;
  setValue: UseFormSetValue<T>;
  busqueda: BusquedaParker;
  /** Datos leídos de la etiqueta (si se ha leído una foto). */
  datosEtiqueta?: DatosVinoFoto | null;
  /** Edición: id del vino y sus filas guardadas. */
  vinoId?: string | null;
  filas?: readonly FilaParker[];
  /** Alta: guardar el resultado de la búsqueda con la ficha. */
  incluirConFicha?: boolean;
  onIncluirConFicha?: (v: boolean) => void;
  /** Edición: guardar ya un resultado (búsqueda o a mano). */
  onGuardar?: (r: ResultadoParker, origen: "busqueda" | "manual" | "foto") => Promise<void> | void;
  onConfirmar?: (f: FilaParker) => void;
  onBorrar?: (f: FilaParker) => void;
  guardando?: boolean;
}

const TONO_CLASES: Record<ReturnType<typeof tonoEstado>, string> = {
  ok: "border-emerald-600/40 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  aviso: "border-amber-500/50 bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  neutro: "border-border bg-muted text-muted-foreground",
  error: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function EtiquetaEstado({ estado, className }: { estado: EstadoParker; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", TONO_CLASES[tonoEstado(estado)], className)}>
      {TEXTO_ESTADO[estado]}
    </span>
  );
}

/** Ficha de un resultado o fila: puntos, añada, entidad, crítico, fuente, cita, discrepancias. */
export function DetalleParker({ r, desdeCache }: { r: ResultadoParker; desdeCache?: boolean }) {
  const puntos = textoPuntos(r);
  const href = urlSegura(r.fuente_url);
  return (
    <div className="min-w-0 space-y-1 text-sm" data-testid="detalle-parker">
      <div className="flex flex-wrap items-center gap-2">
        <EtiquetaEstado estado={r.estado} />
        {puntos && <span className="text-base font-semibold tabular-nums">{puntos} pts</span>}
        <span className="text-muted-foreground">añada {textoAnada(r)}</span>
        {desdeCache && <span className="text-xs text-muted-foreground">(ya verificada antes: no se ha vuelto a buscar)</span>}
      </div>
      {r.motivo && <p className="text-xs font-medium">{TEXTO_MOTIVO[r.motivo]}</p>}
      {(r.puntos_min !== null || r.fuente_nombre) && (
        <p className="text-xs text-muted-foreground">
          {r.entidad}
          {r.critico ? ` · ${r.critico}` : ""}
          {r.fecha_valoracion ? ` · valoración ${r.fecha_valoracion}` : ""}
          {r.vino_evaluado ? ` · «${r.vino_evaluado}»` : ""}
        </p>
      )}
      {r.fuente_nombre && (
        <p className="break-words text-xs">
          Fuente{r.fuente_tipo === "original" ? " original" : r.fuente_tipo === "secundaria" ? " secundaria" : r.fuente_tipo === "manual" ? " (a mano)" : ""}:{" "}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
              {r.fuente_nombre}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : (
            r.fuente_nombre
          )}
          {r.fecha_consulta ? ` · consultada el ${fechaCorta(r.fecha_consulta)}` : ""}
          {r.comprobado_en_pagina ? " · comprobada en la página" : ""}
        </p>
      )}
      {r.cita && <p className="break-words border-l-2 pl-2 text-xs italic text-muted-foreground">«{r.cita}»</p>}
      {r.discrepancias?.length > 0 && (
        <div className="text-xs">
          <p className="font-medium">Otras fuentes con datos distintos:</p>
          <ul className="list-disc pl-5">
            {r.discrepancias.map((d, i) => {
              const hd = urlSegura(d.fuente_url);
              return (
                <li key={`${d.fuente_nombre}-${i}`} className="break-words">
                  {hd ? (
                    <a href={hd} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">{d.fuente_nombre}</a>
                  ) : (
                    d.fuente_nombre
                  )}
                  {d.puntos_texto ? `: ${d.puntos_texto}` : ""}
                  {d.nota ? ` — ${d.nota}` : ""}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {r.notas && <p className="break-words text-xs text-muted-foreground">{r.notas}</p>}
    </div>
  );
}

function textoEtiqueta(p: PuntuacionEtiqueta): string {
  const base = p.puntos !== null ? `${p.puntos} pts` : p.texto;
  if (p.entidad_tipo === "parker") return `${base} · ${p.entidad} — se comprueba con la búsqueda, no se da por buena`;
  if (p.entidad_tipo === "otra") return `${base} · ${p.entidad} — no es Parker`;
  return `${base} · entidad no legible — no se da por Parker`;
}

/** Primera puntuación impresa útil para orientar la búsqueda (la de Parker si la hay). */
function etiquetaParaBusqueda(lista: readonly PuntuacionEtiqueta[] | undefined): PeticionParker["puntuacion_etiqueta"] {
  const p = (lista ?? []).find((x) => x.entidad_tipo === "parker" && x.puntos !== null) ?? null;
  return p ? { puntos: p.puntos, entidad: p.entidad, anada: p.anada } : null;
}

function anadaDeCampo(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{4}\s*$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n >= 1900 && n <= 2100 ? n : null;
}

/**
 * Bloque «Puntuación Parker» de los formularios de vino (08/11/2026).
 * - Añada que se sirve y «sin añada (NV)»: sin una de las dos no se asocia
 *   ninguna puntuación (la web no la enseña).
 * - Tras leer la etiqueta: si la añada se lee y la identificación no es dudosa,
 *   busca en segundo plano; si no, pide confirmarla antes de buscar.
 * - Puntuaciones impresas: se enseñan con su entidad y nunca se dan por Parker.
 * - Resultado con estado y fuente. Si la búsqueda falla, la ficha se guarda igual.
 */
export function PanelParker<T extends ValoresParkerForm>({
  control,
  getValues,
  setValue,
  busqueda,
  datosEtiqueta,
  vinoId = null,
  filas = [],
  incluirConFicha = true,
  onIncluirConFicha,
  onGuardar,
  onConfirmar,
  onBorrar,
  guardando = false,
}: Props<T>) {
  const n = (k: keyof ValoresParkerForm) => k as Path<T>;
  const [nombre, anadaTexto, sinAnada] = useWatch({ control, name: [n("nombre"), n("anada"), n("sin_anada")] }) as [unknown, unknown, unknown];
  const anada = sinAnada === true ? null : anadaDeCampo(anadaTexto);
  const anadaNombre = anadaDeNombre(typeof nombre === "string" ? nombre : null);
  const [manualAbierto, setManualAbierto] = useState(false);
  const [manual, setManual] = useState({ puntos: "", fuente_nombre: "", fuente_url: "", critico: "", fecha_valoracion: "", comprobada: false });
  const [errorManual, setErrorManual] = useState<string | null>(null);

  const peticion = (forzar: boolean, anadaYa?: { anada: number | null; sin_anada: boolean }): PeticionParker => ({
    vino_id: vinoId,
    nombre: String(getValues(n("nombre")) ?? "").trim() || datosEtiqueta?.nombre || "",
    bodega: datosEtiqueta?.bodega ?? null,
    cuvee: datosEtiqueta?.cuvee ?? null,
    denominacion_origen: String(getValues(n("denominacion_origen")) ?? "").trim() || null,
    ...(anadaYa ?? {
      anada: getValues(n("sin_anada")) === true ? null : anadaDeCampo(getValues(n("anada"))),
      sin_anada: getValues(n("sin_anada")) === true,
    }),
    forzar,
    puntuacion_etiqueta: etiquetaParaBusqueda(datosEtiqueta?.puntuaciones_etiqueta),
  });

  // Tras leer una etiqueta: añada / NV a los campos vacíos y búsqueda automática
  // si la añada se distingue y la identificación no es dudosa (cada lectura, una vez).
  const procesada = useRef<DatosVinoFoto | null>(null);
  const { lanzar } = busqueda;
  useEffect(() => {
    if (!datosEtiqueta || procesada.current === datosEtiqueta) return;
    procesada.current = datosEtiqueta;
    const vacia = anadaDeCampo(getValues(n("anada"))) === null && getValues(n("sin_anada")) !== true;
    if (vacia && datosEtiqueta.sin_anada === true) setValue(n("sin_anada"), true as never, { shouldDirty: true });
    else if (vacia && typeof datosEtiqueta.anada === "number") setValue(n("anada"), String(datosEtiqueta.anada) as never, { shouldDirty: true, shouldValidate: true });
    // La añada de la búsqueda: la del formulario si ya había una; si no, la leída.
    const p = peticion(
      false,
      vacia
        ? { anada: datosEtiqueta.sin_anada === true ? null : datosEtiqueta.anada ?? null, sin_anada: datosEtiqueta.sin_anada === true }
        : undefined,
    );
    if (!p.nombre || datosEtiqueta.identificacion_ambigua) return;
    if (p.anada === null && !p.sin_anada) return;
    // No repetir lo ya verificado de este vino y añada.
    if (filaDeAnada(filas, p.anada, p.sin_anada)?.estado === "verificada") return;
    void lanzar(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datosEtiqueta]);

  const filaServida = filaDeAnada(filas, anada, sinAnada === true);
  const puedeBuscar = (anada !== null || sinAnada === true) && Boolean(String(nombre ?? "").trim());
  const etiqueta = datosEtiqueta?.puntuaciones_etiqueta ?? [];
  const r = busqueda.resultado;
  const resultadoDeOtraAnada = r !== null && (r.sin_anada !== (sinAnada === true) || (!r.sin_anada && r.anada !== anada));

  const guardarManual = async () => {
    const { resultado, error } = resultadoManual({ ...manual, anada, sin_anada: sinAnada === true });
    setErrorManual(error);
    if (!resultado || !onGuardar) return;
    await onGuardar(resultado, "manual");
    setManual({ puntos: "", fuente_nombre: "", fuente_url: "", critico: "", fecha_valoracion: "", comprobada: false });
    setManualAbierto(false);
  };

  return (
    <div className="min-w-0 space-y-3" data-testid="panel-parker">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Award className="h-4 w-4 text-primary" aria-hidden="true" />
        Puntuación Parker
      </p>

      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <FormField
          control={control}
          name={n("anada")}
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-xs text-muted-foreground">Añada que se sirve</FormLabel>
              <FormControl>
                <Input
                  {...field}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  disabled={sinAnada === true}
                  value={sinAnada === true ? "" : ((field.value as string | number | undefined) ?? "")}
                  placeholder={sinAnada === true ? "Sin añada" : "Ej.: 2021"}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={n("sin_anada")}
          render={({ field }) => (
            <FormItem className="flex min-h-10 items-center gap-2 space-y-0 pb-1">
              <FormControl>
                <Switch
                  checked={field.value === true}
                  onCheckedChange={(v) => {
                    field.onChange(v);
                    if (v) setValue(n("anada"), "" as never, { shouldDirty: true });
                  }}
                />
              </FormControl>
              <FormLabel className="cursor-pointer text-xs">Sin añada (NV)</FormLabel>
            </FormItem>
          )}
        />
      </div>
      {anadaNombre !== null && anada !== null && anadaNombre !== anada && (
        <p className="flex gap-1 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          El nombre dice {anadaNombre} y la añada que se sirve es {anada}. Revisa cuál es la buena.
        </p>
      )}
      {anada === null && sinAnada !== true && (
        <p className="text-xs text-muted-foreground">Sin añada la web no enseña la puntuación: no se puede saber si es la de la botella que se sirve.</p>
      )}

      {etiqueta.length > 0 && (
        <div className="rounded-md bg-muted/60 px-2 py-1 text-xs" data-testid="parker-etiqueta">
          <p className="font-medium">Puntuaciones impresas en la etiqueta:</p>
          <ul className="list-disc pl-5">
            {etiqueta.map((p, i) => (
              <li key={`${p.texto}-${i}`}>
                {textoEtiqueta(p)}
                {p.anada !== null && p.anada !== anada ? ` (dice añada ${p.anada})` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {datosEtiqueta && datosEtiqueta.identificacion_ambigua && busqueda.fase === "inactiva" && (
        <p className="flex gap-1 rounded-md border border-amber-500/50 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          La IA no tiene claro qué vino es{datosEtiqueta.motivo_ambiguedad ? `: ${datosEtiqueta.motivo_ambiguedad}` : ""}. Revisa el nombre y la añada y pulsa «Buscar puntuación».
        </p>
      )}
      {datosEtiqueta && !datosEtiqueta.identificacion_ambigua && datosEtiqueta.anada === null && !datosEtiqueta.sin_anada && busqueda.fase === "inactiva" && (
        <p className="flex gap-1 rounded-md border border-amber-500/50 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200" role="status" data-testid="parker-pide-anada">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          No se distingue la añada en la foto. Escríbela (o marca «Sin añada») y pulsa «Buscar puntuación».
        </p>
      )}

      <div aria-live="polite" className="space-y-2">
        {busqueda.fase === "buscando" && (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground" data-testid="parker-buscando">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Buscando la puntuación Parker de {busqueda.peticion?.nombre} {busqueda.peticion?.sin_anada ? "(sin añada)" : busqueda.peticion?.anada}… Puedes seguir y guardar la ficha.
          </p>
        )}
        {busqueda.fase === "fallida" && (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive" role="status">
            La búsqueda falló: {busqueda.error}. Puedes guardar la ficha sin puntuación y buscarla más tarde.
          </p>
        )}
        {r && busqueda.fase === "hecha" && (
          <div className="rounded-md border p-2" data-testid="parker-resultado">
            <DetalleParker r={r} desdeCache={busqueda.desdeCache} />
            {resultadoDeOtraAnada && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">La búsqueda era para la añada {textoAnada(r)}; ahora la que se sirve es otra. Vuelve a buscar.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {!vinoId && onIncluirConFicha && r.estado !== "fallida" && (
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <Checkbox checked={incluirConFicha} onCheckedChange={(v) => onIncluirConFicha(v === true)} />
                  Guardar este resultado con la ficha
                </label>
              )}
              {vinoId && onGuardar && r.estado !== "fallida" && !busqueda.desdeCache && (
                <Button type="button" size="sm" variant="outline" className="h-9" disabled={guardando} onClick={() => void onGuardar(r, "busqueda")}>
                  <Check className="mr-1 h-4 w-4" aria-hidden="true" />
                  Guardar este resultado
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={busqueda.limpiar}>
                Descartar
              </Button>
            </div>
          </div>
        )}
        {busqueda.fase !== "buscando" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" className="h-9" disabled={!puedeBuscar} onClick={() => void busqueda.lanzar(peticion(Boolean(filaServida) || busqueda.fase !== "inactiva"))}>
              {filaServida || busqueda.fase !== "inactiva" ? <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> : <Search className="mr-1 h-4 w-4" aria-hidden="true" />}
              {filaServida || busqueda.fase !== "inactiva" ? "Buscar de nuevo" : "Buscar puntuación"}
            </Button>
            {vinoId && onGuardar && (
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => setManualAbierto((v) => !v)} aria-expanded={manualAbierto}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Añadir a mano
              </Button>
            )}
          </div>
        )}
      </div>

      {manualAbierto && vinoId && onGuardar && (
        <div className="space-y-2 rounded-md border p-2" data-testid="parker-manual">
          <p className="text-xs text-muted-foreground">Para la añada {anada ?? (sinAnada === true ? "sin añada" : "— pon antes la añada que se sirve")}. Solo Robert Parker / The Wine Advocate.</p>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label="Puntos" placeholder="Puntos: 94, 94+ o 93-95" value={manual.puntos} onChange={(e) => setManual({ ...manual, puntos: e.target.value })} />
            <Input aria-label="Crítico" placeholder="Crítico (opcional)" value={manual.critico} onChange={(e) => setManual({ ...manual, critico: e.target.value })} />
            <Input aria-label="Nombre de la fuente" placeholder="Fuente: robertparker.com, bodega…" value={manual.fuente_nombre} onChange={(e) => setManual({ ...manual, fuente_nombre: e.target.value })} />
            <Input aria-label="Fecha de la valoración" placeholder="Fecha valoración (AAAA-MM)" value={manual.fecha_valoracion} onChange={(e) => setManual({ ...manual, fecha_valoracion: e.target.value })} />
            <Input aria-label="URL de la fuente" className="col-span-2" placeholder="https://…" value={manual.fuente_url} onChange={(e) => setManual({ ...manual, fuente_url: e.target.value })} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox checked={manual.comprobada} onCheckedChange={(v) => setManual({ ...manual, comprobada: v === true })} />
            He comprobado en la fuente que es la nota de Parker de este vino y esta añada (si no, queda pendiente de revisión)
          </label>
          {errorManual && <p className="text-xs text-destructive">{errorManual}</p>}
          <Button type="button" size="sm" className="h-9" disabled={guardando || (anada === null && sinAnada !== true)} onClick={() => void guardarManual()}>
            Guardar puntuación
          </Button>
        </div>
      )}

      {filas.length > 0 && (
        <div className="space-y-2" data-testid="parker-filas">
          <p className="text-xs font-medium text-muted-foreground">Guardadas para este vino</p>
          {filas.map((f) => {
            const faltan = faltaParaVerificar(f);
            const esServida = filaServida?.id === f.id;
            return (
              <div key={f.id} className={cn("rounded-md border p-2", esServida && "border-primary/60")}>
                <DetalleParker r={f} />
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {esServida ? (
                    <span className="text-xs text-primary">Añada que se sirve{f.estado === "verificada" && !f.provisional ? " · sale en la web" : ""}</span>
                  ) : (
                    f.estado === "verificada" && (f.anada !== null || f.sin_anada) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => {
                          if (f.sin_anada) {
                            setValue(n("sin_anada"), true as never, { shouldDirty: true });
                            setValue(n("anada"), "" as never, { shouldDirty: true });
                          } else {
                            setValue(n("sin_anada"), false as never, { shouldDirty: true });
                            setValue(n("anada"), String(f.anada) as never, { shouldDirty: true, shouldValidate: true });
                          }
                        }}
                      >
                        Se sirve esta añada
                      </Button>
                    )
                  )}
                  {f.estado === "revision" && onConfirmar && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      disabled={faltan.length > 0 || guardando}
                      title={faltan.length ? `Falta ${faltan.join(", ")}` : "Has comprobado la fuente y es correcta"}
                      onClick={() => onConfirmar(f)}
                    >
                      <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Confirmar
                    </Button>
                  )}
                  {onBorrar && (
                    <Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-destructive" disabled={guardando} onClick={() => onBorrar(f)}>
                      <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                      Descartar
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
