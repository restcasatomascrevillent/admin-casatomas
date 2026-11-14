// ============================================================================
//  procesar-logs-web / proceso.ts — una pasada del procesado en segundo plano
// ----------------------------------------------------------------------------
//  Lógica pura con dependencias inyectadas (index.ts las construye):
//    1. Turno: un solo proceso a la vez (arrendamiento en web_logs_estado).
//    2. Recolectores: cron, Tráfico web y despliegues → web_logs_ingerir.
//    3. Agrupar errores (RPC con advisory lock, umbrales, reapertura).
//    4. Tickets: crear (con análisis de IA), reabrir, actualizar por
//       repeticiones y sincronizar el estado de Linear. Cada incidencia se
//       reclama con un arrendamiento propio antes de tocarla. Primero las más
//       graves y con más visitantes (el tope diario se gasta en lo importante).
//       Al pasar del destino de pruebas a Linear, las que tenían ticket de
//       prueba y siguen repitiéndose pasan a «pendiente» con un id nuevo
//       (acción «migrar»): las ya paradas no se mandan a Linear.
//    4 bis. Explicación en sencillo (IA) de los errores sin causa conocida,
//       una vez por incidencia (explicar.ts). Comparte el tope diario de IA
//       con los análisis de los tickets y usa como mucho la mitad.
//    5. Purga diaria y estado final.
//  Si Linear o la IA fallan, la incidencia se queda «pendiente/error» con su
//  próximo intento (espera exponencial, máx. 6 h); el id determinista impide
//  duplicar el ticket en el reintento. El proceso NUNCA ejecuta nada de lo que
//  digan los logs: solo los lee, agrupa y describe.
// ============================================================================

import { ErrorLinear, prioridadLinear, type DestinoTickets } from "./linear.ts";
import { construirActualizacion, construirReapertura, construirTicket, type AnalisisIa, type EventoTicket, type IncidenciaTicket } from "./ticket.ts";
import { interpretarAnalisis, mensajesIncidencia, type MensajeChat } from "./ia.ts";
import { interpretarExplicacion, mensajesExplicacion, necesitaExplicacion, type ExplicacionIa } from "./explicar.ts";
import { eventosDeCron, eventosDeDespliegues, eventosDeSyncTrafico, type DespliegueVercel, type EstadoSyncTrafico, type FalloCron } from "./recolectores.ts";
import type { EventoNormalizado } from "../_shared/logs-web/eventos.ts";
import { sanearTexto } from "../_shared/logs-web/saneado.ts";

export interface ConfigLogs {
  linear_modo: "desactivado" | "prueba" | "real";
  linear_equipo_id: string | null;
  linear_proyecto_id: string | null;
  linear_etiquetas: string[];
  linear_estado_reabrir_id: string | null;
  linear_max_tickets_dia: number;
  ia_activada: boolean;
  ia_max_analisis_dia: number;
  recoger_integraciones: boolean;
  recoger_hosting: boolean;
  entorno_bd: "produccion" | "demo" | "local";
  entornos_aceptados: string[];
}

export interface IncidenciaFila extends IncidenciaTicket {
  estado: string;
  linear_estado: string;
  linear_uuid: string;
  linear_issue_id: string | null;
  linear_identificador: string | null;
  linear_destino: string | null;
  linear_intentos: number;
  linear_proximo_intento: string | null;
  linear_ultima_sync: string | null;
  linear_pendiente_reapertura: boolean;
  ocurrencias_en_ticket: number;
  analisis_ia: AnalisisIa | null;
  analisis_ia_en: string | null;
  explicacion_ia: ExplicacionIa | null;
  explicacion_ia_intentos: number;
}

