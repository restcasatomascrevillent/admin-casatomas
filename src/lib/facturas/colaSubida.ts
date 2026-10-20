// ============================================================================
//  Cola de subida de facturas EN SEGUNDO PLANO (petición del dueño, 05-oct-2026:
//  «que se pueda subir en background sin tener que estar atento»).
// ----------------------------------------------------------------------------
//  Antes la subida vivía en el estado de <SubidaFacturas>: al cambiar de
//  pestaña o de sección del panel se desmontaba y la cola se perdía (las
//  llamadas seguían, pero nadie recogía el resultado). Ahora es un store sin
//  React (este fichero) que monta UNA vez <ColaSubidaProvider> por encima de
//  las rutas; el componente de la pestaña «Cargar» solo lo enseña.
//
//  Fases de cada documento (desde el 05-oct-2026 TODOS van por trabajos en el
//  servidor: los largos troceados y los de una página como pieza única):
//    seleccionado → (Enviar) → en_cola → preparando → subiendo (a Storage)
//      → procesando (en el servidor: ocr_trabajos) → terminado
//    Respaldo si el servidor aún no admite trabajos (versión antigua):
//    seleccionado → en_cola → preparando → enviando (camino síncrono:
//      una sola llamada a procesar-factura de 10-40 s) → terminado
//  «En el navegador» (cerrar la pestaña las pierde): en_cola, preparando,
//  subiendo y enviando. «procesando» ya está en el servidor y sigue aunque se
//  cierre la pestaña (al volver se ADOPTA desde ocr_trabajos).
//
//  Las dependencias (Supabase, troceado) se inyectan: los tests la manejan
//  sin red ni React.
// ============================================================================

import type { AlertaValidacion } from "@/hooks/useFacturas";
import { supabase } from "@/integrations/supabase/client";
import { costeDeRespuesta } from "./costeLectura";
import {
  describirProgreso,
  esperarTrabajo,
  type Anadible,
  type EstadoTrabajo,
  iniciarDocumentoLargo,
  iniciarDocumentoUnico,
  type InicioDocumentoLargo,
  MAX_PAGINAS_UNIDAS,
  MIMES_UNIBLES,
  type PlanDocumento,
  planificarDocumento,
  planificarGrupo,
  SinDocumentosLargos,
  type Sustituible,
} from "./documentoLargo";

export interface ResultadoProcesamiento {
  nombre: string;
  success: boolean;
  error?: string;
  respuesta?: unknown;
  tipo?: "factura" | "albaran" | string;
  /** Avisos de cordura de importes devueltos por procesar-factura (T5). */
  alertas?: AlertaValidacion[];
  /**
   * `false` = el documento se guardó en base de datos pero el PDF/imagen
   * original NO se pudo archivar ni en Drive ni en Storage. Es pérdida de
   * datos y el usuario tiene que verlo, no solo los logs de la función.
   */
  archivoGuardado?: boolean;
  /**
   * `true` = `procesar-factura` reconoció el documento como ya existente
   * (mismo número+proveedor+fecha+total) y NO lo volvió a insertar.
   */
  duplicado?: boolean;
  /** Duplicado que se puede SUSTITUIR por el documento nuevo (ya leído). */
  sustituible?: Sustituible | null;
  /** Ya se ha sustituido la factura existente por este documento. */
  sustituida?: boolean;
  /** Es otra página de una factura que ya existe: se puede AÑADIR (nunca sustituir). */
  anadible?: Anadible | null;
  /** Ya se ha añadido como página a la factura existente. */
  paginaAnadida?: boolean;
  /** Por qué no se ofrece «Sustituir» en un duplicado. */
  motivoNoSustituible?: string;
  /** Documento largo leído por trozos (páginas o franjas). */
  piezas?: number;
  /** Id del documento guardado (o del ya existente si es un duplicado): el «Ver» abre ESE en Compras. */
  facturaId?: number;
  /** USD que costó leer el documento (todas sus llamadas a OpenAI); undefined = el servidor aún no lo manda. */
  costeUsd?: number;
}

export type TipoDocumento = "factura" | "albaran";

