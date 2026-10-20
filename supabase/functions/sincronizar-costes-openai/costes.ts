// ============================================================================
//  sincronizar-costes-openai · lógica pura (sin Deno.env, sin red propia)
// ----------------------------------------------------------------------------
//  Trae de OpenAI el gasto REAL (lo que factura), por día, proyecto y concepto,
//  y lo deja en `openai_costes_diarios`. Recibe `fetch` y el cliente de
//  Supabase por parámetro para que los tests lo simulen.
//
//  API (comprobada contra el openapi oficial de OpenAI, 08-oct-2026):
//   GET /v1/organization/costs  (Admin key)
//     start_time (unix s, obligatorio) · end_time · bucket_width=1d ·
//     group_by=project_id|line_item|… (repetible) · limit 1..180 (defecto 7) ·
//     page (cursor = next_page)
//     → { object:"page", data:[{object:"bucket", start_time, end_time,
//          results:[{object:"organization.costs.result",
//                    amount:{value, currency:"usd"}, line_item|null,
//                    project_id|null, …}]}], has_more, next_page }
//   GET /v1/organization/projects  (Admin key)
//     limit 1..100 · after=<id> · include_archived
//     → { object:"list", data:[{id, name, …}], first_id, last_id, has_more }
//
//  La clave de administración NUNCA se imprime ni se devuelve.
// ============================================================================

export const OPENAI_API = "https://api.openai.com/v1";
export const DIAS_SINCRONIZADOS = 35;
const MAX_PAGINAS = 20;
const LOTE_UPSERT = 500;

export type FetchFn = typeof fetch;

export interface FilaCoste {
  fecha: string; // YYYY-MM-DD (UTC, el cubo diario de OpenAI)
  project_id: string; // "" = sin proyecto
  line_item: string; // "" = sin concepto
  usd: number;
}

export interface ProyectoOpenAI {
  project_id: string;
  nombre: string | null;
}

export interface TipoCambio {
  fecha: string;
  eur_por_usd: number;
  fuente: string;
}

/** Fecha UTC (YYYY-MM-DD) de un instante unix en segundos. */
export function fechaUtc(unixSegundos: number): string {
  return new Date(unixSegundos * 1000).toISOString().slice(0, 10);
}

export function inicioVentana(ahoraMs: number, dias = DIAS_SINCRONIZADOS): number {
  const hoy = Math.floor(ahoraMs / 1000);
  const medianoche = hoy - (hoy % 86400);
  return medianoche - dias * 86400;
}

async function pedirJson(
  url: string,
  adminKey: string,
  fetchFn: FetchFn,
  etiqueta: string,
): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${adminKey}` } });
  if (!res.ok) {
    // Nunca se vuelca el cuerpo entero: solo el código y el mensaje de error de OpenAI.
    const cuerpo = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    const msg = String(cuerpo?.error?.message ?? "").slice(0, 200);
    throw new Error(`OpenAI ${etiqueta} ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return await res.json() as Record<string, unknown>;
}

