import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Super Admin › Logs (migración 20261118100000_logs_web.sql).
 *
 * Todo pasa por la RLS de las tablas web_* (solo super admin) y por RPC
 * SECURITY INVOKER: un usuario sin permiso ve 0 filas aunque llame a mano.
 * Las acciones con efecto fuera (procesar, resumen de IA) van por Edge
 * Functions que vuelven a comprobar que es super admin.
 *
 * Sin tipos generados (como useServicios): la pantalla tiene que funcionar
 * aunque la migración aún no esté aplicada, y entonces lo dice.
 */
const sb = supabase as unknown as SupabaseClient;

export const CLAVE_LOGS = ["super-admin", "logs-web"] as const;

export type Entorno = "produccion" | "demo" | "local";
export type Categoria = "actividad" | "operacion" | "tecnico" | "error";
export type Gravedad = "info" | "aviso" | "error" | "critico";
export type EstadoIncidencia = "nueva" | "abierta" | "resuelta" | "reabierta" | "ignorada";

export interface EventoWeb {
  id: number;
  evento_id: string;
  recibido_en: string;
  ocurrido_en: string;
  entorno: Entorno;
  proyecto: string;
  fuente: string;
  categoria: Categoria;
  tipo: string;
  accion: string | null;
  sesion_id: string | null;
  visitante_id: string | null;
  secuencia: number | null;
  ruta: string | null;
  objetivo: string | null;
  valor: number | null;
  propiedades: Record<string, string | number | boolean>;
  dispositivo: string | null;
  navegador: string | null;
  so: string | null;
  es_bot: boolean;
  es_interno: boolean;
  es_prueba: boolean;
  consentimiento: boolean;
  version: string | null;
  despliegue: string | null;
  gravedad: Gravedad | null;
  huella: string | null;
  mensaje: string | null;
  pila: string | null;
  incidencia_id: number | null;
}

export interface SesionWeb {
  sesion_id: string;
  visitante_id: string | null;
  entorno: Entorno;
  proyecto: string;
  inicio: string;
  ultima_actividad: string;
  pagina_entrada: string | null;
  ultima_pagina: string | null;
  origen_tipo: string | null;
  origen_detalle: string | null;
  campana: string | null;
  idioma: string | null;
  dispositivo: string | null;
  navegador: string | null;
  so: string | null;
  paginas_vistas: number;
  eventos: number;
  errores: number;
  scroll_max: number | null;
  tiempo_activo_ms: number;
  inicio_operacion: boolean;
  conversiones: number;
  es_bot: boolean;
  es_interno: boolean;
  es_prueba: boolean;
  consentimiento: boolean;
}

export interface AnalisisIaIncidencia {
  impacto: string;
  hechos_observados: string[];
  hipotesis: Array<{ texto: string; confianza: "baja" | "media" | "alta" }>;
  pasos_reproduccion: string[];
  propuesta: string[];
  validacion: string[];
  falta_contexto: string[];
  modelo?: string;
}

export interface IncidenciaWeb {
  id: number;
  entorno: Entorno;
  huella: string;
  titulo: string;
  tipo: string;
  fuente: string;
  proyecto: string;
  gravedad: Gravedad;
  estado: EstadoIncidencia;
  primera_vez: string;
  ultima_vez: string;
  ocurrencias: number;
  sesiones_afectadas: number;
  ocurrencias_ventana: number;
  sesiones_ventana: number;
  ocurrencias_24h: number;
  rutas: Array<{ ruta: string; n: number }>;
  version_primera: string | null;
  version_ultima: string | null;
  despliegue_ultimo: string | null;
  mensaje: string | null;
  pila: string | null;
  requiere_ticket: boolean;
  motivo_ticket: string | null;
  linear_estado: "sin_ticket" | "pendiente" | "creado" | "error" | "no_aplica";
  linear_issue_id: string | null;
  linear_identificador: string | null;
  linear_url: string | null;
  linear_estado_remoto: string | null;
  linear_destino: "prueba" | "real" | null;
  linear_intentos: number;
  linear_ultimo_error: string | null;
  linear_proximo_intento: string | null;
  linear_creado_en: string | null;
  linear_pendiente_reapertura: boolean;
  analisis_ia: AnalisisIaIncidencia | null;
  analisis_ia_en: string | null;
  analisis_ia_error: string | null;
  resuelta_en: string | null;
  reabierta_veces: number;
  nota: string | null;
}