/** «Albarán», «ALBARAN », «albaran» → "albaran"; «Factura» → "factura"; otra cosa → null. */
export function normalizarTipo(v: unknown): TipoDocumento | null {
  if (typeof v !== "string") return null;
  const t = v.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  if (t.startsWith("albaran")) return "albaran";
  if (t.startsWith("factura")) return "factura";
  return null;
}

/** Respuesta de procesar-factura (síncrona) o resultado de un trabajo → fila. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cuerpo JSON de la función, se valida campo a campo
export function aResultado(nombre: string, data: any, piezas?: number, facturaIdTrabajo?: number | null): ResultadoProcesamiento {
  if (!data?.success) {
    return { nombre, success: false, error: data?.error || "Error desconocido", piezas };
  }
  return {
    nombre,
    success: true,
    respuesta: data.webhookResponse,
    // Normalizado («Albarán» / «albaran» → "albaran"); si no se reconoce, tal cual.
    tipo: normalizarTipo(data.webhookResponse?.tipo) ?? normalizarTipo(data.tipo) ?? (data.webhookResponse?.tipo || data.tipo),
    alertas: Array.isArray(data.alertas) ? data.alertas : [],
    archivoGuardado: data.duplicado === true ? undefined : data.archivo_guardado !== false,
    duplicado: data.duplicado === true,
    sustituible: data.sustituible ?? null,
    anadible: data.anadible ?? null,
    ...(typeof data.motivo_no_sustituible === "string" ? { motivoNoSustituible: data.motivo_no_sustituible } : {}),
    ...(data.pagina_anadida === true ? { paginaAnadida: true } : {}),
    piezas,
    facturaId: idDocumento(data, facturaIdTrabajo),
    ...(costeDeRespuesta(data) !== null ? { costeUsd: costeDeRespuesta(data) as number } : {}),
  };
}

/** Id del documento que dejó el procesado: el nuevo, el ya existente (duplicado) o el del trabajo. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- cuerpo JSON de la función
function idDocumento(data: any, facturaIdTrabajo?: number | null): number | undefined {
  const candidatos = [
    data?.webhookResponse?.factura_id,
    data?.webhookResponse?.factura_existente_id,
    data?.sustituible?.existente?.id,
    data?.anadible?.existente?.id,
    facturaIdTrabajo,
  ];
  const id = candidatos.find((c) => typeof c === "number" && Number.isInteger(c) && c > 0);
  return id as number | undefined;
}

export type ClaseResultado = "guardada" | "avisos" | "sin_original" | "duplicada" | "pendiente" | "sustituida" | "fallida";

/** Cómo se cuenta un resultado (toast, indicador y resumen de la campana). */
export function clasificarResultado(r: ResultadoProcesamiento | undefined): ClaseResultado {
  if (!r || !r.success) return "fallida";
  if (r.sustituida || r.paginaAnadida) return "sustituida";
  if (r.duplicado) return r.sustituible || r.anadible ? "pendiente" : "duplicada";
  if (r.archivoGuardado === false) return "sin_original";
  if ((r.alertas?.length ?? 0) > 0) return "avisos";
  return "guardada";
}

export type FaseElemento =
  | "seleccionado"
  | "en_cola"
  | "preparando"
  | "subiendo"
  | "enviando"
  | "procesando"
  | "terminado";

/** Fases que cuentan como «en marcha» (indicador global). */
export const FASES_ACTIVAS: readonly FaseElemento[] = ["en_cola", "preparando", "subiendo", "enviando", "procesando"];
/** Fases que dependen del NAVEGADOR: cerrar la pestaña las pierde (aviso `beforeunload`). */
export const FASES_EN_NAVEGADOR: readonly FaseElemento[] = ["en_cola", "preparando", "subiendo", "enviando"];

export interface ElementoCola {
  id: string;
  nombre: string;
  /** `null` = documento ADOPTADO del servidor (se subió en otra carga de la página). */
  file: File | null;
  preview: string;
  tamano: number;
  fase: FaseElemento;
  /** Texto corto de lo que está haciendo («Subiendo trozo 2 de 6…»). */
  progreso: string;
  /** Tanda de envío: la barra de progreso cuenta solo la tanda actual. */
  tanda: number;
  trabajoId?: string;
  piezas?: number;
  resultado?: ResultadoProcesamiento;
  /**
   * Fotos unidas como UN documento (páginas 1..n, en este orden). `file` es la
   * primera. Se envían por el camino de documento largo.
   */
  fotos?: File[];
  /** Miniaturas de `fotos` (mismo orden). */
  previews?: string[];
}