/** Costes por día, proyecto y concepto desde `desdeUnix`, paginando con next_page. */
export async function obtenerCostes(opts: {
  adminKey: string;
  desdeUnix: number;
  fetch?: FetchFn;
  limite?: number;
}): Promise<FilaCoste[]> {
  const fetchFn = opts.fetch ?? fetch;
  const acumulado = new Map<string, FilaCoste>();
  let pagina: string | null = null;
  const vistas = new Set<string>();

  for (let n = 0; n < MAX_PAGINAS; n++) {
    const p = new URLSearchParams();
    p.set("start_time", String(opts.desdeUnix));
    p.set("bucket_width", "1d");
    p.append("group_by", "project_id");
    p.append("group_by", "line_item");
    p.set("limit", String(opts.limite ?? 45));
    if (pagina) p.set("page", pagina);
    const json = await pedirJson(`${OPENAI_API}/organization/costs?${p}`, opts.adminKey, fetchFn, "costs");

    const cubos = Array.isArray(json.data) ? json.data as Array<Record<string, unknown>> : [];
    for (const cubo of cubos) {
      const inicio = Number(cubo.start_time);
      if (!Number.isFinite(inicio)) continue;
      const fecha = fechaUtc(inicio);
      const resultados = Array.isArray(cubo.results) ? cubo.results as Array<Record<string, unknown>> : [];
      for (const r of resultados) {
        const amount = (r.amount ?? {}) as { value?: unknown; currency?: unknown };
        const valor = typeof amount.value === "number" ? amount.value : Number.NaN;
        if (!Number.isFinite(valor)) continue; // null / texto: no es un coste
        const moneda = String(amount.currency ?? "usd").toLowerCase();
        if (moneda !== "usd") continue; // OpenAI factura en USD; otra cosa no se mezcla
        const project_id = typeof r.project_id === "string" ? r.project_id : "";
        const line_item = typeof r.line_item === "string" ? r.line_item : "";
        const clave = `${fecha}|${project_id}|${line_item}`;
        const previa = acumulado.get(clave);
        if (previa) previa.usd += valor;
        else acumulado.set(clave, { fecha, project_id, line_item, usd: valor });
      }
    }

    const siguiente = typeof json.next_page === "string" && json.next_page ? json.next_page : null;
    if (json.has_more !== true || !siguiente) return [...acumulado.values()];
    if (vistas.has(siguiente)) break; // cursor repetido: evita un bucle infinito
    vistas.add(siguiente);
    pagina = siguiente;
  }
  throw new Error("OpenAI costs: demasiadas páginas o cursor repetido");
}

/** Proyectos de la organización (incluye archivados, para que sus costes antiguos se puedan mapear). */
export async function listarProyectos(opts: { adminKey: string; fetch?: FetchFn }): Promise<ProyectoOpenAI[]> {
  const fetchFn = opts.fetch ?? fetch;
  const salida: ProyectoOpenAI[] = [];
  let despues: string | null = null;
  for (let n = 0; n < MAX_PAGINAS; n++) {
    const p = new URLSearchParams({ limit: "100", include_archived: "true" });
    if (despues) p.set("after", despues);
    const json = await pedirJson(`${OPENAI_API}/organization/projects?${p}`, opts.adminKey, fetchFn, "projects");
    const datos = Array.isArray(json.data) ? json.data as Array<Record<string, unknown>> : [];
    for (const d of datos) {
      if (typeof d.id === "string" && d.id) {
        salida.push({ project_id: d.id, nombre: typeof d.name === "string" ? d.name.slice(0, 200) : null });
      }
    }
    const ultimo = typeof json.last_id === "string" && json.last_id ? json.last_id : null;
    if (json.has_more !== true || !ultimo || ultimo === despues) return salida;
    despues = ultimo;
  }
  return salida;
}

/** EUR por 1 USD desde el BCE (sin clave); respaldo: frankfurter (también datos del BCE). */
export async function obtenerTipoCambio(fetchFn: FetchFn = fetch): Promise<TipoCambio | null> {
  try {
    const res = await fetchFn(
      "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=jsondata",
    );
    if (res.ok) {
      const j = await res.json() as {
        dataSets?: Array<{ series?: Record<string, { observations?: Record<string, number[]> }> }>;
        structure?: { dimensions?: { observation?: Array<{ values?: Array<{ id?: string }> }> } };
      };
      const serie = Object.values(j.dataSets?.[0]?.series ?? {})[0];
      const obs = Object.values(serie?.observations ?? {})[0];
      const usdPorEur = Number(obs?.[0]);
      const fecha = j.structure?.dimensions?.observation?.[0]?.values?.[0]?.id;
      if (Number.isFinite(usdPorEur) && usdPorEur > 0.2 && usdPorEur < 5 && fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        return { fecha, eur_por_usd: Number((1 / usdPorEur).toFixed(6)), fuente: "bce" };
      }
    }
  } catch { /* se prueba el respaldo */ }
  try {
    const res = await fetchFn("https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR");
    if (res.ok) {
      const j = await res.json() as { date?: string; rates?: { EUR?: number } };
      const eur = Number(j.rates?.EUR);
      if (Number.isFinite(eur) && eur > 0.2 && eur < 5 && j.date && /^\d{4}-\d{2}-\d{2}$/.test(j.date)) {
        return { fecha: j.date, eur_por_usd: Number(eur.toFixed(6)), fuente: "frankfurter" };
      }
    }
  } catch { /* sin tipo de cambio: se queda el último guardado */ }
  return null;
}