export interface ConfigLogsWeb {
  recoger_actividad: boolean;
  recoger_errores_navegador: boolean;
  recoger_peticiones: boolean;
  recoger_errores_servidor: boolean;
  recoger_integraciones: boolean;
  recoger_hosting: boolean;
  entornos_aceptados: Entorno[];
  entornos_ticket: Entorno[];
  rutas_excluidas: string[];
  mensajes_ignorados: string[];
  umbral_ocurrencias: number;
  umbral_sesiones: number;
  umbral_ventana_horas: number;
  tickets_404: boolean;
  umbral_404_diario: number;
  excluir_pruebas_tickets: boolean;
  reapertura: "reabrir" | "nuevo_ticket" | "ignorar";
  retencion_actividad_dias: number;
  retencion_errores_dias: number;
  limite_eventos_dia: number;
  limite_eventos_sesion: number;
  limite_eventos_ip_minuto: number;
  linear_modo: "desactivado" | "prueba" | "real";
  linear_equipo_id: string | null;
  linear_proyecto_id: string | null;
  linear_etiquetas: string[];
  linear_estado_reabrir_id: string | null;
  linear_max_tickets_dia: number;
  ia_activada: boolean;
  ia_max_analisis_dia: number;
  entorno_bd: Entorno;
  actualizado_en: string;
}

export type CambiosConfigLogs = Partial<Omit<ConfigLogsWeb, "entorno_bd" | "actualizado_en">>;

export interface EstadoRecogidaDatos {
  ahora: string;
  entorno: Entorno;
  fuentes: Array<{ fuente: string; ultimo_recibido: string | null; n_1h: number; n_24h: number }>;
  primer_evento: string | null;
  primer_evento_por_categoria: Record<string, string>;
  primer_evento_por_tipo: Record<string, string>;
  ingesta: Array<{ dia: string; aceptados: number; duplicados: number; descartados: number; rechazados: number; bots: number; lotes: number }>;
  proceso: {
    ultimo_proceso_inicio: string | null;
    ultimo_proceso_fin: string | null;
    ultimo_proceso_ok: string | null;
    ultimo_error: string | null;
    ultimo_resumen: Record<string, unknown>;
    ultima_purga: string | null;
  } | null;
  config: { linear_modo: string; entornos_aceptados: string[]; entornos_ticket: string[]; recoger_actividad: boolean; recoger_errores_navegador: boolean } | null;
  vercel_ultimo_dia: { fecha: string; visitas: number } | null;
}

export interface CatalogoEvento {
  tipo: string;
  categoria: Categoria;
  fuente: string;
  operacion: string | null;
  etapa_embudo: number | null;
  requiere_consentimiento: boolean;
  descripcion: string;
  orden: number;
}

export interface FiltrosActividad {
  desde: string; // ISO
  hasta: string; // ISO
  entorno: Entorno | null;
  texto: string;
  ruta: string | null;
  tipo: string | null;
  origen: string | null;
  dispositivo: string | null;
  categoria: Categoria | null;
  fuente: string | null;
  gravedad: Gravedad | null;
  conError: boolean | null;
  conConversion: boolean | null;
  incluirInternos: boolean;
  incluirBots: boolean;
}

export interface FiltrosIncidencias {
  entorno: Entorno | null;
  estado: EstadoIncidencia | "activas" | null;
  gravedad: Gravedad | null;
  fuente: string | null;
  texto: string;
}

export const TAM_PAGINA = 25;

/** ¿El error dice que falta la migración (tabla o función inexistente)? */
export function esSinMigracionLogs(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  if (!e) return false;
  return e.code === "42P01" || e.code === "42883" || e.code === "PGRST202" || e.code === "PGRST205"
    || (/web_(eventos|sesiones|incidencias|logs|comportamiento|buscar)/.test(e.message ?? "") && /does not exist|could not find|schema cache/i.test(e.message ?? ""));
}