export interface EstadoCola {
  elementos: ElementoCola[];
  tanda: number;
}

export interface ResumenTanda {
  tanda: number;
  total: number;
  porClase: Record<ClaseResultado, number>;
}

export interface DepsCola {
  planificar: (file: File) => Promise<PlanDocumento>;
  iniciarLargo: (
    file: File,
    plan: Extract<PlanDocumento, { camino: "largo" }>,
    onProgreso: (subidas: number, total: number) => void,
  ) => Promise<InicioDocumentoLargo>;
  /**
   * Documento de una página como trabajo de UNA pieza en el servidor (sube el
   * fichero y crea el trabajo). Si falta, o el servidor no lo admite
   * (SinDocumentosLargos), se usa `procesarUnico`.
   */
  iniciarUnico?: (file: File, onProgreso: (subidas: number, total: number) => void) => Promise<InicioDocumentoLargo>;
  /** Fotos unidas como un documento → plan de documento largo (una página por foto). */
  planificarGrupo?: (fotos: File[]) => Promise<Extract<PlanDocumento, { camino: "largo" }>>;
  esperar: (trabajoId: string, onCambio: (t: EstadoTrabajo | null) => void) => Promise<EstadoTrabajo>;
  /** Camino síncrono de una página (respaldo): lee el fichero y llama a procesar-factura. */
  procesarUnico: (file: File, nombre: string) => Promise<ResultadoProcesamiento>;
  /** Cada documento que termina (toast, invalidar listas…). */
  alTerminar?: (e: ElementoCola) => void;
  /** Cuando ya no queda nada en marcha de la tanda (campana). */
  alAcabarTanda?: (r: ResumenTanda) => void;
  crearPreview?: (file: File) => string;
  revocarPreview?: (url: string) => void;
  /**
   * Documentos a la vez EN EL NAVEGADOR (preparando, subiendo o, en el camino
   * síncrono, esperando la respuesta). Los que ya están «procesando» en el
   * servidor no ocupan hueco: así una tanda se sube entera enseguida y se
   * puede cerrar la pestaña sin esperar a que se lean los primeros.
   */
  maxSimultaneos?: number;
  generarId?: () => string;
}

export const TIPOS_PERMITIDOS = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
export const MAX_BYTES_ARCHIVO = 10 * 1024 * 1024;

const mensajeError = (err: unknown) => (err instanceof Error ? err.message : String(err ?? "Error desconocido"));

/**
 * La cámara del iPad/móvil llama "image.jpg" a TODAS las fotos y la cola
 * identifica cada fila por su nombre en pantalla: se les da uno único.
 */
export function nombreUnico(file: File, usados: Set<string>, ahora: Date = new Date()): string {
  const punto = file.name.lastIndexOf(".");
  const ext = punto > 0 ? file.name.slice(punto) : "";
  const generico = /^image\.[a-z0-9]+$/i.test(file.name) || file.name === "";
  const base = generico
    ? `foto-${ahora.toISOString().slice(0, 16).replace("T", "-").replace(":", "")}`
    : punto > 0
      ? file.name.slice(0, punto)
      : file.name;
  let candidato = `${base}${ext}`;
  for (let n = 2; usados.has(candidato); n += 1) candidato = `${base}-${n}${ext}`;
  usados.add(candidato);
  return candidato;
}

export type ColaSubida = ReturnType<typeof crearColaSubida>;

