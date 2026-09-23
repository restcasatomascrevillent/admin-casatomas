// ============================================================================
// sync-trafico-web / sync.ts — lógica pura (sin imports remotos)
// ============================================================================
// index.ts solo construye el cliente de Supabase y llama a procesarPeticion.
// Todo lo que decide algo (auth, rango, fusión de filas, estado, aviso, código
// HTTP) vive aquí para poder probarlo con vitest sin red ni base de datos.
//
// Tablas (supabase/migrations/20260923200000_trafico_web.sql):
//   trafico_web_diario      PK (fecha, proyecto, ruta)   ruta '*' = total
//   trafico_web_desglose    PK (fecha, proyecto, dimension, valor)
//   trafico_web_sync_estado PK proyecto
// Aviso: notificaciones_dashboard tipo 'sistema', origen NULL (el CHECK de
// origen admite NULL), máx. 1 por día UTC (R3).
// ============================================================================

import {
  DIMENSION_DESGLOSE,
  ErrorVercel,
  type ClienteVercel,
  type DimensionApi,
  type DimensionDesglose,
  type FilaVercel,
} from "./vercel.ts";

// ---------------------------------------------------------------------------
// Proyectos
// ---------------------------------------------------------------------------
export type SlugProyecto = "casa-tomas-story" | "touza-restaurant-website";

export const PROYECTOS: ReadonlyArray<{ slug: SlugProyecto; projectId: string }> = [
  { slug: "casa-tomas-story", projectId: "prj_c2Wks17JsKHSG5slQ8zRlLI5Vkgu" },
  { slug: "touza-restaurant-website", projectId: "prj_uyKzP43QuXo1hfFrTj2jataWbnqb" },
];

/** Hobby da 31 días; 30 deja margen por la frontera de medianoche UTC. */
export const DIAS_BACKFILL = 30;
/** Runs normales re-sincronizan los últimos 3 días cerrados. */
export const DIAS_RESYNC = 3;
export const RUTA_TOTAL = "*";
export const TITULO_AVISO_PREFIJO = "Tráfico web:";

// ---------------------------------------------------------------------------
// Autenticación (fail closed, comparación en tiempo constante)
// ---------------------------------------------------------------------------
export function compararTiempoConstante(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Fechas (todo en UTC: la API da medianoche UTC y current_date en Supabase es UTC)
// ---------------------------------------------------------------------------
export function fechaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return fechaUtc(d);
}

export function diasEntre(desde: string, hasta: string): number {
  const ms = Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1; // inclusivo
}

export interface Rango {
  desde: string;
  hasta: string;
  dias: number;
  backfill: boolean;
}

/**
 * - Nunca sincronizado (ultimo_ok_en NULL) -> backfill hoy-30 .. ayer.
 * - Normal -> hoy-3 .. ayer.
 * - Si el último éxito es antiguo (caída de varios días), se amplía hacia
 *   atrás para cerrar el hueco: desde = fecha(ultimo_ok) - 2, sin pasar de
 *   hoy-30 (límite Hobby).
 * Hoy no se sincroniza nunca: el día está abierto.
 */
export function calcularRango(ultimoOkEn: string | null, ahora: Date): Rango {
  const hoy = fechaUtc(ahora);
  const hasta = sumarDias(hoy, -1);
  const minimo = sumarDias(hoy, -DIAS_BACKFILL);
  let desde: string;
  let backfill = false;
  const ok = ultimoOkEn ? new Date(ultimoOkEn) : null;
  if (!ok || Number.isNaN(ok.getTime())) {
    desde = minimo;
    backfill = true;
  } else {
    const normal = sumarDias(hoy, -DIAS_RESYNC);
    // ok en el día X cubrió hasta X-1; re-sincronizar sus 2 últimos días + hueco.
    const recuperar = sumarDias(fechaUtc(ok), -(DIAS_RESYNC - 1));
    desde = recuperar < normal ? recuperar : normal;
    if (desde < minimo) desde = minimo;
  }
  return { desde, hasta, dias: diasEntre(desde, hasta), backfill };
}

// ---------------------------------------------------------------------------
// Filas para la base de datos
// ---------------------------------------------------------------------------
export interface FilaDiario {
  fecha: string;
  proyecto: SlugProyecto;
  ruta: string;
  visitas: number;
  visitantes: number | null;
  sincronizado_en: string;
}

export interface FilaDesglose {
  fecha: string;
  proyecto: SlugProyecto;
  dimension: DimensionDesglose;
  valor: string;
  visitas: number;
  visitantes: number | null;
  sincronizado_en: string;
}