const lanzar = (error: { message: string; code?: string } | null) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
};

// ─── Configuración y entorno de esta base de datos ───────────────────────────
export function useConfigLogs() {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "config"],
    staleTime: 60_000,
    queryFn: async (): Promise<ConfigLogsWeb> => {
      const { data, error } = await sb.from("web_logs_config").select("*").eq("id", true).single();
      lanzar(error);
      return data as ConfigLogsWeb;
    },
  });
}

export function useGuardarConfigLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (cambios: CambiosConfigLogs) => {
      const { error } = await sb.from("web_logs_config").update(cambios).eq("id", true);
      lanzar(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_LOGS }),
  });
}

export function useCatalogoEventos() {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "catalogo"],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<CatalogoEvento[]> => {
      const { data, error } = await sb.from("web_eventos_catalogo").select("*").order("orden");
      lanzar(error);
      return (data ?? []) as CatalogoEvento[];
    },
  });
}

// ─── Salud de la recogida ────────────────────────────────────────────────────
export function useEstadoRecogida(entorno: Entorno | null, autoRefresco: number | false) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "estado", entorno],
    enabled: entorno !== null,
    refetchInterval: autoRefresco,
    refetchIntervalInBackground: false,
    staleTime: 15_000,
    queryFn: async (): Promise<EstadoRecogidaDatos> => {
      const { data, error } = await sb.rpc("web_logs_estado_recogida", { p_entorno: entorno });
      lanzar(error);
      return data as EstadoRecogidaDatos;
    },
  });
}

// ─── Actividad ───────────────────────────────────────────────────────────────
export function useSesiones(f: FiltrosActividad, pagina: number, autoRefresco: number | false) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "sesiones", f, pagina],
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresco,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    queryFn: async (): Promise<{ filas: SesionWeb[]; total: number }> => {
      const { data, error } = await sb.rpc("web_buscar_sesiones", {
        p_desde: f.desde, p_hasta: f.hasta, p_entorno: f.entorno, p_ruta: f.ruta, p_tipo: f.tipo, p_origen: f.origen,
        p_dispositivo: f.dispositivo, p_texto: f.texto || null, p_con_error: f.conError, p_con_conversion: f.conConversion,
        p_incluir_internos: f.incluirInternos, p_incluir_bots: f.incluirBots, p_limite: TAM_PAGINA, p_offset: pagina * TAM_PAGINA,
      });
      lanzar(error);
      const filas = (data ?? []) as Array<{ sesion: SesionWeb; total: number }>;
      return { filas: filas.map((x) => x.sesion), total: Number(filas[0]?.total ?? 0) };
    },
  });
}

export function useEventos(f: FiltrosActividad, pagina: number, autoRefresco: number | false, tam = 50) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "eventos", f, pagina, tam],
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresco,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    queryFn: async (): Promise<{ filas: EventoWeb[]; total: number }> => {
      const { data, error } = await sb.rpc("web_buscar_eventos", {
        p_desde: f.desde, p_hasta: f.hasta, p_entorno: f.entorno, p_categoria: f.categoria, p_tipo: f.tipo, p_ruta: f.ruta,
        p_fuente: f.fuente, p_gravedad: f.gravedad, p_dispositivo: f.dispositivo, p_texto: f.texto || null,
        p_incluir_internos: f.incluirInternos, p_incluir_bots: f.incluirBots, p_limite: tam, p_offset: pagina * tam,
      });
      lanzar(error);
      const filas = (data ?? []) as Array<{ evento: EventoWeb; total: number }>;
      return { filas: filas.map((x) => x.evento), total: Number(filas[0]?.total ?? 0) };
    },
  });
}

