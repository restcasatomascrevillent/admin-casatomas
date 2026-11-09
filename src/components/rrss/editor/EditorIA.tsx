/**
 * RRSS › Subida de fotos — Editor IA de fotos y vídeos.
 *
 * Un trabajo = una fila de rrss_proyectos: todo se guarda solo y se recupera al
 * volver. Izquierda: trabajos recientes; derecha: pasos (archivos, destino,
 * contenido, estilo, instrucciones, generar, resultado). Nada se publica: se
 * descarga o se copia el contenido.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  actualizarProyecto,
  borrarProyecto,
  cancelarGeneracion,
  crearProyecto,
  generacionActiva,
  medioDeArchivo,
  mensajeError,
  ordenarArchivos,
  quitarArchivo,
  type Archivo,
  type CambiosProyecto,
  type EstadoProyecto,
} from "@/components/rrss/api";
import { EstadoErrorCarga } from "@/components/EstadoErrorCarga";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MarcaId } from "@/lib/instagram/tokens";
import { ESTILOS, type EstiloId } from "@/lib/rrss/estilos";
import { formatoSalida, NOMBRE_CANAL, problemasArchivos, proporcion, type Canal, type TipoContenido } from "@/lib/rrss/formatos";
import type { TextosPublicacion as Textos } from "@/lib/rrss/plan";
import { cn } from "@/lib/utils";
import { AccionesTrabajo } from "./AccionesTrabajo";
import { EstadoGeneracion } from "./EstadoGeneracion";
import { ListaTrabajos } from "./ListaTrabajos";
import { PasoArchivos } from "./PasoArchivos";
import { PasoContenido } from "./PasoContenido";
import { PasoDestino } from "./PasoDestino";
import { PasoEstilo } from "./PasoEstilo";
import { PasoGenerar } from "./PasoGenerar";
import { PasoInstrucciones } from "./PasoInstrucciones";
import { Resultados } from "./Resultados";
import { TextosPublicacion } from "./TextosPublicacion";
import { useGenerar } from "./useGenerar";
import { useSubidas } from "./useSubidas";
import { CLAVES, archivoEnCurso, useTrabajo, useUrls } from "./useTrabajo";

export interface EditorIAProps {
  /** Si viene, el canal está fijo (la pestaña Facebook monta el editor con "facebook"). */
  canalFijo?: Canal;
  /** "editor" (por defecto) o "facebook": se guarda en el trabajo y filtra la lista de trabajos. */
  origen?: "editor" | "facebook";
  /** Trabajo a abrir al montar (viene de ?trabajo=<id>). */
  trabajoInicial?: string | null;
  /** Avisa del trabajo abierto (la página lo pone en la URL). */
  onTrabajo?: (id: string | null) => void;
  className?: string;
}

interface Ajustes {
  marca: MarcaId;
  canal: Canal;
  tipo: TipoContenido;
  estilo: EstiloId;
  titulo: string;
  instrucciones: string;
  creativo: boolean;
}

const PASOS = ["Archivos", "Destino", "Contenido", "Estilo", "Instrucciones", "Generar", "Resultado"] as const;
const ESPERA_TEXTOS = 700;

const ajustesIniciales = (canal?: Canal): Ajustes => ({ marca: "casa-tomas", canal: canal ?? "instagram", tipo: "publicacion", estilo: "elegante", titulo: "", instrucciones: "", creativo: false });

const aProyecto = (c: Partial<Ajustes>): CambiosProyecto => {
  const { creativo, ...resto } = c;
  return { ...resto, ...(creativo !== undefined ? { permitir_creativo: creativo } : {}) };
};