export function crearColaSubida(deps: DepsCola) {
  let estado: EstadoCola = { elementos: [], tanda: 0 };
  let tandaAvisada = 0;
  let enMarcha = 0;
  const oyentes = new Set<() => void>();
  const max = Math.max(1, deps.maxSimultaneos ?? 3);
  let contador = 0;
  const generarId = deps.generarId ?? (() => `doc-${Date.now().toString(36)}-${(contador += 1)}`);
  const crearPreview =
    deps.crearPreview ??
    ((f: File) => (f.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : ""));
  const revocarPreview =
    deps.revocarPreview ?? ((u: string) => (u && typeof URL.revokeObjectURL === "function" ? URL.revokeObjectURL(u) : undefined));

  const emitir = () => oyentes.forEach((f) => f());
  const fijar = (nuevo: EstadoCola) => {
    estado = nuevo;
    emitir();
  };
  const buscar = (id: string) => estado.elementos.find((e) => e.id === id);
  const actualizar = (id: string, cambio: Partial<ElementoCola>) => {
    if (!buscar(id)) return;
    fijar({ ...estado, elementos: estado.elementos.map((e) => (e.id === id ? { ...e, ...cambio } : e)) });
  };
  const hayActivos = () => estado.elementos.some((e) => FASES_ACTIVAS.includes(e.fase));
  /** Tanda a la que se suma lo que entra ahora: la actual si sigue en marcha, otra si no. */
  const tandaParaNuevos = () => (hayActivos() ? estado.tanda : estado.tanda + 1);

  const comprobarFinTanda = () => {
    if (hayActivos() || tandaAvisada >= estado.tanda) return;
    const deLaTanda = estado.elementos.filter((e) => e.tanda === estado.tanda && e.fase === "terminado");
    tandaAvisada = estado.tanda;
    if (deLaTanda.length === 0) return;
    const porClase: Record<ClaseResultado, number> = {
      guardada: 0, avisos: 0, sin_original: 0, duplicada: 0, pendiente: 0, sustituida: 0, fallida: 0,
    };
    deLaTanda.forEach((e) => { porClase[clasificarResultado(e.resultado)] += 1; });
    deps.alAcabarTanda?.({ tanda: estado.tanda, total: deLaTanda.length, porClase });
  };

  const terminar = (id: string, resultado: ResultadoProcesamiento) => {
    actualizar(id, { fase: "terminado", resultado, progreso: "" });
    const e = buscar(id);
    if (e) {
      try {
        deps.alTerminar?.(e);
      } catch (err) {
        console.warn("[cola-subida] alTerminar falló:", err);
      }
    }
  };

  const seguirTrabajo = async (id: string, nombre: string, trabajoId: string, piezas?: number): Promise<ResultadoProcesamiento> => {
    const fin = await deps.esperar(trabajoId, (t) => {
      if (t) actualizar(id, { progreso: describirProgreso(t) });
    });
    // Solo los documentos largos hablan de «trozos»; uno de una página, no.
    const total = piezas ?? fin.num_paginas;
    const n = total > 1 ? total : undefined;
    if (fin.estado === "fallido" || fin.estado === "cancelado") {
      return { nombre, success: false, error: fin.error || "No se pudo leer el documento", piezas: n };
    }
    return aResultado(nombre, fin.resultado, n, fin.factura_id);
  };

  const procesar = async (id: string, liberarHueco: () => void) => {
    const e = buscar(id);
    if (!e?.file) return;
    const { file, nombre } = e;
    actualizar(id, { fase: "preparando", progreso: "Preparando…" });
    let resultado: ResultadoProcesamiento | null = null;
    if (e.fotos && e.fotos.length >= 2) {
      try {
        resultado = await procesarGrupo(id, nombre, e.fotos, liberarHueco);
      } catch (err) {
        resultado = {
          nombre,
          success: false,
          error: err instanceof SinDocumentosLargos
            ? "El servidor aún no admite documentos de varias fotos: envíalas por separado o espera a que se actualice."
            : mensajeError(err),
        };
      }
      terminar(id, resultado);
      return;
    }
    try {
      // Documento LARGO (imagen muy alta o PDF de varias páginas): se trocea
      // aquí y se lee en el servidor por trozos. Si el servidor aún no lo
      // admite, sigue por el camino de siempre.
      let plan: PlanDocumento = { camino: "unico" };
      try {
        plan = await deps.planificar(file);
      } catch (err) {
        console.warn("[cola-subida] no se pudo trocear, se envía entero:", err);
      }
      if (plan.camino === "largo") {
        try {
          actualizar(id, { fase: "subiendo", progreso: "Subiendo…", piezas: plan.piezas.length });
          const inicio = await deps.iniciarLargo(file, plan, (n, t) =>
            actualizar(id, { progreso: `Subiendo trozo ${n} de ${t}…` }),
          );
          actualizar(id, { fase: "procesando", trabajoId: inicio.trabajoId, piezas: inicio.numPiezas, progreso: "En cola…" });
          liberarHueco();
          resultado = await seguirTrabajo(id, nombre, inicio.trabajoId, inicio.numPiezas);
        } catch (err) {
          if (!(err instanceof SinDocumentosLargos)) throw err;
          console.warn("[cola-subida] el servidor aún no admite documentos largos; camino de una página:", err.message);
        }
      } else if (deps.iniciarUnico) {
        // Una página: también en el servidor (pieza única). Solo la subida a
        // Storage depende del navegador; luego se puede cerrar la pestaña.
        try {
          actualizar(id, { fase: "subiendo", progreso: "Subiendo…", piezas: undefined });
          const inicio = await deps.iniciarUnico(file, () => undefined);
          actualizar(id, { fase: "procesando", trabajoId: inicio.trabajoId, progreso: "En cola…" });
          liberarHueco();
          resultado = await seguirTrabajo(id, nombre, inicio.trabajoId, 1);
        } catch (err) {
          if (!(err instanceof SinDocumentosLargos)) throw err;
          console.warn("[cola-subida] el servidor aún no lee una página en segundo plano; camino síncrono:", err.message);
        }
      }
      if (!resultado) {
        actualizar(id, { fase: "enviando", progreso: "Leyendo el documento…", piezas: undefined });
        resultado = await deps.procesarUnico(file, nombre);
      }
    } catch (err) {
      resultado = { nombre, success: false, error: mensajeError(err) };
    }
    terminar(id, resultado);
  };

  /** Fotos unidas: un documento largo con una página por foto. */
  const procesarGrupo = async (id: string, nombre: string, fotos: File[], liberarHueco: () => void) => {
    const plan = await (deps.planificarGrupo ?? ((f: File[]) => planificarGrupo(f)))(fotos);
    actualizar(id, { fase: "subiendo", progreso: "Subiendo…", piezas: plan.piezas.length });
    const inicio = await deps.iniciarLargo(fotos[0], plan, (n, t) => actualizar(id, { progreso: `Subiendo ${n} de ${t}…` }));
    actualizar(id, { fase: "procesando", trabajoId: inicio.trabajoId, piezas: inicio.numPiezas, progreso: "En cola…" });
    liberarHueco();
    return seguirTrabajo(id, nombre, inicio.trabajoId, inicio.numPiezas);
  };

  const bombear = () => {
    while (enMarcha < max) {
      const siguiente = estado.elementos.find((e) => e.fase === "en_cola");
      if (!siguiente) break;
      enMarcha += 1;
      // Se marca ya, para que la siguiente vuelta del bucle no lo vuelva a coger.
      actualizar(siguiente.id, { fase: "preparando", progreso: "Preparando…" });
      // El hueco se libra al llegar al servidor («procesando») o al terminar.
      let libre = false;
      const liberarHueco = () => {
        if (libre) return;
        libre = true;
        enMarcha -= 1;
        bombear();
      };
      void procesar(siguiente.id, liberarHueco).finally(() => {
        liberarHueco();
        comprobarFinTanda();
      });
    }
  };

  const ponerEnCola = (filtro: (e: ElementoCola) => boolean) => {
    const ids = estado.elementos.filter(filtro).map((e) => e.id);
    if (ids.length === 0) return 0;
    const tanda = tandaParaNuevos();
    fijar({
      tanda,
      elementos: estado.elementos.map((e) =>
        ids.includes(e.id)
          ? { ...e, fase: "en_cola" as const, progreso: "En espera…", tanda, resultado: undefined, trabajoId: undefined }
          : e,
      ),
    });
    bombear();
    return ids.length;
  };

  return {
    getEstado: () => estado,
    suscribir(f: () => void) {
      oyentes.add(f);
      return () => {
        oyentes.delete(f);
      };
    },

    /** Añade a «seleccionados». Devuelve los rechazados (tipo o tamaño) para avisar. */
    añadirArchivos(files: File[]): { añadidos: number; rechazados: { nombre: string; motivo: string }[] } {
      const usados = new Set(estado.elementos.map((e) => e.nombre));
      const rechazados: { nombre: string; motivo: string }[] = [];
      const nuevos: ElementoCola[] = [];
      for (const file of files) {
        if (!TIPOS_PERMITIDOS.includes(file.type)) {
          rechazados.push({ nombre: file.name, motivo: "no es un PDF o imagen válida" });
          continue;
        }
        if (file.size > MAX_BYTES_ARCHIVO) {
          rechazados.push({ nombre: file.name, motivo: "supera los 10MB" });
          continue;
        }
        const nombre = nombreUnico(file, usados);
        const f = nombre === file.name ? file : new File([file], nombre, { type: file.type, lastModified: file.lastModified });
        nuevos.push({
          id: generarId(), nombre, file: f, preview: crearPreview(f), tamano: f.size,
          fase: "seleccionado", progreso: "", tanda: 0,
        });
      }
      if (nuevos.length > 0) fijar({ ...estado, elementos: [...estado.elementos, ...nuevos] });
      return { añadidos: nuevos.length, rechazados };
    },

    /** Quita un seleccionado o un terminado (los que están en marcha no se pueden quitar). */
    quitar(id: string) {
      const e = buscar(id);
      if (!e || (e.fase !== "seleccionado" && e.fase !== "terminado")) return;
      (e.previews ?? [e.preview]).forEach(revocarPreview);
      fijar({ ...estado, elementos: estado.elementos.filter((x) => x.id !== id) });
    },

    /**
     * Une fotos seleccionadas como UN documento (páginas 1..n en el orden de
     * `ids`). Solo fotos (no PDF) aún sin enviar; las ya unidas se aplanan.
     * Devuelve el id del documento nuevo o el motivo para avisar.
     */
    unir(ids: string[]): { id: string } | { error: string } {
      const elegidos = ids.map((i) => buscar(i)).filter((e): e is ElementoCola => !!e && e.fase === "seleccionado");
      const fotos = elegidos.flatMap((e) => e.fotos ?? (e.file ? [e.file] : []));
      const previews = elegidos.flatMap((e) => e.previews ?? [e.preview]);
      if (fotos.length < 2) return { error: "Elige al menos dos fotos para unirlas." };
      if (fotos.some((f) => !MIMES_UNIBLES.includes(f.type))) return { error: "Solo se pueden unir fotos (JPG, PNG o WEBP), no PDF." };
      if (fotos.length > MAX_PAGINAS_UNIDAS) return { error: `Como mucho ${MAX_PAGINAS_UNIDAS} páginas por documento.` };
      const usados = new Set(estado.elementos.filter((e) => !elegidos.includes(e)).map((e) => e.nombre));
      const base = fotos[0].name.replace(/\.[^.]+$/, "");
      let nombre = `${base} (${fotos.length} páginas)`;
      for (let n = 2; usados.has(nombre); n += 1) nombre = `${base} (${fotos.length} páginas) ${n}`;
      const nuevo: ElementoCola = {
        id: generarId(), nombre, file: fotos[0], fotos, previews, preview: previews[0] ?? "",
        tamano: fotos.reduce((t, f) => t + f.size, 0), fase: "seleccionado", progreso: "", tanda: 0,
      };
      const primero = estado.elementos.findIndex((e) => elegidos.includes(e));
      const resto = estado.elementos.filter((e) => !elegidos.includes(e));
      resto.splice(Math.max(0, Math.min(primero, resto.length)), 0, nuevo);
      fijar({ ...estado, elementos: resto });
      return { id: nuevo.id };
    },

    /** Deshace una unión: vuelven a ser fotos sueltas. */
    separar(id: string) {
      const e = buscar(id);
      if (!e || e.fase !== "seleccionado" || !e.fotos) return;
      const usados = new Set(estado.elementos.filter((x) => x.id !== id).map((x) => x.nombre));
      const sueltas: ElementoCola[] = e.fotos.map((f, i) => ({
        id: generarId(), nombre: nombreUnico(f, usados), file: f, preview: e.previews?.[i] ?? "", tamano: f.size,
        fase: "seleccionado", progreso: "", tanda: 0,
      }));
      const i = estado.elementos.findIndex((x) => x.id === id);
      const elementos = [...estado.elementos];
      elementos.splice(i, 1, ...sueltas);
      fijar({ ...estado, elementos });
    },

    /** Cambia el orden de las páginas de unas fotos unidas (arrastrar o flechas). */
    moverPagina(id: string, desde: number, hasta: number) {
      const e = buscar(id);
      if (!e || e.fase !== "seleccionado" || !e.fotos) return;
      const n = e.fotos.length;
      if (desde < 0 || desde >= n || hasta < 0 || hasta >= n || desde === hasta) return;
      function mover<T>(xs: T[]): T[] {
        const c = [...xs];
        const [x] = c.splice(desde, 1);
        c.splice(hasta, 0, x);
        return c;
      }
      const fotos = mover(e.fotos);
      const previews = e.previews ? mover(e.previews) : undefined;
      actualizar(id, { fotos, previews, file: fotos[0], preview: previews?.[0] ?? e.preview });
    },

    /** Envía TODOS los seleccionados. Se puede llamar con otros aún en marcha. */
    enviar: () => ponerEnCola((e) => e.fase === "seleccionado"),

    /** Vuelve a enviar los fallidos (o uno) que aún tienen el fichero en memoria. */
    reintentar: (id?: string) =>
      ponerEnCola((e) => e.fase === "terminado" && !e.resultado?.success && !!e.file && (id === undefined || e.id === id)),

    /** Quita de la lista los terminados (los pendientes de decidir siguen en su lista, que sale de la BD). */
    limpiarTerminados() {
      const quedan = estado.elementos.filter((e) => e.fase !== "terminado");
      estado.elementos.filter((e) => e.fase === "terminado").forEach((e) => (e.previews ?? [e.preview]).forEach(revocarPreview));
      fijar({ ...estado, elementos: quedan });
    },

    /**
     * Documentos (largos o de una página) que siguen en el servidor y no
     * están en la cola (se subieron antes de recargar la página): se siguen
     * igual que los propios.
     */
    adoptar(trabajos: Pick<EstadoTrabajo, "id" | "nombre_original" | "num_paginas" | "estado">[]) {
      const conocidos = new Set(estado.elementos.map((e) => e.trabajoId).filter(Boolean));
      const nuevos = trabajos.filter((t) => !conocidos.has(t.id));
      if (nuevos.length === 0) return 0;
      const tanda = tandaParaNuevos();
      const elementos: ElementoCola[] = nuevos.map((t) => ({
        id: generarId(), nombre: t.nombre_original, file: null, preview: "", tamano: 0,
        fase: "procesando", progreso: describirProgreso(t as EstadoTrabajo), tanda, trabajoId: t.id,
        piezas: t.num_paginas > 1 ? t.num_paginas : undefined,
      }));
      fijar({ tanda, elementos: [...estado.elementos, ...elementos] });
      for (const e of elementos) {
        void seguirTrabajo(e.id, e.nombre, e.trabajoId!, e.piezas)
          .catch((err): ResultadoProcesamiento => ({ nombre: e.nombre, success: false, error: mensajeError(err), piezas: e.piezas }))
          .then((r) => {
            terminar(e.id, r);
            comprobarFinTanda();
          });
      }
      return elementos.length;
    },

    /** La fila del documento que se ha añadido como página a una factura existente. */
    marcarPaginaAnadida(trabajoId: string, alertas: AlertaValidacion[] = []) {
      fijar({
        ...estado,
        elementos: estado.elementos.map((e) =>
          e.resultado?.anadible?.trabajo_id === trabajoId
            ? { ...e, resultado: { ...e.resultado, duplicado: false, paginaAnadida: true, anadible: null, sustituible: null, alertas } }
            : e,
        ),
      });
    },

    /** La fila del documento cuyo duplicado ya se ha sustituido. */
    marcarSustituida(trabajoId: string, alertas: AlertaValidacion[] = []) {
      fijar({
        ...estado,
        elementos: estado.elementos.map((e) =>
          e.resultado?.sustituible?.trabajo_id === trabajoId
            ? { ...e, resultado: { ...e.resultado, duplicado: false, sustituida: true, sustituible: null, alertas } }
            : e,
        ),
      });
    },
  };
}