/**
 * Agrupa por (fecha, valor). Hace falta porque dos valores distintos de la
 * API pueden normalizarse al mismo (p.ej. '' y null -> '(directo)') y un
 * upsert con dos filas de la misma PK falla ("cannot affect row a second
 * time"). visitas se suman; visitantes NO se pueden sumar (no son únicos
 * entre grupos) -> NULL si hubo fusión o si alguna fila no lo traía.
 */
export function fusionarPorClave(filas: FilaVercel[]): Array<{ fecha: string; valor: string; visitas: number; visitantes: number | null }> {
  const m = new Map<string, { fecha: string; valor: string; visitas: number; visitantes: number | null; n: number }>();
  for (const f of filas) {
    const valor = f.valor ?? RUTA_TOTAL;
    const k = `${f.fecha}\u0000${valor}`;
    const prev = m.get(k);
    if (!prev) m.set(k, { fecha: f.fecha, valor, visitas: f.visitas, visitantes: f.visitantes, n: 1 });
    else {
      prev.visitas += f.visitas;
      prev.visitantes = null;
      prev.n++;
    }
  }
  return [...m.values()].map(({ n: _n, ...r }) => r);
}

/**
 * Totales diarios (ruta '*').
 *  - Fuente principal: by=day solo. Si un día trae menos visitas que la suma
 *    de sus rutas (no debería), se toma la suma para que el remanente de la
 *    RPC de FDT no salga negativo.
 *  - Fallback (by=day rechazado): suma de filas por ruta. Es una COTA
 *    INFERIOR (solo top 100 rutas) y visitantes = NULL (no sumables).
 */
export function calcularTotales(
  totalesApi: FilaVercel[] | null,
  filasRuta: FilaVercel[] | null,
): Array<{ fecha: string; visitas: number; visitantes: number | null }> {
  const sumaRutas = new Map<string, number>();
  for (const f of filasRuta ?? []) sumaRutas.set(f.fecha, (sumaRutas.get(f.fecha) ?? 0) + f.visitas);

  if (totalesApi && totalesApi.length > 0) {
    const porFecha = new Map<string, { visitas: number; visitantes: number | null }>();
    for (const f of totalesApi) {
      const prev = porFecha.get(f.fecha);
      if (!prev) porFecha.set(f.fecha, { visitas: f.visitas, visitantes: f.visitantes });
      else {
        prev.visitas += f.visitas;
        prev.visitantes = null;
      }
    }
    // Días que solo aparecen en rutas (no deberían existir): se añaden.
    for (const [fecha, v] of sumaRutas) if (!porFecha.has(fecha)) porFecha.set(fecha, { visitas: v, visitantes: null });
    return [...porFecha.entries()]
      .map(([fecha, t]) => {
        const s = sumaRutas.get(fecha) ?? 0;
        return s > t.visitas ? { fecha, visitas: s, visitantes: t.visitantes } : { fecha, ...t };
      })
      .sort((a, b) => a.fecha.localeCompare(b.fecha));
  }
  return [...sumaRutas.entries()]
    .map(([fecha, visitas]) => ({ fecha, visitas, visitantes: null }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha));
}

// ---------------------------------------------------------------------------
// Dependencias inyectables
// ---------------------------------------------------------------------------
export interface EstadoSync {
  ultimo_ok_en: string | null;
  fallos_consecutivos: number;
}

export interface FilaEstado {
  proyecto: SlugProyecto;
  ultimo_intento_en: string;
  ultimo_ok_en?: string;
  ultimo_error: string | null;
  fallos_consecutivos: number;
  dias_ultimo_sync?: number;
}

export interface Repositorio {
  leerEstado(proyecto: SlugProyecto): Promise<EstadoSync | null>;
  upsertDiario(filas: FilaDiario[]): Promise<void>;
  upsertDesglose(filas: FilaDesglose[]): Promise<void>;
  guardarEstado(fila: FilaEstado): Promise<void>;
  /** ¿Hay ya un aviso de tráfico web creado desde este instante? */
  existeAvisoDesde(desdeIso: string): Promise<boolean>;
  crearAviso(aviso: { titulo: string; mensaje: string }): Promise<void>;
}

export interface Dependencias {
  vercel: ClienteVercel;
  repo: Repositorio;
  ahora: () => Date;
  log?: (msg: string) => void;
}

// ---------------------------------------------------------------------------
// Sincronizar un proyecto
// ---------------------------------------------------------------------------
export interface ResultadoProyecto {
  ok: boolean;
  desde?: string;
  hasta?: string;
  dias?: number;
  backfill?: boolean;
  filas?: { diario: number; desglose: number };
  total_origen?: "by_day" | "suma_rutas";
  avisos: string[];
  error?: string;
}