/** Una sesión entera, en orden cronológico (ocurrido_en y, a igualdad, la secuencia del navegador). */
export function useSesion(sesionId: string | null) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "sesion", sesionId],
    enabled: !!sesionId,
    staleTime: 15_000,
    queryFn: async (): Promise<{ sesion: SesionWeb | null; eventos: EventoWeb[] }> => {
      const [s, e] = await Promise.all([
        sb.from("web_sesiones").select("*").eq("sesion_id", sesionId).maybeSingle(),
        sb.from("web_eventos").select("*").eq("sesion_id", sesionId)
          .order("ocurrido_en", { ascending: true }).order("secuencia", { ascending: true, nullsFirst: false }).order("id").limit(1000),
      ]);
      lanzar(s.error);
      lanzar(e.error);
      return { sesion: (s.data ?? null) as SesionWeb | null, eventos: (e.data ?? []) as EventoWeb[] };
    },
  });
}

// ─── Incidencias ─────────────────────────────────────────────────────────────
export function useIncidencias(f: FiltrosIncidencias, pagina: number, autoRefresco: number | false) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "incidencias", f, pagina],
    placeholderData: keepPreviousData,
    refetchInterval: autoRefresco,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
    queryFn: async (): Promise<{ filas: IncidenciaWeb[]; total: number }> => {
      let q = sb.from("web_incidencias").select("*", { count: "exact" });
      if (f.entorno) q = q.eq("entorno", f.entorno);
      if (f.estado === "activas") q = q.in("estado", ["nueva", "abierta", "reabierta"]);
      else if (f.estado) q = q.eq("estado", f.estado);
      if (f.gravedad) q = q.eq("gravedad", f.gravedad);
      if (f.fuente) q = q.eq("fuente", f.fuente);
      const texto = f.texto.trim().replace(/[%,()]/g, " ");
      if (texto) q = q.or(`titulo.ilike.%${texto}%,mensaje.ilike.%${texto}%,linear_identificador.ilike.%${texto}%`);
      const { data, error, count } = await q.order("ultima_vez", { ascending: false }).range(pagina * TAM_PAGINA, pagina * TAM_PAGINA + TAM_PAGINA - 1);
      lanzar(error);
      return { filas: (data ?? []) as IncidenciaWeb[], total: count ?? 0 };
    },
  });
}

export function useIncidencia(id: number | null) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "incidencia", id],
    enabled: id !== null,
    staleTime: 10_000,
    queryFn: async (): Promise<IncidenciaWeb | null> => {
      const { data, error } = await sb.from("web_incidencias").select("*").eq("id", id).maybeSingle();
      lanzar(error);
      return (data ?? null) as IncidenciaWeb | null;
    },
  });
}

export function useOcurrencias(incidenciaId: number | null, pagina: number) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "ocurrencias", incidenciaId, pagina],
    enabled: incidenciaId !== null,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ filas: EventoWeb[]; total: number }> => {
      const { data, error, count } = await sb.from("web_eventos").select("*", { count: "exact" }).eq("incidencia_id", incidenciaId)
        .order("ocurrido_en", { ascending: false }).range(pagina * 10, pagina * 10 + 9);
      lanzar(error);
      return { filas: (data ?? []) as EventoWeb[], total: count ?? 0 };
    },
  });
}

/** Lo que pasó antes y después de un evento en la misma sesión. */
export function useContextoEvento(eventoId: number | null) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "contexto", eventoId],
    enabled: eventoId !== null,
    queryFn: async (): Promise<EventoWeb[]> => {
      const { data, error } = await sb.rpc("web_contexto_evento", { p_evento_id: eventoId, p_antes: 15, p_despues: 10 });
      lanzar(error);
      return ((data ?? []) as EventoWeb[]).sort(
        (a, b) => a.ocurrido_en.localeCompare(b.ocurrido_en) || (a.secuencia ?? 0) - (b.secuencia ?? 0) || a.id - b.id,
      );
    },
  });
}

/** Lo que se mandó al destino de pruebas de Linear para una incidencia. */
export function useEnviosPrueba(incidenciaId: number | null) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "linear-prueba", incidenciaId],
    enabled: incidenciaId !== null,
    queryFn: async () => {
      const { data, error } = await sb.from("web_linear_prueba").select("*").eq("incidencia_id", incidenciaId).order("creado_en", { ascending: false }).limit(20);
      lanzar(error);
      return (data ?? []) as Array<{ id: number; creado_en: string; operacion: string; titulo: string | null; cuerpo: string | null; prioridad: number | null }>;
    },
  });
}