// ── Lecturas derivadas (para el indicador, la barra y `beforeunload`) ───────

export const cuentaActivos = (s: EstadoCola) => s.elementos.filter((e) => FASES_ACTIVAS.includes(e.fase)).length;
export const hayEnNavegador = (s: EstadoCola) => s.elementos.some((e) => FASES_EN_NAVEGADOR.includes(e.fase));

/** Progreso de la tanda actual: «Procesando 2 de 5». `null` si no hay nada en marcha. */
export function progresoTanda(s: EstadoCola): { hechos: number; total: number } | null {
  if (cuentaActivos(s) === 0) return null;
  const deLaTanda = s.elementos.filter((e) => e.tanda === s.tanda && e.fase !== "seleccionado");
  return { hechos: deLaTanda.filter((e) => e.fase === "terminado").length, total: deLaTanda.length };
}

/** Texto del indicador global: «2 procesando · 1 por decidir». Vacío si no hay nada. */
export function textoIndicador(activos: number, porDecidir: number): string {
  const partes: string[] = [];
  if (activos > 0) partes.push(`${activos} procesando`);
  if (porDecidir > 0) partes.push(`${porDecidir} por decidir`);
  return partes.join(" · ");
}

/** Resumen de una tanda para la campana: «3 guardadas · 1 con avisos · 1 por decidir». */
export function textoResumenTanda(r: ResumenTanda): string {
  const c = r.porClase;
  const partes: string[] = [];
  const guardadas = c.guardada + c.sustituida;
  if (guardadas > 0) partes.push(`${guardadas} guardada${guardadas === 1 ? "" : "s"}`);
  if (c.avisos > 0) partes.push(`${c.avisos} con avisos`);
  if (c.sin_original > 0) partes.push(`${c.sin_original} sin original archivado`);
  if (c.pendiente > 0) partes.push(`${c.pendiente} por decidir (ya existían)`);
  if (c.duplicada > 0) partes.push(`${c.duplicada} ya existían`);
  if (c.fallida > 0) partes.push(`${c.fallida} fallida${c.fallida === 1 ? "" : "s"}`);
  return partes.join(" · ");
}