const DIMENSIONES_DESGLOSE: Array<Exclude<DimensionApi, "requestPath">> = ["deviceType", "country", "referrerHostname"];

function mensajeError(e: unknown): string {
  const s = e instanceof Error ? e.message : String(e);
  return s.length > 1000 ? `${s.slice(0, 1000)}…` : s;
}

/** by=day solo no está verificado: solo un 4xx NO reintentable (distinto de auth) activa el fallback. */
function admiteFallbackTotales(e: unknown): boolean {
  return e instanceof ErrorVercel && e.status !== null && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 403 && e.status !== 429;
}

export async function sincronizarProyecto(
  proyecto: { slug: SlugProyecto; projectId: string },
  deps: Dependencias,
): Promise<ResultadoProyecto> {
  const log = deps.log ?? (() => {});
  const inicio = deps.ahora();
  const ahoraIso = inicio.toISOString();
  const avisos: string[] = [];
  let estado: EstadoSync | null = null;

  try {
    estado = await deps.repo.leerEstado(proyecto.slug);
    const rango = calcularRango(estado?.ultimo_ok_en ?? null, inicio);
    const { desde, hasta } = rango;

    // 1) Rutas (top 100). Un fallo aquí no es fatal si by=day funciona.
    let filasRuta: FilaVercel[] | null = null;
    let errorRutas: unknown = null;
    try {
      const r = await deps.vercel.aggregate(proyecto.projectId, desde, hasta, "requestPath");
      filasRuta = r.filas;
      if (r.descartadas) avisos.push(`requestPath: ${r.descartadas} fila(s) descartada(s) sin fecha/pageviews`);
    } catch (e) {
      errorRutas = e;
      avisos.push(`requestPath falló: ${mensajeError(e)}`);
    }

    // 2) Totales por día (by=day solo; fallback a suma de rutas).
    let totalesApi: FilaVercel[] | null = null;
    let totalOrigen: "by_day" | "suma_rutas" = "by_day";
    try {
      const r = await deps.vercel.aggregate(proyecto.projectId, desde, hasta, null);
      totalesApi = r.filas;
      if (r.filas.length === 0 && (filasRuta?.length ?? 0) > 0) {
        totalOrigen = "suma_rutas";
        avisos.push("by=day devolvió 0 filas: total = suma de rutas (cota inferior, top 100)");
      }
    } catch (e) {
      if (!admiteFallbackTotales(e) || filasRuta === null) throw e;
      totalOrigen = "suma_rutas";
      avisos.push(`by=day rechazado (${mensajeError(e)}): total = suma de rutas (cota inferior, top 100)`);
    }
    if (errorRutas && totalesApi === null) throw errorRutas;

    const sincronizadoEn = deps.ahora().toISOString();
    const totales = calcularTotales(totalesApi, filasRuta);
    const filasDiario: FilaDiario[] = [
      ...totales.map((t) => ({ ...t, proyecto: proyecto.slug, ruta: RUTA_TOTAL, sincronizado_en: sincronizadoEn })),
      ...fusionarPorClave(filasRuta ?? []).map((f) => ({
        fecha: f.fecha,
        proyecto: proyecto.slug,
        ruta: f.valor,
        visitas: f.visitas,
        visitantes: f.visitantes,
        sincronizado_en: sincronizadoEn,
      })),
    ];

    // 3) Desgloses: una dimensión que falle solo genera aviso.
    const filasDesglose: FilaDesglose[] = [];
    for (const dimApi of DIMENSIONES_DESGLOSE) {
      try {
        const r = await deps.vercel.aggregate(proyecto.projectId, desde, hasta, dimApi);
        if (r.descartadas) avisos.push(`${dimApi}: ${r.descartadas} fila(s) descartada(s)`);
        for (const f of fusionarPorClave(r.filas)) {
          filasDesglose.push({
            fecha: f.fecha,
            proyecto: proyecto.slug,
            dimension: DIMENSION_DESGLOSE[dimApi],
            valor: f.valor,
            visitas: f.visitas,
            visitantes: f.visitantes,
            sincronizado_en: sincronizadoEn,
          });
        }
      } catch (e) {
        avisos.push(`${dimApi} falló: ${mensajeError(e)}`);
      }
    }

    // 4) Upsert idempotente (PK) + estado OK.
    await deps.repo.upsertDiario(filasDiario);
    await deps.repo.upsertDesglose(filasDesglose);
    await deps.repo.guardarEstado({
      proyecto: proyecto.slug,
      ultimo_intento_en: ahoraIso,
      ultimo_ok_en: deps.ahora().toISOString(),
      ultimo_error: null,
      fallos_consecutivos: 0,
      dias_ultimo_sync: rango.dias,
    });
    for (const a of avisos) log(`[sync-trafico-web] ${proyecto.slug}: ${a}`);
    return {
      ok: true,
      desde,
      hasta,
      dias: rango.dias,
      backfill: rango.backfill,
      filas: { diario: filasDiario.length, desglose: filasDesglose.length },
      total_origen: totalOrigen,
      avisos,
    };
  } catch (e) {
    const error = mensajeError(e);
    log(`[sync-trafico-web] ${proyecto.slug}: ERROR ${error}`);
    try {
      await deps.repo.guardarEstado({
        proyecto: proyecto.slug,
        ultimo_intento_en: ahoraIso,
        ultimo_error: error,
        fallos_consecutivos: (estado?.fallos_consecutivos ?? 0) + 1,
      });
    } catch (e2) {
      log(`[sync-trafico-web] ${proyecto.slug}: no se pudo guardar el estado de error: ${mensajeError(e2)}`);
    }
    return { ok: false, avisos, error };
  }
}