export function useCambiarIncidencia() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, estado, nota }: { id: number; estado?: EstadoIncidencia; nota?: string | null }) => {
      const cambios: Record<string, unknown> = {};
      if (estado) cambios.estado = estado;
      if (nota !== undefined) cambios.nota = nota;
      const { data, error } = await sb.from("web_incidencias").update(cambios).eq("id", id).select("id");
      lanzar(error);
      if (!data?.length) throw new Error("No se ha guardado: solo un super admin puede cambiar incidencias.");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_LOGS }),
  });
}

export function usePedirTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await sb.rpc("web_incidencia_pedir_ticket", { p_id: id });
      lanzar(error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_LOGS }),
  });
}

async function mensajeFuncion(nombre: string, error: unknown): Promise<string> {
  const e = error as { name?: string; context?: { status?: number; json?: () => Promise<{ error?: string; mensaje?: string }> } };
  if (e?.name === "FunctionsFetchError" || e?.name === "FunctionsRelayError") return `No se pudo contactar con la función «${nombre}» (¿está desplegada?).`;
  const cuerpo = await e?.context?.json?.().catch(() => null);
  if (e?.context?.status === 403) return "Solo un super admin puede hacer esto.";
  if (e?.context?.status === 401) return "Tu sesión ha caducado: vuelve a entrar.";
  if (cuerpo?.error === "sin_clave_ia") return "No hay clave de IA configurada en el servidor.";
  if (cuerpo?.error === "sin_datos") return cuerpo.mensaje ?? "No hay datos en este periodo.";
  if (cuerpo?.error === "ia_fallo") return `La IA no ha respondido: ${cuerpo.mensaje ?? "inténtalo más tarde"}.`;
  return `La función «${nombre}» ha fallado${cuerpo?.error ? ` (${cuerpo.error})` : ""}.`;
}

export function useProcesarAhora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<Record<string, unknown>>("procesar-logs-web", { body: { origen: "panel" } });
      if (error) throw new Error(await mensajeFuncion("procesar-logs-web", error));
      return data ?? {};
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: CLAVE_LOGS }),
  });
}

// ─── Estadísticas de comportamiento (también las usa Tráfico web) ────────────
export interface FilaContenido { tipo: string; objetivo: string; n: number; sesiones: number }
export interface Embudo { operacion: "reserva" | "cheque"; entrada: number; consulta: number; inicio: number; envio: number; fin: number; rechazos: number }
export interface ResumenComportamiento {
  sesiones: number;
  visitantes_estimados: number;
  paginas_vistas: number;
  paginas_por_sesion: number | null;
  sesiones_una_pagina: number;
  tiempo_activo_medio_s: number | null;
  tiempo_activo_mediana_s: number | null;
  scroll_medio: number | null;
  sesiones_inicio_operacion: number;
  sesiones_con_conversion: number;
  conversiones: number;
  errores: number;
  sesiones_con_error: number;
}
export interface Comportamiento {
  periodo: { desde: string; hasta: string; dias: number; zona: string; entorno: Entorno };
  datos_desde: string | null;
  resumen: ResumenComportamiento;
  anterior: ResumenComportamiento;
  excluidas: { bots: number; internas_pruebas: number; incluidas_internas: boolean };
  serie: Array<{ dia: string; sesiones: number; paginas_vistas: number; conversiones: number; errores: number }>;
  paginas: Array<{ ruta: string; vistas: number; sesiones: number; tiempo_medio_s: number | null; scroll_medio: number | null }>;
  contenidos: FilaContenido[];
  clics: Array<{ tipo: string; accion: string | null; objetivo: string; n: number; sesiones: number }>;
  contactos: Array<{ accion: string; n: number; sesiones: number }>;
  busquedas: { total: number; sin_resultados: number; sesiones: number };
  filtros: Array<{ accion: string | null; objetivo: string; n: number }>;
  origenes: Array<{ origen_tipo: string; sesiones: number; sesiones_con_conversion: number }>;
  campanas: Array<{ origen_tipo: string; nombre: string | null; sesiones: number; inicios: number; sesiones_con_conversion: number }>;
  dispositivos: Array<{ dispositivo: string; sesiones: number; sesiones_con_conversion: number }>;
  horas: Array<{ hora: number; sesiones: number }>;
  dias_semana: Array<{ dia: number; sesiones: number }>;
  tiempo: { menos_10s: number; de_10s_a_1m: number; de_1m_a_3m: number; mas_3m: number };
  scroll: { hasta_25: number; de_25_a_50: number; de_50_a_75: number; de_75_a_100: number; vistas_medidas: number };
  recorridos: Array<{ recorrido: string; sesiones: number }>;
  ultimas_paginas: Array<{ ruta: string; sesiones: number }>;
  embudos: Embudo[];
  formularios: Array<{ objetivo: string; inicios: number; envios: number; abandonos: number; errores_validacion: number }>;
  errores_por_ruta: Array<{ ruta: string; tipo: string; n: number; sesiones: number }>;
  errores_por_operacion: Array<{ operacion: string; n: number; sesiones: number }>;
  operaciones_bd: { reservas_web: number; reservas_confirmadas: number; cheques_web: number };
}