export interface RepoProceso {
  config(): Promise<ConfigLogs>;
  tomarTurno(ahora: Date, hasta: Date): Promise<boolean>;
  terminarTurno(estado: { ok: boolean; error: string | null; resumen: Record<string, unknown>; ahora: Date }): Promise<void>;
  cursores(): Promise<Record<string, string>>;
  guardarCursores(c: Record<string, string>): Promise<void>;
  ingerir(eventos: EventoNormalizado[], entorno: string): Promise<{ aceptados?: number }>;
  fallosCron(desde: string): Promise<FalloCron[]>;
  estadosSyncTrafico(): Promise<EstadoSyncTrafico[]>;
  agrupar(): Promise<Record<string, unknown>>;
  incidenciasConTicket(limite: number): Promise<IncidenciaFila[]>;
  reclamar(id: number, ahora: Date, hasta: Date): Promise<boolean>;
  actualizar(id: number, cambios: Record<string, unknown>): Promise<void>;
  muestras(id: number): Promise<EventoTicket[]>;
  ultimoErrorConSesion(id: number): Promise<number | null>;
  contexto(eventoId: number): Promise<EventoTicket[]>;
  /** Tickets creados desde `desde` en ese destino (el tope diario es por destino). */
  ticketsCreadosDesde(desde: Date, destino: DestinoTickets["tipo"]): Promise<number>;
  analisisDesde(desde: Date): Promise<number>;
  /** Explicaciones en sencillo intentadas desde `desde` (cuentan para el tope diario de IA). */
  explicacionesDesde(desde: Date): Promise<number>;
  /** Incidencias sin explicación en sencillo, las más recientes primero. */
  incidenciasSinExplicar(limite: number): Promise<IncidenciaFila[]>;
  ultimaPurga(): Promise<string | null>;
  purgar(): Promise<Record<string, unknown>>;
}

export interface DependenciasProceso {
  repo: RepoProceso;
  /** null = destino sin configurar (modo real sin clave o equipo); el motivo va en `motivoSinDestino`. */
  destino: (modo: ConfigLogs["linear_modo"], config: ConfigLogs) => DestinoTickets | null;
  motivoSinDestino?: (modo: ConfigLogs["linear_modo"], config: ConfigLogs) => string | null;
  ia: ((mensajes: MensajeChat[]) => Promise<{ texto: string; modelo: string }>) | null;
  /** IA corta para las explicaciones en sencillo (null = sin clave). */
  iaExplicar?: ((mensajes: MensajeChat[], disparador: string) => Promise<{ texto: string; modelo: string }>) | null;
  despliegues: ((desdeMs: number) => Promise<DespliegueVercel[]>) | null;
  urlPanel: string;
  ahora?: () => Date;
  log?: (m: string) => void;
  /** Id nuevo para un ticket (por defecto crypto.randomUUID). */
  nuevoUuid?: () => string;
}

export const LIMITES = { crear: 5, actualizar: 10, sincronizar: 20, explicar: 3, turnoMs: 4 * 60_000, reclamoMs: 5 * 60_000 };

/** Explicaciones en sencillo al día: como mucho la mitad del tope de IA (el resto queda para los tickets). */
export const maxExplicacionesDia = (topeIa: number) => Math.floor(topeIa / 2);
const SEIS_HORAS = 6 * 3_600_000;

/** Espera hasta el siguiente intento: 5, 10, 20, 40… minutos, máximo 6 h. */
export function siguienteIntento(intentos: number, ahora: Date): Date {
  const ms = Math.min(5 * 60_000 * 2 ** Math.max(intentos - 1, 0), SEIS_HORAS);
  return new Date(ahora.getTime() + ms);
}

/** Medianoche de hoy en Madrid (el tope diario de tickets y análisis va por día natural). */
export function inicioDiaMadrid(ahora: Date): Date {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(ahora).map((x) => [x.type, x.value]));
  const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const desfase = comoUtc - Math.floor(ahora.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - desfase);
}

export type Accion = "crear" | "reabrir" | "actualizar" | "sincronizar" | "migrar" | null;

/**
 * Qué hay que hacer con el ticket de una incidencia ahora mismo.
 * `destino`: tipo del destino actual. Un ticket hecho en OTRO destino (p. ej.
 * el de pruebas, tras activar Linear) no se comenta ni se consulta aquí: si la
 * incidencia sigue viva, se «migra» (ticket nuevo en el destino actual).
 */
