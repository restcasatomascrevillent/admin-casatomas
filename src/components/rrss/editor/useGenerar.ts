/**
 * Flujo de «Generar con IA»: guarda el trabajo → la IA propone el plan → (si
 * pregunta algo, se contesta) → el motor genera. También rehace una sola pieza
 * o el vídeo desde «Ajustar». Nada se publica: solo se generan archivos.
 */
import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actualizarProyecto,
  ErrorRrss,
  generacionActiva,
  generar,
  mensajeError,
  proponerPieza,
  proponerPlan,
  type Archivo,
  type CambiosProyecto,
  type Generacion,
  type Proyecto,
} from "@/components/rrss/api";
import { ESTILOS } from "@/lib/rrss/estilos";
import type { FormatoSalida, Medio } from "@/lib/rrss/formatos";
import { planBasico, type ContextoPlan, type PiezaFoto, type PiezaVideo, type PlanEdicion } from "@/lib/rrss/plan";
import { CLAVES } from "./useTrabajo";

export type FaseGeneracion = "reposo" | "guardando" | "planificando" | "lanzando" | "preguntas" | "error";

export interface ErrorGeneracion {
  mensaje: string;
  tipo?: ErrorRrss["tipo"];
  /** Dónde falló: la IA (se puede seguir sin ella), el motor u otra cosa. */
  etapa: "ia" | "motor" | "otro";
}

interface Entrada {
  proyecto: Proyecto | null | undefined;
  archivosListos: Archivo[];
  generacion: Generacion | null | undefined;
  formato: FormatoSalida;
  /** Guarda lo pendiente de los pasos (y `extra`) antes de pedir nada al servidor. */
  guardarAntes: (extra?: CambiosProyecto) => Promise<void>;
}

const tipoDe = (e: unknown): ErrorRrss["tipo"] | undefined => (e instanceof ErrorRrss ? e.tipo : undefined);

