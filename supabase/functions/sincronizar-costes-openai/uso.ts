// ============================================================================
//  sincronizar-costes-openai · USO por clave (tokens por día, clave y modelo)
// ----------------------------------------------------------------------------
//  El dueño usa UN proyecto de OpenAI para todo el restaurante, con varias
//  claves dentro (OCR, chat de facturas, general). /v1/organization/costs da el
//  total EXACTO por proyecto y día, pero no por clave. Para repartirlo entre
//  procesos se trae el USO (tokens) agrupado por clave y modelo, y la RPC
//  `gasto_ia_real_resumen` lo valora con `ia_precios` solo para calcular
//  proporciones: el total siempre es el real de OpenAI.
//
//  API (comprobada contra el openapi oficial de OpenAI, 09-oct-2026):
//   GET /v1/organization/usage/completions  y  /usage/embeddings  (Admin key)
//     start_time (unix s, obligatorio) · end_time · bucket_width=1d ·
//     group_by=project_id|api_key_id|model|… (repetible) · limit 1..31 (1d,
//     defecto 7) · page (cursor = next_page)
//     → { object:"page", data:[{object:"bucket", start_time, end_time,
//          results|result:[{input_tokens, input_cached_tokens (completions;
//          incluidos en input_tokens), output_tokens (completions),
//          num_model_requests, project_id, api_key_id, model, …}]}],
//          has_more, next_page }
//       El esquema oficial llama `result` al array y los ejemplos `results`:
//       se aceptan los dos.
//   GET /v1/organization/projects/{project_id}/api_keys  (Admin key)
//     limit 1..100 · after=<id>
//     → { object:"list", data:[{id, name, redacted_value, created_at,
//          last_used_at, owner}], first_id, last_id, has_more }
//
//  La clave de administración NUNCA se imprime ni se devuelve.
// ============================================================================

import { DIAS_SINCRONIZADOS, fechaUtc, inicioVentana, OPENAI_API, type FetchFn } from "./costes.ts";

const MAX_PAGINAS = 20;
const LOTE_UPSERT = 500;
/** Máximo de cubos diarios por página en usage con bucket_width=1d. */
const LIMITE_CUBOS_USO = 31;

export interface FilaUso {
  fecha: string; // YYYY-MM-DD (UTC)
  project_id: string; // "" = sin proyecto
  api_key_id: string; // "" = sin clave
  modelo: string; // "" = sin modelo
  input_tokens: number; // incluye los cacheados
  cached_tokens: number;
  output_tokens: number;
  peticiones: number;
}

export interface ClaveOpenAI {
  api_key_id: string;
  project_id: string;
  nombre: string | null;
}

// `ajeno` solo lo asigna esta función a claves nuevas de un proyecto marcado `ajeno` (p. ej. Default); `mixto` lo pone el dueño a mano.
export type ProcesoClave = "ocr" | "chat" | "chatweb" | "vinos" | "otros" | "ajeno";

/**
 * Proceso que se deduce del NOMBRE de una clave nueva: OPENAI_API_KEY_OCR → ocr,
 * OPENAI_API_KEY_CHAT → chat, OPENAI_API_KEY_CHATWEB → chatweb (chat de la web),
 * OPENAI_API_KEY_VINOS → vinos (vino desde foto), cualquier otra
 * (OPENAI_API_KEY general) → otros. Solo se aplica a claves NUEVAS: lo que el
 * dueño corrija a mano en openai_claves no se pisa.
 */
export function procesoPorNombreClave(nombre: string | null | undefined): ProcesoClave {
  const t = (nombre ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/chat[\s_-]*web/.test(t)) return "chatweb";
  if (/vino/.test(t)) return "vinos";
  if (/ocr/.test(t)) return "ocr";
  if (/chat/.test(t)) return "chat";
  return "otros";
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

const num = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) && x > 0 ? Math.round(x) : 0;
};
const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Uso de completions y embeddings por día, proyecto, clave y modelo desde
 * `desdeUnix`, paginando con next_page. Las dos fuentes se suman en la misma
 * clave (sus modelos no coinciden, pero así la clave primaria no puede chocar).
 */