export function accionPara(i: IncidenciaFila, ahora: Date, destino?: DestinoTickets["tipo"]): Accion {
  if (i.estado === "ignorada") return null;
  if (i.linear_estado === "pendiente" || i.linear_estado === "error") {
    // Resuelta antes de llegar a crear el ticket: no se abre (si vuelve, pasa a «reabierta» y entonces sí).
    if (i.estado === "resuelta") return null;
    return !i.linear_proximo_intento || Date.parse(i.linear_proximo_intento) <= ahora.getTime() ? "crear" : null;
  }
  if (i.linear_estado !== "creado" || !i.linear_issue_id) return null;
  if (destino && i.linear_destino && i.linear_destino !== destino) {
    const sigueViva = i.linear_pendiente_reapertura || (i.estado !== "resuelta" && i.ocurrencias > i.ocurrencias_en_ticket);
    return sigueViva ? "migrar" : null;
  }
  if (i.linear_pendiente_reapertura) return "reabrir";
  const ultima = i.linear_ultima_sync ? Date.parse(i.linear_ultima_sync) : 0;
  const nuevas = i.ocurrencias - i.ocurrencias_en_ticket;
  if (nuevas > 0 && (ahora.getTime() - ultima >= SEIS_HORAS || i.ocurrencias >= 2 * Math.max(i.ocurrencias_en_ticket, 1))) return "actualizar";
  if (ahora.getTime() - ultima >= SEIS_HORAS && i.estado !== "resuelta") return "sincronizar";
  return null;
}

const mensajeError = (e: unknown) => sanearTexto(e instanceof Error ? e.message : String(e), 400) ?? "error";

const RANGO_GRAVEDAD: Record<string, number> = { critico: 4, error: 3, aviso: 2, info: 1 };

/** Orden de trabajo: reaperturas, luego lo más grave y con más visitantes afectados. */
export function ordenPrioridad(a: IncidenciaFila, b: IncidenciaFila): number {
  return Number(b.linear_pendiente_reapertura) - Number(a.linear_pendiente_reapertura)
    || (RANGO_GRAVEDAD[b.gravedad] ?? 0) - (RANGO_GRAVEDAD[a.gravedad] ?? 0)
    || b.sesiones_afectadas - a.sesiones_afectadas
    || b.ocurrencias_24h - a.ocurrencias_24h
    || a.id - b.id;
}

/** El ticket ya no existe en Linear: se suelta (si vuelve a cumplir los umbrales, se crea otro con id nuevo). */
const soltarTicket = (inc: IncidenciaFila, ahora: Date, nuevoUuid: () => string) => ({
  linear_estado: "sin_ticket",
  linear_uuid: nuevoUuid(),
  linear_issue_id: null,
  linear_identificador: null,
  linear_url: null,
  linear_destino: null,
  linear_estado_remoto: `Borrado en Linear (era ${inc.linear_identificador ?? "?"}); si vuelve a repetirse se abre otro`,
  linear_pendiente_reapertura: false,
  linear_ultima_sync: ahora.toISOString(),
  linear_ultimo_error: null,
  linear_bloqueo_hasta: null,
  requiere_ticket: false,
});