// Cliente de Supabase mínimo (lo que usamos de supabase-js), tipado suelto.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = { from: (tabla: string) => any };

export interface ResultadoSync {
  filas: number;
  dias: number;
  proyectos_nuevos: number;
  proyectos_sin_proceso: number;
  tipo_cambio: TipoCambio | null;
  avisos: string[];
}

async function upsertPorLotes(
  supabase: Supabase,
  tabla: string,
  filas: Record<string, unknown>[],
  opciones: { onConflict: string; ignoreDuplicates?: boolean },
): Promise<void> {
  for (let i = 0; i < filas.length; i += LOTE_UPSERT) {
    const { error } = await supabase.from(tabla).upsert(filas.slice(i, i + LOTE_UPSERT), opciones);
    if (error) throw new Error(`${tabla}: ${error.message}`);
  }
}

export async function sincronizar(opts: {
  supabase: Supabase;
  adminKey: string;
  fetch?: FetchFn;
  ahoraMs?: number;
}): Promise<ResultadoSync> {
  const fetchFn = opts.fetch ?? fetch;
  const ahora = opts.ahoraMs ?? Date.now();
  const avisos: string[] = [];
  const iso = new Date(ahora).toISOString();

  const costes = await obtenerCostes({ adminKey: opts.adminKey, desdeUnix: inicioVentana(ahora), fetch: fetchFn });

  // Proyectos: la lista oficial (con nombre) y los que aparecen solo en los costes.
  let listados: ProyectoOpenAI[] = [];
  try {
    listados = await listarProyectos({ adminKey: opts.adminKey, fetch: fetchFn });
  } catch (e) {
    avisos.push(`No se pudo listar proyectos: ${(e as Error).message}`);
  }
  const idsListados = new Set(listados.map((p) => p.project_id));
  const desconocidos = [...new Set(costes.map((c) => c.project_id))]
    .filter((id) => id && !idsListados.has(id));

  // Existentes antes de escribir, para contar los nuevos.
  const { data: existentes, error: errExist } = await opts.supabase.from("openai_proyectos").select("project_id");
  if (errExist) throw new Error(`openai_proyectos: ${errExist.message}`);
  const yaEstaban = new Set((existentes ?? []).map((p: { project_id: string }) => p.project_id));

  // Con nombre: se actualiza el nombre y NUNCA el proceso (el upsert solo toca las columnas enviadas).
  if (listados.length) {
    await upsertPorLotes(
      opts.supabase,
      "openai_proyectos",
      listados.map((p) => ({ project_id: p.project_id, nombre: p.nombre })),
      { onConflict: "project_id" },
    );
  }
  // Sin nombre conocido: solo se da de alta si no existe (proceso null).
  if (desconocidos.length) {
    await upsertPorLotes(
      opts.supabase,
      "openai_proyectos",
      desconocidos.map((project_id) => ({ project_id })),
      { onConflict: "project_id", ignoreDuplicates: true },
    );
  }
  const todos = new Set([...idsListados, ...desconocidos]);
  const nuevos = [...todos].filter((id) => !yaEstaban.has(id)).length;

  if (costes.length) {
    await upsertPorLotes(
      opts.supabase,
      "openai_costes_diarios",
      costes.map((c) => ({ ...c, actualizado_en: iso })),
      { onConflict: "fecha,project_id,line_item" },
    );
  }

  const tipo = await obtenerTipoCambio(fetchFn);
  if (tipo) {
    await upsertPorLotes(
      opts.supabase,
      "tipo_cambio_usd_eur",
      [{ ...tipo, actualizado_en: iso }],
      { onConflict: "fecha" },
    );
  } else {
    avisos.push("Sin tipo de cambio nuevo (BCE y respaldo no respondieron): se conserva el último guardado");
  }

  const { count } = await opts.supabase
    .from("openai_proyectos")
    .select("project_id", { count: "exact", head: true })
    .is("proceso", null);

  return {
    filas: costes.length,
    dias: new Set(costes.map((c) => c.fecha)).size,
    proyectos_nuevos: nuevos,
    proyectos_sin_proceso: typeof count === "number" ? count : 0,
    tipo_cambio: tipo,
    avisos,
  };
}