export async function obtenerUso(opts: {
  adminKey: string;
  desdeUnix: number;
  fetch?: FetchFn;
}): Promise<FilaUso[]> {
  const fetchFn = opts.fetch ?? fetch;
  const acumulado = new Map<string, FilaUso>();

  for (const fuente of ["completions", "embeddings"] as const) {
    let pagina: string | null = null;
    const vistas = new Set<string>();
    let terminada = false;
    for (let n = 0; n < MAX_PAGINAS && !terminada; n++) {
      const p = new URLSearchParams();
      p.set("start_time", String(opts.desdeUnix));
      p.set("bucket_width", "1d");
      p.append("group_by", "project_id");
      p.append("group_by", "api_key_id");
      p.append("group_by", "model");
      p.set("limit", String(LIMITE_CUBOS_USO));
      if (pagina) p.set("page", pagina);
      const json = await pedirJson(`${OPENAI_API}/organization/usage/${fuente}?${p}`, opts.adminKey, fetchFn, `usage/${fuente}`);

      const cubos = Array.isArray(json.data) ? json.data as Array<Record<string, unknown>> : [];
      for (const cubo of cubos) {
        const inicio = Number(cubo.start_time);
        if (!Number.isFinite(inicio)) continue;
        const fecha = fechaUtc(inicio);
        const lista = Array.isArray(cubo.results) ? cubo.results : Array.isArray(cubo.result) ? cubo.result : [];
        for (const r of lista as Array<Record<string, unknown>>) {
          const fila: FilaUso = {
            fecha,
            project_id: txt(r.project_id, 120),
            api_key_id: txt(r.api_key_id, 120),
            modelo: txt(r.model, 120),
            input_tokens: num(r.input_tokens),
            cached_tokens: fuente === "completions" ? num(r.input_cached_tokens) : 0,
            output_tokens: fuente === "completions" ? num(r.output_tokens) : 0,
            peticiones: num(r.num_model_requests),
          };
          // El cacheado va dentro del input: nunca puede ser mayor.
          fila.cached_tokens = Math.min(fila.cached_tokens, fila.input_tokens);
          const clave = `${fila.fecha}|${fila.project_id}|${fila.api_key_id}|${fila.modelo}`;
          const previa = acumulado.get(clave);
          if (previa) {
            previa.input_tokens += fila.input_tokens;
            previa.cached_tokens += fila.cached_tokens;
            previa.output_tokens += fila.output_tokens;
            previa.peticiones += fila.peticiones;
          } else acumulado.set(clave, fila);
        }
      }

      const siguiente = typeof json.next_page === "string" && json.next_page ? json.next_page : null;
      if (json.has_more !== true || !siguiente) {
        terminada = true;
      } else if (vistas.has(siguiente)) {
        throw new Error(`OpenAI usage/${fuente}: cursor repetido`);
      } else {
        vistas.add(siguiente);
        pagina = siguiente;
      }
    }
    if (!terminada) throw new Error(`OpenAI usage/${fuente}: demasiadas páginas`);
  }
  return [...acumulado.values()];
}

/** Claves de API de un proyecto (id y nombre; nunca el valor). */
export async function listarClavesProyecto(opts: {
  adminKey: string;
  projectId: string;
  fetch?: FetchFn;
}): Promise<ClaveOpenAI[]> {
  const fetchFn = opts.fetch ?? fetch;
  const salida: ClaveOpenAI[] = [];
  let despues: string | null = null;
  for (let n = 0; n < MAX_PAGINAS; n++) {
    const p = new URLSearchParams({ limit: "100" });
    if (despues) p.set("after", despues);
    const json = await pedirJson(
      `${OPENAI_API}/organization/projects/${encodeURIComponent(opts.projectId)}/api_keys?${p}`,
      opts.adminKey,
      fetchFn,
      "api_keys",
    );
    const datos = Array.isArray(json.data) ? json.data as Array<Record<string, unknown>> : [];
    for (const d of datos) {
      if (typeof d.id === "string" && d.id) {
        salida.push({
          api_key_id: d.id,
          project_id: opts.projectId,
          nombre: typeof d.name === "string" && d.name ? d.name.slice(0, 200) : null,
        });
      }
    }
    const ultimo = typeof json.last_id === "string" && json.last_id ? json.last_id : null;
    if (json.has_more !== true || !ultimo || ultimo === despues) return salida;
    despues = ultimo;
  }
  return salida;
}

// Cliente de Supabase mínimo (lo que usamos de supabase-js), tipado suelto.
// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = { from: (tabla: string) => any };