export async function procesar(deps: DependenciasProceso): Promise<Record<string, unknown>> {
  const ahora = deps.ahora?.() ?? new Date();
  const log = deps.log ?? (() => {});
  const { repo } = deps;
  const resumen: Record<string, unknown> = { inicio: ahora.toISOString() };

  if (!(await repo.tomarTurno(ahora, new Date(ahora.getTime() + LIMITES.turnoMs)))) {
    return { ocupado: true };
  }
  const errores: string[] = [];
  try {
    const config = await repo.config();

    // ─── 2. Recolectores ────────────────────────────────────────────────────
    const cursores = await repo.cursores();
    const nuevosCursores = { ...cursores };
    const recolectados: EventoNormalizado[] = [];
    if (config.recoger_integraciones) {
      try {
        const desde = cursores.cron ?? new Date(ahora.getTime() - 86_400_000).toISOString();
        const fallos = await repo.fallosCron(desde);
        recolectados.push(...(await eventosDeCron(fallos)));
        if (fallos.length) nuevosCursores.cron = fallos[fallos.length - 1].start_time;
      } catch (e) {
        errores.push(`cron: ${mensajeError(e)}`);
      }
      try {
        recolectados.push(...(await eventosDeSyncTrafico(await repo.estadosSyncTrafico())));
      } catch (e) {
        errores.push(`trafico: ${mensajeError(e)}`);
      }
    }
    if (config.recoger_hosting && deps.despliegues) {
      try {
        const desdeMs = cursores.vercel ? Number(cursores.vercel) : ahora.getTime() - 2 * 86_400_000;
        recolectados.push(...(await eventosDeDespliegues(await deps.despliegues(desdeMs), config.entorno_bd)));
        nuevosCursores.vercel = String(ahora.getTime() - 10 * 60_000); // solape: lo repetido no duplica
      } catch (e) {
        errores.push(`vercel: ${mensajeError(e)}`);
      }
    }
    if (recolectados.length && config.entornos_aceptados.includes(config.entorno_bd)) {
      for (let i = 0; i < recolectados.length; i += 100) {
        await repo.ingerir(recolectados.slice(i, i + 100), config.entorno_bd);
      }
    }
    resumen.recolectados = recolectados.length;
    await repo.guardarCursores(nuevosCursores);

    // ─── 3. Agrupar ─────────────────────────────────────────────────────────
    resumen.agrupacion = await repo.agrupar();

    // ─── 4. Tickets ─────────────────────────────────────────────────────────
    const tickets = { creados: 0, reabiertos: 0, actualizados: 0, sincronizados: 0, migrados: 0, fallidos: 0, aplazados: 0 };
    resumen.tickets = tickets;
    if (config.linear_modo !== "desactivado") {
      const destino = deps.destino(config.linear_modo, config);
      if (!destino) {
        errores.push(`linear: ${deps.motivoSinDestino?.(config.linear_modo, config) ?? "destino sin configurar"}`);
      } else {
        const hoy = inicioDiaMadrid(ahora);
        const nuevoUuid = deps.nuevoUuid ?? (() => crypto.randomUUID());
        let creadosHoy = await repo.ticketsCreadosDesde(hoy, destino.tipo);
        // El tope diario de IA es uno: análisis de tickets + explicaciones en sencillo.
        let analisisHoy = (await repo.analisisDesde(hoy)) + (await repo.explicacionesDesde(hoy));
        const cupos = { crear: LIMITES.crear, actualizar: LIMITES.actualizar, sincronizar: LIMITES.sincronizar };
        const lista = [...(await repo.incidenciasConTicket(200))].sort(ordenPrioridad);
        for (const inc of lista) {
          const accion = accionPara(inc, ahora, destino.tipo);
          if (!accion) continue;
          if (accion === "crear" && (cupos.crear <= 0 || creadosHoy >= config.linear_max_tickets_dia)) {
            tickets.aplazados++;
            continue;
          }
          if (accion === "actualizar" || accion === "reabrir" || accion === "migrar") {
            if (cupos.actualizar <= 0) continue;
          }
          if (accion === "sincronizar" && cupos.sincronizar <= 0) continue;
          if (!(await repo.reclamar(inc.id, ahora, new Date(ahora.getTime() + LIMITES.reclamoMs)))) continue;
          try {
            if (accion === "crear") {
              cupos.crear--;
              const r = await crearTicket(deps, destino, config, inc, ahora, analisisHoy < config.ia_max_analisis_dia);
              if (r.analizada) analisisHoy++;
              if (r.creado) {
                creadosHoy++;
                tickets.creados++;
              } else tickets.aplazados++;
            } else if (accion === "migrar") {
              cupos.actualizar--;
              const antes = inc.linear_identificador ?? inc.linear_issue_id ?? "?";
              await repo.actualizar(inc.id, {
                linear_estado: "pendiente", linear_uuid: nuevoUuid(), linear_issue_id: null, linear_identificador: null, linear_url: null,
                linear_estado_remoto: null, linear_destino: null, linear_intentos: 0, linear_ultimo_error: null, linear_proximo_intento: ahora.toISOString(),
                linear_pendiente_reapertura: false, linear_bloqueo_hasta: null, requiere_ticket: true,
                motivo_ticket: `${inc.motivo_ticket ? `${inc.motivo_ticket} · ` : ""}Sigue repitiéndose: pasa del destino de ${inc.linear_destino === "prueba" ? "pruebas" : "Linear"} (${antes}) al actual`.slice(0, 500),
              });
              tickets.migrados++;
            } else if (accion === "reabrir") {
              cupos.actualizar--;
              // Primero el estado (repetirlo no duplica nada) y después el comentario.
              const estadoNuevo = await destino.reabrir(inc.linear_issue_id!, config.linear_estado_reabrir_id, inc.id);
              await destino.comentar(inc.linear_issue_id!, construirReapertura(inc, estadoNuevo), inc.id);
              await repo.actualizar(inc.id, {
                linear_pendiente_reapertura: false, ocurrencias_en_ticket: inc.ocurrencias, linear_ultima_sync: ahora.toISOString(),
                linear_ultimo_error: null, linear_bloqueo_hasta: null, ...(estadoNuevo ? { linear_estado_remoto: estadoNuevo } : {}),
              });
              tickets.reabiertos++;
            } else if (accion === "actualizar") {
              cupos.actualizar--;
              await destino.comentar(inc.linear_issue_id!, construirActualizacion(inc, inc.ocurrencias_en_ticket), inc.id);
              await repo.actualizar(inc.id, {
                ocurrencias_en_ticket: inc.ocurrencias, linear_ultima_sync: ahora.toISOString(), linear_ultimo_error: null, linear_bloqueo_hasta: null,
              });
              tickets.actualizados++;
            } else if (accion === "sincronizar") {
              cupos.sincronizar--;
              const t = await destino.consultar(inc.linear_issue_id!);
              const cambios: Record<string, unknown> = t ? { linear_ultima_sync: ahora.toISOString(), linear_bloqueo_hasta: null } : soltarTicket(inc, ahora, nuevoUuid);
              if (t) {
                cambios.linear_estado_remoto = t.estadoNombre;
                // Resuelto en Linear → resuelta aquí (si reaparece, se reabre sola). Cancelado/duplicado → ignorada.
                if (t.estadoTipo === "completed" && inc.estado !== "resuelta") cambios.estado = "resuelta";
                if ((t.estadoTipo === "canceled" || t.estadoTipo === "duplicate") && inc.estado !== "ignorada") cambios.estado = "ignorada";
              }
              await repo.actualizar(inc.id, cambios);
              tickets.sincronizados++;
            }
          } catch (e) {
            tickets.fallidos++;
            const intentos = inc.linear_intentos + 1;
            log(`[procesar-logs-web] incidencia ${inc.id} (${accion}): ${mensajeError(e)}`);
            if (accion !== "crear" && e instanceof ErrorLinear && e.codigo === "no_encontrado") {
              await repo.actualizar(inc.id, soltarTicket(inc, ahora, nuevoUuid)).catch(() => {});
              continue;
            }
            await repo.actualizar(inc.id, {
              ...(accion === "crear" ? { linear_estado: "error", linear_intentos: intentos } : {}),
              linear_ultimo_error: mensajeError(e),
              linear_proximo_intento: siguienteIntento(intentos, ahora).toISOString(),
              linear_bloqueo_hasta: null,
              // Fallo de una actualización: se reintenta en la próxima ventana (no se pierde la cuenta).
              ...(accion !== "crear" ? { linear_ultima_sync: ahora.toISOString() } : {}),
            }).catch(() => {});
            if (e instanceof ErrorLinear && e.codigo === "clave") {
              errores.push(`linear: ${mensajeError(e)}`);
              break; // con la clave rechazada no tiene sentido seguir
            }
          }
        }
      }
    }

    // ─── 4 bis. Explicación en sencillo ─────────────────────────────────────
    const explicaciones = { hechas: 0, fallidas: 0 };
    resumen.explicaciones = explicaciones;
    if (config.ia_activada && deps.iaExplicar) {
      try {
        const hoy = inicioDiaMadrid(ahora);
        const analisisHoy = await repo.analisisDesde(hoy);
        let explicadasHoy = await repo.explicacionesDesde(hoy);
        for (const inc of await repo.incidenciasSinExplicar(30)) {
          if (explicaciones.hechas + explicaciones.fallidas >= LIMITES.explicar) break;
          if (explicadasHoy >= maxExplicacionesDia(config.ia_max_analisis_dia) || analisisHoy + explicadasHoy >= config.ia_max_analisis_dia) break;
          const muestras = await repo.muestras(inc.id);
          if (!necesitaExplicacion(inc, muestras)) continue;
          explicadasHoy++;
          const intento = { explicacion_ia_intentos: inc.explicacion_ia_intentos + 1, explicacion_ia_en: ahora.toISOString() };
          try {
            const r = await deps.iaExplicar(mensajesExplicacion(inc, muestras), `explicacion:${inc.id}`);
            await repo.actualizar(inc.id, { ...intento, explicacion_ia: { ...interpretarExplicacion(r.texto, inc), modelo: r.modelo }, explicacion_ia_error: null });
            explicaciones.hechas++;
          } catch (e) {
            await repo.actualizar(inc.id, { ...intento, explicacion_ia_error: mensajeError(e) }).catch(() => {});
            explicaciones.fallidas++;
          }
        }
      } catch (e) {
        errores.push(`explicaciones: ${mensajeError(e)}`);
      }
    }

    // ─── 5. Purga diaria ────────────────────────────────────────────────────
    const ultimaPurga = await repo.ultimaPurga();
    if (!ultimaPurga || ahora.getTime() - Date.parse(ultimaPurga) > 20 * 3_600_000) {
      resumen.purga = await repo.purgar();
    }
  } catch (e) {
    errores.push(mensajeError(e));
  } finally {
    resumen.errores = errores;
    await repo.terminarTurno({ ok: errores.length === 0, error: errores.length ? errores.join(" · ").slice(0, 1000) : null, resumen, ahora: deps.ahora?.() ?? new Date() })
      .catch((e) => log(`[procesar-logs-web] no se pudo guardar el estado: ${mensajeError(e)}`));
  }
  return resumen;
}

