// ============================================================================
//  procesar-logs-web / recolectores.ts — errores de integraciones y hosting
// ----------------------------------------------------------------------------
//  Cada pasada del proceso lee, con marca de agua (cursores), fallos que no
//  pasan por el navegador ni por una petición HTTP a una función:
//    · tareas programadas de pg_cron con estado «failed»;
//    · la sincronización de Tráfico web con error (trafico_web_sync_estado);
//    · despliegues de Vercel en ERROR del entorno de ESTA base de datos.
//  Los eventos llevan un evento_id determinista: leer dos veces lo mismo no
//  duplica nada (ON CONFLICT en la RPC).
// ============================================================================

import { calcularHuella, uuidDeTexto } from "../_shared/logs-web/huella.ts";
import { sanearTexto } from "../_shared/logs-web/saneado.ts";
import type { EventoNormalizado } from "../_shared/logs-web/eventos.ts";

export interface FalloCron {
  runid: number;
  jobname: string;
  status: string;
  return_message: string | null;
  start_time: string;
}

export interface EstadoSyncTrafico {
  proyecto: string;
  ultimo_error: string | null;
  ultimo_intento_en: string | null;
  fallos_consecutivos: number;
}

export interface DespliegueVercel {
  uid: string;
  name: string;
  state?: string;
  readyState?: string;
  target?: string | null;
  createdAt: number;
  meta?: { githubCommitRef?: string; githubCommitSha?: string } | null;
}

const baseServidor = (o: Partial<EventoNormalizado>): Omit<EventoNormalizado, "evento_id" | "tipo" | "ocurrido_en" | "huella"> => ({
  proyecto: "supabase",
  fuente: "integracion",
  categoria: "error",
  accion: null,
  sesion_id: null,
  visitante_id: null,
  secuencia: null,
  ruta: null,
  objetivo: null,
  valor: null,
  propiedades: {},
  dispositivo: null,
  navegador: null,
  so: null,
  es_bot: false,
  es_interno: false,
  es_prueba: false,
  consentimiento: false,
  version: null,
  despliegue: null,
  gravedad: "error",
  mensaje: null,
  pila: null,
  ...o,
});

export async function eventosDeCron(fallos: FalloCron[]): Promise<EventoNormalizado[]> {
  const salida: EventoNormalizado[] = [];
  for (const f of fallos) {
    const mensaje = sanearTexto(f.return_message, 500) ?? "La tarea programada terminó con error";
    const objetivo = sanearTexto(`cron:${f.jobname}`, 120);
    salida.push({
      ...baseServidor({ objetivo, mensaje, propiedades: { tarea: f.jobname } }),
      evento_id: await uuidDeTexto(`cron:${f.runid}`),
      tipo: "error_integracion",
      ocurrido_en: new Date(f.start_time).toISOString(),
      huella: await calcularHuella({ tipo: "error_integracion", fuente: "integracion", objetivo, mensaje }),
    });
  }
  return salida;
}

export async function eventosDeSyncTrafico(estados: EstadoSyncTrafico[]): Promise<EventoNormalizado[]> {
  const salida: EventoNormalizado[] = [];
  for (const e of estados) {
    if (!e.ultimo_error || !e.ultimo_intento_en || (e.fallos_consecutivos ?? 0) < 1) continue;
    const objetivo = `sync-trafico-web:${e.proyecto}`;
    const mensaje = sanearTexto(e.ultimo_error, 500);
    salida.push({
      ...baseServidor({ objetivo, mensaje, gravedad: e.fallos_consecutivos >= 3 ? "error" : "aviso", valor: e.fallos_consecutivos }),
      evento_id: await uuidDeTexto(`trafico:${e.proyecto}:${e.ultimo_intento_en}`),
      tipo: "error_integracion",
      ocurrido_en: new Date(e.ultimo_intento_en).toISOString(),
      huella: await calcularHuella({ tipo: "error_integracion", fuente: "integracion", objetivo, mensaje }),
    });
  }
  return salida;
}

/** Solo los despliegues del entorno de esta base de datos (producción ↔ main, demo ↔ staging). */
export async function eventosDeDespliegues(despliegues: DespliegueVercel[], entornoBd: string): Promise<EventoNormalizado[]> {
  const salida: EventoNormalizado[] = [];
  for (const d of despliegues) {
    const estado = d.state ?? d.readyState;
    if (estado !== "ERROR") continue;
    const entorno = d.target === "production" ? "produccion" : "demo";
    if (entorno !== entornoBd) continue;
    const rama = sanearTexto(d.meta?.githubCommitRef ?? "", 60) ?? (entorno === "produccion" ? "main" : "staging");
    const proyecto = /^[a-z0-9-]{2,40}$/.test(d.name) ? d.name : "vercel";
    const objetivo = `${proyecto}:${entorno}`;
    const mensaje = `Despliegue de ${proyecto} en ERROR (rama ${rama})`;
    salida.push({
      ...baseServidor({ fuente: "hosting", proyecto, objetivo, mensaje, despliegue: d.meta?.githubCommitSha?.slice(0, 12) ?? null, propiedades: { rama } }),
      evento_id: await uuidDeTexto(`vercel:${d.uid}`),
      tipo: "error_despliegue",
      ocurrido_en: new Date(d.createdAt).toISOString(),
      huella: await calcularHuella({ tipo: "error_despliegue", fuente: "hosting", objetivo, codigo: "ERROR" }),
    });
  }
  return salida;
}

export const PROYECTOS_VERCEL = [
  { nombre: "web-casatomas", projectId: "prj_0sGVG2CWWPpZWwy1zrr0nCPftcYQ" },
];
export const EQUIPO_VERCEL = "team_18KKVg7ueSX0PL4Ycy1QakZj";

/** Despliegues en ERROR desde `desdeMs` (API de Vercel v6). */
export async function leerDesplieguesVercel(
  token: string,
  desdeMs: number,
  fetchFn: (u: string, i?: RequestInit) => Promise<Response> = (u, i) => fetch(u, i),
  proyectos = PROYECTOS_VERCEL,
): Promise<DespliegueVercel[]> {
  const todos: DespliegueVercel[] = [];
  for (const p of proyectos) {
    const url = new URL("https://api.vercel.com/v6/deployments");
    url.searchParams.set("projectId", p.projectId);
    url.searchParams.set("teamId", EQUIPO_VERCEL);
    url.searchParams.set("state", "ERROR");
    url.searchParams.set("since", String(desdeMs));
    url.searchParams.set("limit", "20");
    const res = await fetchFn(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Vercel ${res.status} al leer despliegues de ${p.nombre}`);
    const j = (await res.json()) as { deployments?: DespliegueVercel[] };
    for (const d of j.deployments ?? []) todos.push({ ...d, name: d.name || p.nombre });
  }
  return todos;
}