export interface ResultadoUso {
  uso_filas: number;
  claves_nuevas: number;
  claves_sin_nombre: number;
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

/**
 * Trae el uso por clave de los últimos 35 días, da de alta las claves de TODOS
 * los proyectos en `openai_claves` y guarda el uso en `openai_uso_diario`. Desde
 * 20261010100000 también los de los proyectos marcados 'ajeno' (Default): el
 * proceso se decide por CLAVE (openai_claves.proceso) y la RPC necesita el uso
 * de sus claves para repartir el coste real del proyecto. Las claves NUEVAS de un
 * proyecto 'ajeno' entran como 'ajeno' (el dueño marca a mano las que sí cuentan).
 * Se llama DESPUÉS de `sincronizar` (que ya ha dado de alta los proyectos).
 */
export async function sincronizarUso(opts: {
  supabase: Supabase;
  adminKey: string;
  fetch?: FetchFn;
  ahoraMs?: number;
}): Promise<ResultadoUso> {
  const fetchFn = opts.fetch ?? fetch;
  const ahora = opts.ahoraMs ?? Date.now();
  const iso = new Date(ahora).toISOString();
  const avisos: string[] = [];

  const { data: proyectos, error: errProy } = await opts.supabase.from("openai_proyectos").select("project_id, proceso");
  if (errProy) throw new Error(`openai_proyectos: ${errProy.message}`);
  const ajenos = new Set(
    (proyectos ?? []).filter((p: { proceso: string | null }) => p.proceso === "ajeno").map((p: { project_id: string }) => p.project_id),
  );
  const todosProyectos = (proyectos ?? []).map((p: { project_id: string }) => p.project_id);

  const todoUso = await obtenerUso({ adminKey: opts.adminKey, desdeUnix: inicioVentana(ahora, DIAS_SINCRONIZADOS), fetch: fetchFn });
  const uso = todoUso;

  // Claves de cada proyecto (también los 'ajeno': su proceso se decide por clave).
  const listadas = new Map<string, ClaveOpenAI>();
  for (const projectId of todosProyectos) {
    try {
      for (const c of await listarClavesProyecto({ adminKey: opts.adminKey, projectId, fetch: fetchFn })) listadas.set(c.api_key_id, c);
    } catch (e) {
      avisos.push(`No se pudieron listar las claves de ${projectId}: ${(e as Error).message}`);
    }
  }

  const { data: existentes, error: errClaves } = await opts.supabase
    .from("openai_claves")
    .select("api_key_id, project_id, nombre");
  if (errClaves) throw new Error(`openai_claves: ${errClaves.message}`);
  const yaEstan = new Map<string, { project_id: string; nombre: string | null }>(
    (existentes ?? []).map((c: { api_key_id: string; project_id: string; nombre: string | null }) => [c.api_key_id, c]),
  );

  // Nuevas: con el proceso deducido del nombre. Cambiadas: solo nombre/proyecto (nunca el proceso).
  const nuevas = [...listadas.values()]
    .filter((c) => !yaEstan.has(c.api_key_id))
    .map((c) => ({ ...c, proceso: ajenos.has(c.project_id) ? ("ajeno" as ProcesoClave) : procesoPorNombreClave(c.nombre) }));
  const cambiadas = [...listadas.values()].filter((c) => {
    const previa = yaEstan.get(c.api_key_id);
    return previa && (previa.project_id !== c.project_id || (previa.nombre ?? null) !== c.nombre);
  });
  // Claves que solo aparecen en el uso (borradas o no listables): alta sin nombre, proceso otros (ajeno si el proyecto lo es).
  const vistas = new Set<string>();
  const soloEnUso: Array<ClaveOpenAI & { proceso: ProcesoClave }> = [];
  for (const u of uso) {
    if (!u.api_key_id || vistas.has(u.api_key_id)) continue;
    vistas.add(u.api_key_id);
    if (yaEstan.has(u.api_key_id) || listadas.has(u.api_key_id)) continue;
    soloEnUso.push({ api_key_id: u.api_key_id, project_id: u.project_id, nombre: null, proceso: ajenos.has(u.project_id) ? "ajeno" : "otros" });
  }

  if (nuevas.length) await upsertPorLotes(opts.supabase, "openai_claves", nuevas, { onConflict: "api_key_id" });
  if (cambiadas.length) await upsertPorLotes(opts.supabase, "openai_claves", cambiadas, { onConflict: "api_key_id" });
  if (soloEnUso.length) {
    await upsertPorLotes(opts.supabase, "openai_claves", soloEnUso, { onConflict: "api_key_id", ignoreDuplicates: true });
  }

  if (uso.length) {
    await upsertPorLotes(
      opts.supabase,
      "openai_uso_diario",
      uso.map((u) => ({ ...u, actualizado_en: iso })),
      { onConflict: "fecha,project_id,api_key_id,modelo" },
    );
  }

  return {
    uso_filas: uso.length,
    claves_nuevas: nuevas.length + soloEnUso.length,
    claves_sin_nombre: soloEnUso.length,
    avisos,
  };
}