export function useGenerar({ proyecto, archivosListos, generacion, formato, guardarAntes }: Entrada) {
  const qc = useQueryClient();
  const [fase, setFase] = useState<FaseGeneracion>("reposo");
  const [error, setError] = useState<ErrorGeneracion | null>(null);
  const [preguntas, setPreguntas] = useState<string[]>([]);
  const [planPendiente, setPlanPendiente] = useState<PlanEdicion | null>(null);
  const [rehaciendo, setRehaciendo] = useState(false);

  const id = proyecto?.id ?? null;

  const contexto = useCallback(
    (): ContextoPlan => ({
      archivos: archivosListos.map((a) => ({ id: a.id, tipo: a.tipo, duracion_s: a.duracion_s })),
      formato,
      estilo: proyecto?.estilo ?? "elegante",
      permitirCreativo: !!proyecto?.permitir_creativo,
      conVoz: archivosListos.filter((a) => (a.analisis?.transcripcion?.length ?? 0) > 0).map((a) => a.id),
    }),
    [archivosListos, formato, proyecto?.estilo, proyecto?.permitir_creativo],
  );

  const lanzarPlan = useCallback(
    async (plan: PlanEdicion, medio: Medio, piezas: number[] | null) => {
      if (!id) return;
      const textosVacios = !proyecto?.textos?.caption && !(proyecto?.textos?.hashtags?.length ?? 0);
      const guardado = await actualizarProyecto(id, { plan, ...(textosVacios && plan.textos ? { textos: plan.textos } : {}) });
      qc.setQueryData(CLAVES.proyecto(id), guardado);
      const g = await generar(id, medio, plan, piezas);
      qc.setQueryData(CLAVES.generacion(id), g);
      void qc.invalidateQueries({ queryKey: ["rrss", "proyectos"] });
    },
    [id, proyecto?.textos, qc],
  );

  const fallo = useCallback(
    (e: unknown, etapa: ErrorGeneracion["etapa"]) => {
      const tipo = tipoDe(e);
      setError({ mensaje: mensajeError(e), tipo, etapa });
      setFase("error");
      if (tipo === "duplicada" && id) void qc.invalidateQueries({ queryKey: CLAVES.generacion(id) });
    },
    [id, qc],
  );

  const iniciar = useCallback(
    async (extra?: CambiosProyecto) => {
      if (!id || generacionActiva(generacion)) return;
      setError(null);
      setPreguntas([]);
      setPlanPendiente(null);
      try {
        setFase("guardando");
        await guardarAntes(extra);
      } catch (e) {
        fallo(e, "otro");
        return;
      }
      let plan: PlanEdicion;
      try {
        setFase("planificando");
        plan = (await proponerPlan(id)).plan;
      } catch (e) {
        fallo(e, "ia");
        return;
      }
      if (plan.preguntas.length > 0) {
        setPreguntas(plan.preguntas);
        setPlanPendiente(plan);
        setFase("preguntas");
        return;
      }
      try {
        setFase("lanzando");
        await lanzarPlan(plan, formato.medio, null);
        setFase("reposo");
      } catch (e) {
        fallo(e, "motor");
      }
    },
    [id, generacion, guardarAntes, fallo, lanzarPlan, formato.medio],
  );

  /** «Seguir así»: genera con el plan propuesto aunque la IA haya preguntado. */
  const seguirSinResponder = useCallback(async () => {
    if (!planPendiente) return;
    setError(null);
    setPreguntas([]);
    try {
      setFase("lanzando");
      await lanzarPlan(planPendiente, formato.medio, null);
      setPlanPendiente(null);
      setFase("reposo");
    } catch (e) {
      fallo(e, "motor");
    }
  }, [planPendiente, lanzarPlan, formato.medio, fallo]);

  /** Sin IA: estilo y encuadre centrado. */
  const generarBasico = useCallback(async () => {
    if (!id || generacionActiva(generacion)) return;
    setError(null);
    try {
      setFase("guardando");
      await guardarAntes();
      setFase("lanzando");
      await lanzarPlan(planBasico(contexto(), ESTILOS[proyecto?.estilo ?? "elegante"].ritmo.segundosPorPlano), formato.medio, null);
      setFase("reposo");
    } catch (e) {
      fallo(e, "motor");
    }
  }, [id, generacion, guardarAntes, lanzarPlan, contexto, proyecto?.estilo, formato.medio, fallo]);

  const rehacer = useCallback(
    async (plan: PlanEdicion, medio: Medio, piezas: number[] | null): Promise<boolean> => {
      setRehaciendo(true);
      try {
        await lanzarPlan(plan, medio, piezas);
        toast.success(piezas ? "Rehaciendo la pieza…" : "Rehaciendo el vídeo…");
        return true;
      } catch (e) {
        toast.error(mensajeError(e));
        if (tipoDe(e) === "duplicada" && id) void qc.invalidateQueries({ queryKey: CLAVES.generacion(id) });
        return false;
      } finally {
        setRehaciendo(false);
      }
    },
    [lanzarPlan, id, qc],
  );

  /** «Aplicar ajustes» de una foto: solo se rehace esa pieza. */
  const rehacerFoto = useCallback(
    (indice: number, pieza: PiezaFoto): Promise<boolean> => {
      const base = proyecto?.plan;
      if (!base) return Promise.resolve(false);
      const plan: PlanEdicion = { ...base, piezas: base.piezas.map((p, i) => (i === indice ? pieza : p)) };
      return rehacer(plan, "foto", [indice]);
    },
    [proyecto?.plan, rehacer],
  );

  /** «Pedir otra propuesta a la IA para esta foto». */
  const otraPropuesta = useCallback(
    async (indice: number, indicacion?: string): Promise<boolean> => {
      if (!id) return false;
      setRehaciendo(true);
      try {
        const r = await proponerPieza(id, indice, indicacion?.trim() || undefined);
        await lanzarPlan(r.plan, "foto", [indice]);
        toast.success("Rehaciendo la pieza con la nueva propuesta…");
        return true;
      } catch (e) {
        toast.error(mensajeError(e));
        return false;
      } finally {
        setRehaciendo(false);
      }
    },
    [id, lanzarPlan],
  );

  /** «Aplicar cambios» del vídeo. */
  const rehacerVideo = useCallback(
    (pieza: PiezaVideo): Promise<boolean> => {
      const base = proyecto?.plan;
      if (!base) return Promise.resolve(false);
      return rehacer({ ...base, piezas: [pieza] }, "video", null);
    },
    [proyecto?.plan, rehacer],
  );

  const reiniciar = useCallback(() => {
    setFase("reposo");
    setError(null);
    setPreguntas([]);
    setPlanPendiente(null);
  }, []);

  const ocupado = fase === "guardando" || fase === "planificando" || fase === "lanzando" || rehaciendo || generacionActiva(generacion);

  return { fase, error, preguntas, ocupado, rehaciendo, iniciar, seguirSinResponder, generarBasico, rehacerFoto, otraPropuesta, rehacerVideo, reiniciar };
}