/**
 * ¿Se apunta el fin de la tanda en la campana? Solo si el usuario NO está
 * mirando la pestaña «Cargar» (ahí ya lo ve) o la pestaña del navegador está
 * oculta: la campana es para enterarse de lo que pasó mientras hacía otra cosa.
 */
export function debeAvisarEnCampana(pathname: string, search: string, oculta: boolean): boolean {
  if (oculta) return true;
  const enCargar = pathname === "/facturas" && new URLSearchParams(search).get("tab") === "cargar";
  return !enCargar;
}

// ── Dependencias reales (Supabase) ──────────────────────────────────────────

const convertirABase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("No se pudo leer el archivo"));
  });

/** Camino síncrono de una página (respaldo si el servidor no admite trabajos de una pieza). */
export async function procesarDocumentoUnico(file: File, nombre: string): Promise<ResultadoProcesamiento> {
  const base64 = await convertirABase64(file);
  const { data, error } = await supabase.functions.invoke("procesar-factura", {
    body: {
      tipo: "AUTO",
      archivo: { nombre, tipo: file.type, size: file.size, contenido_base64: base64 },
      fecha: new Date().toISOString(),
    },
  });
  if (error || !data?.success) {
    return { nombre, success: false, error: error?.message || data?.error || "Error desconocido" };
  }
  return aResultado(nombre, data);
}

export function depsSupabase(): Pick<
  DepsCola,
  "planificar" | "planificarGrupo" | "iniciarLargo" | "iniciarUnico" | "esperar" | "procesarUnico"
> {
  return {
    planificar: planificarDocumento,
    planificarGrupo: (fotos) => planificarGrupo(fotos),
    iniciarLargo: iniciarDocumentoLargo,
    iniciarUnico: (file) => iniciarDocumentoUnico(file),
    esperar: (id, onCambio) => esperarTrabajo(id, onCambio),
    procesarUnico: procesarDocumentoUnico,
  };
}