export async function pedirComportamiento(desde: string, hasta: string, entorno: Entorno, incluirInternos: boolean): Promise<Comportamiento> {
  const { data, error } = await sb.rpc("web_comportamiento", { p_desde: desde, p_hasta: hasta, p_entorno: entorno, p_incluir_internos: incluirInternos });
  lanzar(error);
  return data as Comportamiento;
}

export function useComportamiento(desde: string | null, hasta: string | null, entorno: Entorno | null, incluirInternos = false) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "comportamiento", desde, hasta, entorno, incluirInternos],
    enabled: !!desde && !!hasta && !!entorno,
    staleTime: 5 * 60_000,
    queryFn: () => pedirComportamiento(desde!, hasta!, entorno!, incluirInternos),
  });
}

export interface ConclusionIa { texto: string; cifras: string[]; tipo: "observacion" | "hipotesis" }
export interface ResumenIaPeriodo {
  id: number;
  creado_en: string;
  desde: string;
  hasta: string;
  entorno: Entorno;
  modelo: string | null;
  cache?: boolean;
  resumen: { cambios: ConclusionIa[]; contenido_mejor: ConclusionIa[]; perdidas: ConclusionIa[]; problemas: ConclusionIa[]; mejoras: ConclusionIa[]; descartadas: number; limitaciones: string[] } | null;
}

/** Último resumen de IA guardado para ese periodo (no llama a la IA). */
export function useUltimoResumenIa(desde: string | null, hasta: string | null, entorno: Entorno | null) {
  return useQuery({
    queryKey: [...CLAVE_LOGS, "resumen-ia", desde, hasta, entorno],
    enabled: !!desde && !!hasta && !!entorno,
    queryFn: async (): Promise<ResumenIaPeriodo | null> => {
      const { data, error } = await sb.from("web_resumenes_ia").select("id, creado_en, desde, hasta, entorno, modelo, resumen")
        .eq("desde", desde).eq("hasta", hasta).eq("entorno", entorno).eq("estado", "ok").order("creado_en", { ascending: false }).limit(1);
      lanzar(error);
      return ((data ?? [])[0] ?? null) as ResumenIaPeriodo | null;
    },
  });
}

export function useGenerarResumenIa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (p: { desde: string; hasta: string; entorno: Entorno; forzar: boolean }): Promise<ResumenIaPeriodo> => {
      const { data, error } = await supabase.functions.invoke<ResumenIaPeriodo>("resumen-logs-web", { body: p });
      if (error) throw new Error(await mensajeFuncion("resumen-logs-web", error));
      return data as ResumenIaPeriodo;
    },
    onSuccess: (_d, p) => qc.invalidateQueries({ queryKey: [...CLAVE_LOGS, "resumen-ia", p.desde, p.hasta, p.entorno] }),
  });
}