export function EditorIA({ canalFijo, origen = "editor", trabajoInicial = null, onTrabajo, className }: EditorIAProps) {
  const qc = useQueryClient();
  const [trabajoId, setTrabajoId] = useState<string | null>(trabajoInicial);
  const [ajustes, setAjustes] = useState<Ajustes>(() => ajustesIniciales(canalFijo));
  const [paso, setPaso] = useState(1);
  const [listaAbierta, setListaAbierta] = useState(!trabajoInicial);
  const [cancelando, setCancelando] = useState(false);

  const ajustesRef = useRef(ajustes);
  ajustesRef.current = ajustes;
  const trabajoRef = useRef(trabajoId);
  trabajoRef.current = trabajoId;
  const cargado = useRef<string | null>(null);
  const pasoElegido = useRef<string | null>(null);
  const tipoTocado = useRef(false);
  const pendiente = useRef<CambiosProyecto>({});
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { proyecto, archivos, generacion, resultados } = useTrabajo(trabajoId);
  const p = proyecto.data ?? null;
  const filas: Archivo[] = useMemo(() => archivos.data ?? [], [archivos.data]);
  const resultadosVigentes = useMemo(() => resultados.data ?? [], [resultados.data]);
  const g = generacion.data ?? null;
  const activa = generacionActiva(g);

  const canal = canalFijo ?? ajustes.canal;
  const hayVideos = filas.some((a) => a.tipo === "video");
  const formato = formatoSalida(canal, ajustes.tipo, hayVideos);
  const listos = useMemo(() => filas.filter((a) => a.estado === "listo"), [filas]);

  // Se cargan los ajustes del trabajo abierto (una vez por trabajo).
  useEffect(() => {
    if (!p || cargado.current === p.id) return;
    cargado.current = p.id;
    setAjustes({ marca: p.marca, canal: p.canal, tipo: p.tipo, estilo: p.estilo, titulo: p.titulo ?? "", instrucciones: p.instrucciones ?? "", creativo: !!p.permitir_creativo });
  }, [p]);

  // Paso inicial al abrir un trabajo: generando → «Generar»; con resultados → «Resultado».
  useEffect(() => {
    if (!trabajoId || pasoElegido.current === trabajoId) return;
    if (!proyecto.isSuccess || !archivos.isSuccess || !generacion.isSuccess || !resultados.isSuccess) return;
    pasoElegido.current = trabajoId;
    setPaso(generacionActiva(generacion.data) ? 6 : (resultados.data ?? []).length > 0 ? 7 : 1);
  }, [trabajoId, proyecto.isSuccess, archivos.isSuccess, generacion.isSuccess, generacion.data, resultados.isSuccess, resultados.data]);

  const urls = useUrls([...filas.map((a) => a.analisis?.previa_ruta), ...resultadosVigentes.flatMap((r) => [r.ruta, r.portada_ruta])]);

  // ── Guardado ────────────────────────────────────────────────────────────
  const guardarCampos = useCallback(
    async (cambios: CambiosProyecto) => {
      const id = trabajoRef.current;
      if (!id) return;
      const nuevo = await actualizarProyecto(id, cambios);
      qc.setQueryData(CLAVES.proyecto(id), nuevo);
      void qc.invalidateQueries({ queryKey: CLAVES.proyectos(origen) });
    },
    [qc, origen],
  );

  const volcarPendiente = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = null;
    const c = pendiente.current;
    pendiente.current = {};
    if (Object.keys(c).length > 0) await guardarCampos(c);
  }, [guardarCampos]);

  useEffect(
    () => () => {
      if (temporizador.current) {
        clearTimeout(temporizador.current);
        void volcarPendiente().catch(() => undefined);
      }
    },
    [volcarPendiente],
  );

  /** Ajustes discretos (tarjetas, interruptor): se guardan al momento. */
  const cambiar = useCallback(
    (c: Partial<Ajustes>) => {
      if (c.tipo) tipoTocado.current = true;
      setAjustes((a) => ({ ...a, ...c }));
      if (trabajoRef.current) guardarCampos(aProyecto(c)).catch((e) => toast.error(`No se ha guardado: ${mensajeError(e)}`));
    },
    [guardarCampos],
  );

  /** Textos libres (título, instrucciones): un momento después de dejar de escribir. */
  const cambiarTexto = useCallback(
    (campo: "titulo" | "instrucciones", valor: string) => {
      setAjustes((a) => ({ ...a, [campo]: valor }));
      if (!trabajoRef.current) return;
      pendiente.current = { ...pendiente.current, [campo]: valor };
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => void volcarPendiente().catch((e) => toast.error(`No se ha guardado: ${mensajeError(e)}`)), ESPERA_TEXTOS);
    },
    [volcarPendiente],
  );

  const guardarAntes = useCallback(
    async (extra?: CambiosProyecto) => {
      await volcarPendiente();
      const a = ajustesRef.current;
      await guardarCampos({ ...aProyecto(a), titulo: a.titulo, instrucciones: a.instrucciones, canal: canalFijo ?? a.canal, ...extra });
    },
    [volcarPendiente, guardarCampos, canalFijo],
  );

  const gen = useGenerar({ proyecto: p, archivosListos: listos, generacion: g, formato, guardarAntes });

  // ── Navegación entre trabajos ───────────────────────────────────────────
  const abrir = useCallback(
    (id: string | null, avisar = true) => {
      pasoElegido.current = null;
      cargado.current = null;
      tipoTocado.current = false;
      gen.reiniciar();
      setTrabajoId(id);
      setPaso(1);
      if (!id) setAjustes(ajustesIniciales(canalFijo));
      setListaAbierta(false);
      if (avisar) onTrabajo?.(id);
    },
    [canalFijo, onTrabajo, gen],
  );

  const abrirRef = useRef(abrir);
  abrirRef.current = abrir;
  const primera = useRef(true);
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    if ((trabajoInicial ?? null) !== trabajoRef.current) abrirRef.current(trabajoInicial ?? null, false);
  }, [trabajoInicial]);

  const asegurarTrabajo = useCallback(
    async (nuevos: File[]) => {
      const a = ajustesRef.current;
      const videos = nuevos.some((f) => medioDeArchivo(f) === "video");
      const tipo = tipoTocado.current ? a.tipo : videos ? "reel" : a.tipo;
      const creado = await crearProyecto({ marca: a.marca, canal: canalFijo ?? a.canal, tipo, estilo: a.estilo, instrucciones: a.instrucciones, permitir_creativo: a.creativo, origen, ...(a.titulo ? { titulo: a.titulo } : {}) });
      cargado.current = creado.id;
      pasoElegido.current = creado.id;
      setAjustes((x) => ({ ...x, tipo: creado.tipo }));
      qc.setQueryData(CLAVES.proyecto(creado.id), creado);
      setTrabajoId(creado.id);
      onTrabajo?.(creado.id);
      void qc.invalidateQueries({ queryKey: CLAVES.proyectos(origen) });
      return creado.id;
    },
    [canalFijo, origen, onTrabajo, qc],
  );

  const subidas = useSubidas({ trabajoId, asegurarTrabajo, totalGuardados: filas.length });

  // ── Acciones ────────────────────────────────────────────────────────────
  async function quitar(a: Archivo) {
    try {
      await quitarArchivo(a);
      await qc.invalidateQueries({ queryKey: CLAVES.archivos(a.proyecto_id) });
    } catch (e) {
      toast.error(mensajeError(e));
    }
  }

  function reordenar(ids: string[]) {
    if (!trabajoId) return;
    const orden = new Map(ids.map((id, i) => [id, i]));
    qc.setQueryData<Archivo[]>(CLAVES.archivos(trabajoId), (viejo) => (viejo ? [...viejo].sort((x, y) => (orden.get(x.id) ?? x.orden) - (orden.get(y.id) ?? y.orden)) : viejo));
    ordenarArchivos(ids)
      .catch((e) => toast.error(mensajeError(e)))
      .finally(() => void qc.invalidateQueries({ queryKey: CLAVES.archivos(trabajoId) }));
  }

  async function cancelar() {
    if (!g) return;
    setCancelando(true);
    try {
      await cancelarGeneracion(g.id);
      await qc.invalidateQueries({ queryKey: CLAVES.generacion(g.proyecto_id) });
    } catch (e) {
      toast.error(mensajeError(e));
    } finally {
      setCancelando(false);
    }
  }

  async function cambiarEstado(estado: EstadoProyecto, mensaje: string) {
    try {
      await volcarPendiente();
      await guardarCampos({ estado });
      toast.success(mensaje);
      if (estado === "archivado") abrir(null);
    } catch (e) {
      toast.error(mensajeError(e));
    }
  }

  async function borrar() {
    if (!trabajoId) return;
    try {
      await borrarProyecto(trabajoId);
      toast.success("Trabajo borrado");
      void qc.invalidateQueries({ queryKey: CLAVES.proyectos(origen) });
      abrir(null);
    } catch (e) {
      toast.error(mensajeError(e));
    }
  }

  const responder = (respuesta: string) => {
    const base = ajustesRef.current.instrucciones.trim();
    const nuevas = [base, respuesta].filter(Boolean).join("\n").slice(0, 1000);
    setAjustes((a) => ({ ...a, instrucciones: nuevas }));
    void gen.iniciar({ instrucciones: nuevas });
  };

  // ── Derivados ───────────────────────────────────────────────────────────
  const enPreparacion = filas.some(archivoEnCurso);
  const conError = filas.filter((a) => a.estado === "error").length;
  let bloqueo: string | null = null;
  if (!trabajoId || filas.length + subidas.subidas.length === 0) bloqueo = "Sube al menos una foto o un vídeo en el paso «Archivos».";
  else if (subidas.pendientes || enPreparacion) bloqueo = "Espera a que los archivos acaben de subirse y prepararse (o descarta los que han fallado).";
  else if (conError > 0) bloqueo = "Hay archivos con error: reinténtalos o quítalos en el paso «Archivos».";
  else if (listos.length === 0) bloqueo = "Ningún archivo está listo todavía.";
  else bloqueo = problemasArchivos(formato, listos)[0] ?? null;

  const primero = filas[0];
  const srcEstilo = (primero?.analisis?.previa_ruta ? urls[primero.analisis.previa_ruta] : undefined) ?? (primero ? undefined : subidas.subidas.find((s) => s.medio === "foto")?.urlLocal);

  const fotos = filas.filter((a) => a.tipo === "foto").length;
  const resumen = [
    `${filas.length} ${filas.length === 1 ? "archivo" : "archivos"}: ${fotos} ${fotos === 1 ? "foto" : "fotos"} y ${filas.length - fotos} ${filas.length - fotos === 1 ? "vídeo" : "vídeos"}`,
    `${NOMBRE_CANAL[canal]} · ${formato.etiqueta} · ${formato.ancho}×${formato.alto} px (${proporcion(formato)}) · sale en ${formato.medio === "video" ? "vídeo" : "imágenes"}`,
    `Estilo: ${ESTILOS[ajustes.estilo].nombre} · Marca: ${ajustes.marca === "touza" ? "TOUZA" : "Casa Tomás"}`,
    ajustes.creativo ? "Transformaciones creativas: permitidas" : "Transformaciones creativas: no (solo luz, color y encuadre)",
  ];

  const cargando = !!trabajoId && proyecto.isLoading;
  const errorCarga = !!trabajoId && (proyecto.isError || archivos.isError);
  const noExiste = !!trabajoId && proyecto.isSuccess && !proyecto.data;

  function contenidoPaso() {
    switch (paso) {
      case 1:
        return (
          <PasoArchivos
            archivos={filas}
            cargando={archivos.isLoading}
            subidas={subidas.subidas}
            rechazos={subidas.rechazos}
            urls={urls}
            enReintento={subidas.enReintento}
            onAnadir={(f) => void subidas.anadir(f)}
            onReintentarSubida={subidas.reintentar}
            onDescartarSubida={subidas.descartar}
            onReintentarArchivo={(a) => void subidas.reintentarGuardado(a)}
            onQuitar={quitar}
            onOrden={reordenar}
            onLimpiarRechazos={subidas.limpiarRechazos}
          />
        );
      case 2:
        return <PasoDestino canal={canal} canalFijo={canalFijo} marca={ajustes.marca} onCanal={(c) => cambiar({ canal: c })} onMarca={(m) => cambiar({ marca: m })} />;
      case 3:
        return <PasoContenido canal={canal} tipo={ajustes.tipo} archivos={filas} onTipo={(t) => cambiar({ tipo: t })} />;
      case 4:
        return <PasoEstilo estilo={ajustes.estilo} marca={ajustes.marca} src={srcEstilo} ancho={formato.ancho} alto={formato.alto} onEstilo={(e) => cambiar({ estilo: e })} />;
      case 5:
        return <PasoInstrucciones titulo={ajustes.titulo} instrucciones={ajustes.instrucciones} creativo={ajustes.creativo} onTitulo={(v) => cambiarTexto("titulo", v)} onInstrucciones={(v) => cambiarTexto("instrucciones", v)} onCreativo={(v) => cambiar({ creativo: v })} />;
      case 6:
        return (
          <PasoGenerar
            resumen={resumen}
            bloqueo={bloqueo}
            fase={gen.fase}
            error={gen.error}
            preguntas={gen.preguntas}
            ocupado={gen.ocupado}
            generacion={g}
            piezas={p?.plan?.piezas.length ?? listos.length}
            cancelando={cancelando}
            onGenerar={() => void gen.iniciar()}
            onBasico={() => void gen.generarBasico()}
            onSeguir={() => void gen.seguirSinResponder()}
            onResponder={responder}
            onCancelar={() => void cancelar()}
            onVerResultado={() => setPaso(7)}
          />
        );
      default:
        return p ? (
          <div className="space-y-5">
            {(activa || g?.estado === "error" || gen.fase !== "reposo") && (
              <EstadoGeneracion fase={gen.fase} generacion={g} piezas={p.plan?.piezas.length ?? 1} onCancelar={() => void cancelar()} cancelando={cancelando} onReintentar={() => setPaso(6)} onVerResultado={() => undefined} />
            )}
            <Resultados proyecto={p} archivos={filas} resultados={resultadosVigentes} urls={urls} formato={formatoSalida(p.canal, p.tipo, hayVideos)} generacion={g} gen={gen} />
            {resultadosVigentes.length > 0 && <TextosPublicacion key={p.id} proyectoId={p.id} canal={p.canal} textos={p.textos ?? {}} onGuardar={(t: Textos) => guardarCampos({ textos: t })} />}
            <AccionesTrabajo proyecto={p} resultados={resultadosVigentes} onEstado={cambiarEstado} onBorrar={borrar} />
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Sube archivos y genera el contenido para ver aquí el resultado.</p>
        );
    }
  }

  return (
    <div className={cn("flex min-h-0 flex-col gap-4 lg:h-full lg:flex-row", className)} data-testid="editor-ia">
      <aside className="shrink-0 lg:w-72 lg:overflow-y-auto lg:pr-1">
        <button type="button" className="flex min-h-11 w-full items-center justify-between rounded-md border px-3 text-sm font-medium lg:hidden" aria-expanded={listaAbierta} onClick={() => setListaAbierta((v) => !v)}>
          Trabajos recientes
          <ChevronDown className={cn("h-4 w-4 transition-transform", listaAbierta && "rotate-180")} aria-hidden="true" />
        </button>
        <div className={cn("mt-3 lg:mt-0", listaAbierta ? "block" : "hidden", "lg:block")}>
          <ListaTrabajos origen={origen} actual={trabajoId} onAbrir={(id) => abrir(id)} onNuevo={() => abrir(null)} />
        </div>
      </aside>

      <main className="min-w-0 flex-1 space-y-4 lg:overflow-y-auto lg:pr-1">
        <ol className="flex items-start justify-between gap-1" aria-label="Pasos">
          {PASOS.map((nombre, i) => {
            const n = i + 1;
            const hecho = (n === 1 && filas.length > 0) || (n === 7 && resultadosVigentes.length > 0);
            return (
              <li key={nombre} className="flex min-w-0 flex-1 justify-center">
                <button
                  type="button"
                  data-testid={`paso:${n}`}
                  aria-current={paso === n ? "step" : undefined}
                  aria-label={`Paso ${n}: ${nombre}`}
                  onClick={() => setPaso(n)}
                  className="group flex min-w-0 flex-col items-center gap-1 focus-visible:outline-none"
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border text-sm font-medium transition-colors group-focus-visible:ring-2 group-focus-visible:ring-ring pointer-coarse:h-11 pointer-coarse:w-11",
                      paso === n ? "border-primary bg-primary text-primary-foreground" : hecho ? "border-primary text-primary" : "border-border text-muted-foreground group-hover:bg-muted",
                    )}
                  >
                    {hecho && paso !== n ? <Check className="h-4 w-4" aria-hidden="true" /> : n}
                  </span>
                  <span className={cn("hidden max-w-full truncate text-xs sm:block", paso === n ? "font-medium" : "text-muted-foreground")}>{nombre}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <h2 className="text-base font-semibold">
          {paso}. {PASOS[paso - 1]}
        </h2>

        {activa && paso !== 6 && paso !== 7 && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 p-2 text-sm">
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Hay una generación en marcha.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => setPaso(6)}>
              Ver el progreso
            </Button>
          </div>
        )}

        {cargando ? (
          <div className="space-y-2" aria-busy="true" aria-label="Cargando el trabajo">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : errorCarga ? (
          <EstadoErrorCarga titulo="el trabajo" error={proyecto.error ?? archivos.error} onReintentar={() => { void proyecto.refetch(); void archivos.refetch(); }} />
        ) : noExiste ? (
          <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">No se ha encontrado ese trabajo: puede que se haya borrado. Elige otro de la lista o crea uno nuevo.</p>
        ) : (
          contenidoPaso()
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button type="button" variant="outline" className="gap-1" disabled={paso === 1} onClick={() => setPaso((x) => Math.max(1, x - 1))}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Anterior
          </Button>
          <Button type="button" variant="outline" className="gap-1" disabled={paso === PASOS.length} onClick={() => setPaso((x) => Math.min(PASOS.length, x + 1))}>
            Siguiente <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </main>
    </div>
  );
}