async function crearTicket(
  deps: DependenciasProceso,
  destino: DestinoTickets,
  config: ConfigLogs,
  inc: IncidenciaFila,
  ahora: Date,
  quedaCupoIa: boolean,
): Promise<{ creado: boolean; analizada: boolean }> {
  const { repo } = deps;
  const muestras = await repo.muestras(inc.id);
  const eventoErrorId = await repo.ultimoErrorConSesion(inc.id);
  const recorrido = eventoErrorId ? await repo.contexto(eventoErrorId) : [];
  const entrada = { incidencia: inc, muestras, recorrido, eventoErrorId, analisis: inc.analisis_ia, motivoSinAnalisis: null as string | null, urlPanel: deps.urlPanel, ahora };

  let analizada = false;
  if (!entrada.analisis) {
    if (!config.ia_activada) entrada.motivoSinAnalisis = "el análisis de IA está desactivado en Configuración";
    else if (!deps.ia) entrada.motivoSinAnalisis = "no hay clave de IA configurada en el servidor";
    else if (!quedaCupoIa) entrada.motivoSinAnalisis = "se alcanzó el tope diario de análisis de IA";
    else {
      try {
        analizada = true;
        const r = await deps.ia(mensajesIncidencia(entrada));
        entrada.analisis = { ...interpretarAnalisis(r.texto, entrada), modelo: r.modelo };
        await repo.actualizar(inc.id, { analisis_ia: entrada.analisis, analisis_ia_en: ahora.toISOString(), analisis_ia_error: null });
      } catch (e) {
        await repo.actualizar(inc.id, { analisis_ia_error: mensajeError(e) });
        // La IA falló: se reintenta dos veces más tarde; después el ticket sale sin análisis (y lo dice).
        if (inc.linear_intentos < 2) {
          await repo.actualizar(inc.id, {
            linear_intentos: inc.linear_intentos + 1, linear_proximo_intento: siguienteIntento(inc.linear_intentos + 1, ahora).toISOString(),
            linear_bloqueo_hasta: null,
          });
          return { creado: false, analizada };
        }
        entrada.motivoSinAnalisis = `la IA no respondió (${mensajeError(e)})`;
      }
    }
  }

  const { titulo, descripcion } = construirTicket(entrada);
  const ticket = await destino.crear({
    id: inc.linear_uuid,
    equipoId: config.linear_equipo_id,
    proyectoId: config.linear_proyecto_id,
    titulo,
    descripcion,
    prioridad: prioridadLinear(inc.gravedad, inc.sesiones_afectadas),
    etiquetas: config.linear_etiquetas,
    incidenciaId: inc.id,
  });
  await repo.actualizar(inc.id, {
    linear_estado: "creado",
    linear_issue_id: ticket.id,
    linear_identificador: ticket.identificador,
    linear_url: ticket.url,
    linear_estado_remoto: ticket.estadoNombre,
    linear_destino: destino.tipo,
    linear_creado_en: ahora.toISOString(),
    linear_ultima_sync: ahora.toISOString(),
    linear_intentos: 0,
    linear_ultimo_error: null,
    linear_proximo_intento: null,
    linear_bloqueo_hasta: null,
    linear_pendiente_reapertura: false,
    ocurrencias_en_ticket: inc.ocurrencias,
    ...(inc.estado === "nueva" || inc.estado === "reabierta" ? { estado: "abierta" } : {}),
  });
  return { creado: true, analizada };
}
