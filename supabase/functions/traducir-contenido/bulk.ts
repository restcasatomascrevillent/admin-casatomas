// Modo de relleno masivo (TAREA 5).
// ---------------------------------------------------------------------------
// Traduce los productos que YA EXISTEN en la carta y tienen las columnas
// *_en vacías (nombre_en IS NULL se usa como marcador de "sin traducir",
// igual que en el recuento verificado contra la base: 0/13 cócteles,
// 45/75 bebidas, 9/185 vinos, 0/128 platos porque Platos ya está completo).
//
// IMPORTANTE: este módulo se implementa pero NO se ejecuta desde esta tarea.
// Solo se dispara si alguien llama a traducir-contenido con
// {"modo":"bulk"} autenticado con la SERVICE ROLE KEY (ver index.ts) — un
// usuario del panel nunca puede alcanzarlo. El dueño decide cuándo correrlo,
// por ejemplo:
//
//   curl -X POST https://<project>.supabase.co/functions/v1/traducir-contenido \
//     -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
//     -H "Content-Type: application/json" \
//     -d '{"modo":"bulk","dryRun":true}'
//
// Empezar SIEMPRE con dryRun:true (cuenta y no escribe) antes de correrlo de
// verdad. Usa la MISMA lógica de prompts que el modo normal (buildPromptSpec),
// así que no hay divergencia entre "traducir al crear" y "traducir en masa".
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPromptSpec, normalizarAlergenos } from "./prompts.ts";

type CallOpenAI = (system: string, user: string) => Promise<unknown>;

interface BulkOptions {
  tablas?: string[];
  dryRun?: boolean;
  callOpenAI: CallOpenAI;
}

interface TablaConfig {
  tabla: string;
  tipo: "plato" | "bebida" | "vino" | "coctel";
  columnas: string;
  aDatos: (row: Record<string, unknown>) => Record<string, unknown>;
}

const TABLAS: TablaConfig[] = [
  {
    tabla: "Platos",
    tipo: "plato",
    columnas: "id, nombre, descripcion, categoria, alergenos_oficiales",
    aDatos: (row) => ({
      nombre: row.nombre,
      descripcion: row.descripcion,
      categoria: row.categoria,
      alergenos: normalizarAlergenos(row.alergenos_oficiales),
    }),
  },
  {
    tabla: "Bebidas",
    tipo: "bebida",
    columnas: "id, nombre, descripcion, categoria",
    aDatos: (row) => ({ nombre: row.nombre, descripcion: row.descripcion, categoria: row.categoria }),
  },
  {
    tabla: "Vinos",
    tipo: "vino",
    columnas: "id, nombre, descripcion, categoria, ubicacion_pais, ubicacion_region, alergenos_notas",
    aDatos: (row) => ({
      nombre: row.nombre,
      descripcion: row.descripcion,
      categoria: row.categoria,
      ubicacion_pais: row.ubicacion_pais,
      ubicacion_region: row.ubicacion_region,
      alergenos_notas: row.alergenos_notas,
    }),
  },
  {
    tabla: "Cocteles",
    tipo: "coctel",
    columnas: "id, nombre, descripcion, categoria, ingredientes",
    aDatos: (row) => ({
      nombre: row.nombre,
      descripcion: row.descripcion,
      categoria: row.categoria,
      ingredientes: row.ingredientes,
    }),
  },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runBulkFill(options: BulkOptions) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno de la función");
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const objetivo = options.tablas?.length
    ? TABLAS.filter((t) => options.tablas!.includes(t.tabla))
    : TABLAS;

  const resumen: Record<string, { pendientes: number; traducidos: number; fallidos: string[] }> = {};

  for (const config of objetivo) {
    const { data: filas, error } = await supabase
      .from(config.tabla)
      .select(config.columnas)
      .is("nombre_en", null)
      .not("nombre", "is", null);

    if (error) {
      resumen[config.tabla] = { pendientes: 0, traducidos: 0, fallidos: [`SELECT: ${error.message}`] };
      continue;
    }

    const pendientes = filas ?? [];
    resumen[config.tabla] = { pendientes: pendientes.length, traducidos: 0, fallidos: [] };

    if (options.dryRun) continue;

    for (const rawRow of pendientes) {
      const row = rawRow as Record<string, unknown>;
      try {
        const spec = buildPromptSpec(config.tipo, config.aDatos(row));
        const respuesta = await options.callOpenAI(spec.system, spec.userMessage);
        const columnas = spec.mapResponse(respuesta);

        const { error: updateError } = await supabase
          .from(config.tabla)
          .update(columnas)
          .eq("id", row.id as string);

        if (updateError) throw new Error(updateError.message);

        resumen[config.tabla].traducidos += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "error desconocido";
        resumen[config.tabla].fallidos.push(`${row.id}: ${msg}`);
      }

      // Pequeño respiro entre llamadas para no saturar el rate limit de OpenAI.
      await sleep(300);
    }
  }

  return { dryRun: Boolean(options.dryRun), resumen };
}