// ---------------------------------------------------------------------------
// Aviso (R3: al primer fallo, máx. 1 por día UTC)
// ---------------------------------------------------------------------------
export function inicioDiaUtcIso(d: Date): string {
  return `${fechaUtc(d)}T00:00:00.000Z`;
}

export function construirAviso(fallidos: Array<{ slug: SlugProyecto; error: string }>): { titulo: string; mensaje: string } {
  const nombres = fallidos.map((f) => f.slug).join(", ");
  return {
    titulo: `${TITULO_AVISO_PREFIJO} fallo al sincronizar ${nombres}`,
    mensaje:
      fallidos.map((f) => `${f.slug}: ${f.error}`).join("\n") +
      "\nLa función sync-trafico-web lo reintentará en el próximo cron (03:30 UTC). Estado en trafico_web_sync_estado.",
  };
}

export async function avisarSiProcede(
  fallidos: Array<{ slug: SlugProyecto; error: string }>,
  deps: Dependencias,
): Promise<boolean> {
  if (fallidos.length === 0) return false;
  const log = deps.log ?? (() => {});
  try {
    if (await deps.repo.existeAvisoDesde(inicioDiaUtcIso(deps.ahora()))) return false;
    await deps.repo.crearAviso(construirAviso(fallidos));
    return true;
  } catch (e) {
    log(`[sync-trafico-web] no se pudo crear el aviso: ${mensajeError(e)}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Petición HTTP completa
// ---------------------------------------------------------------------------
export interface ConfigPeticion {
  secreto: string; // TRAFICO_WEB_CRON_SECRET ('' = ausente)
  token: string; // VERCEL_ANALYTICS_TOKEN ('' = ausente)
  /** Se llama SOLO tras autenticar y validar config: sin llamadas a Vercel antes. */
  crearDependencias: (token: string) => Dependencias;
  log?: (msg: string) => void;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function procesarPeticion(req: Request, cfg: ConfigPeticion): Promise<Response> {
  const log = cfg.log ?? ((m: string) => console.log(m));
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // FALLA CERRADO: sin secreto configurado no se acepta nada.
  if (!cfg.secreto) {
    log("[sync-trafico-web] TRAFICO_WEB_CRON_SECRET no configurado — rechazando (fail closed)");
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  const cabecera = req.headers.get("x-webhook-secret") ?? "";
  if (!cabecera || !compararTiempoConstante(cabecera, cfg.secreto)) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!cfg.token) {
    log("[sync-trafico-web] VERCEL_ANALYTICS_TOKEN no configurado");
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  const deps = cfg.crearDependencias(cfg.token);
  // Proyectos aislados: en paralelo y cada uno captura sus errores.
  const resultados = await Promise.all(PROYECTOS.map((p) => sincronizarProyecto(p, { ...deps, log: deps.log ?? log })));
  const porProyecto: Record<string, ResultadoProyecto> = {};
  PROYECTOS.forEach((p, i) => (porProyecto[p.slug] = resultados[i]));

  const fallidos = PROYECTOS.flatMap((p, i) => (resultados[i].ok ? [] : [{ slug: p.slug, error: resultados[i].error ?? "error" }]));
  const avisoCreado = await avisarSiProcede(fallidos, { ...deps, log: deps.log ?? log });

  const status = fallidos.length === 0 ? 200 : fallidos.length < PROYECTOS.length ? 207 : 502;
  return json({ ok: fallidos.length === 0, proyectos: porProyecto, aviso_creado: avisoCreado }, status);
}
