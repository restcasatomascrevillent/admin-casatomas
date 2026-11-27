/**
 * Edge Function rrss-menu — manda a rrss (Redes) las tapas de un día para que monte la
 * historia con SU plantilla de tapas y la programe. Sustituye a la historia automática
 * antigua (instagram-programador), que ya no se crea cuando Redes está configurada.
 * Diseño en el repo de rrss: docs/integracion-casatomas.md §13; aquí, docs/redes-rrss.md.
 *
 *   POST `${SUPABASE_URL}/functions/v1/rrss-menu`   Authorization: Bearer <JWT del panel>
 *     { fecha: "AAAA-MM-DD" }
 *     → 200 { success, estado }   estado: enviada | sin-cambios | desactivada | web-apagada | pasada
 *     → 400 fecha no válida · 401 sin sesión · 403 sin «Redes» con «Puede editar» · 404 sin tapas ese día
 *     → 409 ya publicada esa semana (en rrss o con la historia antigua) o cancelada en rrss
 *     → 422 las tapas no caben · 502 rrss no responde · 503 sin configurar
 *
 * Las tapas NO las manda el navegador: se leen aquí de la tabla `tapas` (lo guardado).
 * El pedido es un JWT ES256 firmado con la misma clave que los pases
 * (RRSS_EMBED_PRIVATE_JWK), `typ: "rrss-menu"`, 60 s y `jti` de un solo uso, con el
 * nivel en Redes de quien guarda (rrss solo lo acepta si en la integración es «editor»).
 * Va servidor a servidor a RRSS_EMBED_MENU_URL (`…/functions/v1/embed-session/menu`).
 *
 * Para no publicar dos veces: si la historia antigua de esa semana ya salió, no se pide
 * otra; si estaba programada, se cancela (sin cron ya no saldría, pero si alguien
 * deshace la migración de los cron, saldría junto a la de rrss).
 */
import { firmarPase, leerConfig, nivelRedes, type DependenciasPase } from "../rrss-embed-pass/pase.ts";
import { exigirPermiso, respuestaJson } from "../_shared/autorizacion.ts";

export const VIDA_PEDIDO_SEGUNDOS = 60;
export const MAX_TAPAS = 12;
export const HORA_POR_DEFECTO = "12:00";
/** Si la hora ya ha pasado, dentro de estos minutos. */
export const MINUTOS_SI_YA_PASO = 15;

const ZONA = "Europe/Madrid";
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

export interface TapaPedido {
  name: string;
  price?: string;
}

export interface MenuPedido {
  key: string;
  kind: "tapas";
  publish_at: string;
  day: string;
  title: string;
  kicker: string;
  footer?: string;
  items: TapaPedido[];
}

/** Lo que se lee del panel (con la clave de servicio). */
export interface DatosPanel {
  tapas(fecha: string): Promise<string[] | null>;
  /** «Mostrar Tapas en la web». */
  tapasEnLaWeb(): Promise<boolean>;
  /** Ajustes de la historia del jueves (activa y hora). */
  ajustes(): Promise<{ activa: boolean; hora: string }>;
  /** «20:30 y 22:00», o null. */
  turnos(): Promise<string | null>;
  /** ¿Salió ya (o está saliendo) la historia antigua de esa semana? */
  historiaAntiguaPublicada(semana: string): Promise<boolean>;
  /** Cancela la historia antigua de esa semana si estaba programada (una vez aceptado el pedido). */
  cancelarHistoriaAntigua(semana: string): Promise<void>;
}

export interface DependenciasMenu extends DependenciasPase {
  datos?: DatosPanel;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Instante actual (pruebas). */
  ahoraFecha?: () => Date;
}

function partes(dia: string): { a: number; m: number; d: number } {
  const [a, m, d] = dia.split("-").map(Number);
  return { a, m, d };
}

export function esDia(dia: unknown): dia is string {
  if (typeof dia !== "string" || !RE_DIA.test(dia)) return false;
  const { a, m, d } = partes(dia);
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

/** Lunes de la semana del día. */
export function semanaDe(dia: string): string {
  const { a, m, d } = partes(dia);
  const f = new Date(Date.UTC(a, m - 1, d));
  f.setUTCDate(f.getUTCDate() - ((f.getUTCDay() + 6) % 7));
  return f.toISOString().slice(0, 10);
}

function enMadrid(instante: Date): { dia: string; hora: string } {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  })
    .formatToParts(instante)
    .reduce<Record<string, string>>((o, x) => ((o[x.type] = x.value), o), {});
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

export function hoyEnMadrid(ahora: Date): string {
  return enMadrid(ahora).dia;
}

/** «HH:MM» válida; acepta «HH:MM:SS» de Postgres. */
export function normalizarHora(hora: unknown): string {
  const m = typeof hora === "string" ? /^(\d{1,2}):(\d{2})/.exec(hora) : null;
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return HORA_POR_DEFECTO;
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/** Instante de un día y hora de Madrid (con el cambio de hora). */
export function madridAInstante(dia: string, hora: string): Date {
  const { a, m, d } = partes(dia);
  const [h, min] = hora.split(":").map(Number);
  for (const desfase of [1, 2]) {
    const t = new Date(Date.UTC(a, m - 1, d, h - desfase, min));
    const v = enMadrid(t);
    if (v.dia === dia && v.hora === `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`) return t;
  }
  return new Date(Date.UTC(a, m - 1, d, h - 1, min));
}

/** El día a esa hora de Madrid; si ya ha pasado (o queda muy poco), dentro de 15 minutos. */
export function instantePublicacion(dia: string, hora: string, ahora: Date): Date {
  const objetivo = madridAInstante(dia, normalizarHora(hora));
  const minimo = ahora.getTime() + MINUTOS_SI_YA_PASO * 60_000;
  return objetivo.getTime() < minimo ? new Date(minimo) : objetivo;
}

const PRECIO = /^(.*?)\s*(?:[|·:–—-]\s*|\s)(\d{1,3}(?:[.,]\d{1,2})?\s?€)$/u;

/**
 * Una línea de tapas de Gestión web → nombre y precio. Admite «Croquetas | 2,50 €»,
 * «Croquetas · 2,50 €» o «Croquetas 2,50€». Sin comillas ni barras invertidas (rrss
 * compara los nombres con el texto de la historia) ni caracteres de control.
 */
export function leerTapa(linea: string): TapaPedido | null {
  // eslint-disable-next-line no-control-regex
  const limpia = linea.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/["\\]/g, "").replace(/\s+/g, " ").trim();
  if (!limpia) return null;
  const barra = limpia.lastIndexOf("|");
  let nombre = limpia;
  let precio = "";
  if (barra >= 0) {
    nombre = limpia.slice(0, barra).trim();
    precio = limpia.slice(barra + 1).trim();
  } else {
    const m = PRECIO.exec(limpia);
    if (m && m[1].trim()) {
      nombre = m[1].trim();
      precio = m[2].replace(/\s?€$/, " €");
    }
  }
  nombre = nombre.slice(0, 80).trim();
  if (!nombre) return null;
  precio = precio.slice(0, 20).trim();
  return precio ? { name: nombre, price: precio } : { name: nombre };
}

/** Las tapas guardadas → la lista del pedido (sin vacías ni repetidas). */
export function tapasDelPedido(lineas: readonly string[]): TapaPedido[] {
  const vistas = new Set<string>();
  const r: TapaPedido[] = [];
  for (const l of lineas) {
    const t = leerTapa(l);
    if (!t || vistas.has(t.name.toLowerCase())) continue;
    vistas.add(t.name.toLowerCase());
    r.push(t);
  }
  return r;
}

/** El menú que va a rrss. */
export function menuDelDia(e: { dia: string; tapas: TapaPedido[]; hora: string; turnos: string | null; ahora: Date }): MenuPedido {
  const { m, d } = partes(e.dia);
  const nombre = DIAS[new Date(Date.UTC(partes(e.dia).a, m - 1, d)).getUTCDay()];
  const menu: MenuPedido = {
    key: `tapas:${semanaDe(e.dia)}`,
    kind: "tapas",
    publish_at: instantePublicacion(e.dia, e.hora, e.ahora).toISOString(),
    day: e.dia,
    title: `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)} de tapas`,
    kicker: `${d} de ${MESES[m - 1]}`,
    items: e.tapas,
  };
  if (e.turnos?.trim()) menu.footer = `Turnos ${e.turnos.trim()}`.slice(0, 300);
  return menu;
}

/** «20:30 y 22:00» de las horas fijas de configuracion_turnos. */
export function textoTurnos(horas: unknown): string | null {
  if (!Array.isArray(horas)) return null;
  const hs = horas
    .map((h) => (typeof h === "string" ? /^(\d{2}):(\d{2})/.exec(h) : null))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => `${m[1]}:${m[2]}`)
    .sort();
  if (hs.length < 2) return null;
  return `${hs.slice(0, -1).join(", ")} y ${hs[hs.length - 1]}`;
}

function envDeDeno(nombre: string): string | undefined {
  return (globalThis as typeof globalThis & { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(nombre);
}

/** Lecturas de verdad, con la clave de servicio del panel (nunca en el navegador). */
export function datosDelPanel(deps: DependenciasMenu): DatosPanel {
  const env = deps.env ?? envDeDeno;
  const sb = deps.crearCliente(env("SUPABASE_URL") ?? "", env("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async tapas(fecha) {
      const { data, error } = await sb.from("tapas").select("tapas").eq("fecha", fecha).eq("idiom", "es").maybeSingle();
      if (error) throw new Error("No se pudieron leer las tapas");
      if (!data || !Array.isArray(data.tapas)) return null;
      return (data.tapas as unknown[]).filter((t): t is string => typeof t === "string");
    },
    async tapasEnLaWeb() {
      const { data, error } = await sb.from("configuracion_web").select("mostrar_tapas_casa_tomas").eq("id", true).maybeSingle();
      if (error) return false;
      return data?.mostrar_tapas_casa_tomas !== false;
    },
    async ajustes() {
      const { data } = await sb.from("instagram_story_tapas_ajustes").select("activa, hora").eq("id", true).maybeSingle();
      return { activa: data?.activa !== false, hora: normalizarHora(data?.hora) };
    },
    async turnos() {
      const { data, error } = await sb
        .from("configuracion_turnos")
        .select("horas_fijas, dias_semana, activo")
        .eq("activo", true)
        .contains("dias_semana", [4])
        .not("horas_fijas", "is", null);
      if (error || !Array.isArray(data)) return null;
      for (const f of data) {
        const t = textoTurnos(f.horas_fijas);
        if (t) return t;
      }
      return null;
    },
    async historiaAntiguaPublicada(semana) {
      const { data } = await sb.from("instagram_story_tapas").select("estado, programacion_id").eq("semana", semana).maybeSingle();
      if (!data) return false;
      if (data.estado === "publicada") return true;
      if (!data.programacion_id) return false;
      const { data: prog } = await sb.from("instagram_programaciones").select("estado").eq("id", data.programacion_id).maybeSingle();
      return prog?.estado === "publicada" || prog?.estado === "publicando";
    },
    async cancelarHistoriaAntigua(semana) {
      const { data } = await sb.from("instagram_story_tapas").select("estado, programacion_id").eq("semana", semana).maybeSingle();
      if (!data || data.estado === "publicada" || data.estado === "cancelada") return;
      if (data.programacion_id) {
        await sb
          .from("instagram_programaciones")
          .update({ estado: "cancelada", cancelada_at: new Date().toISOString() })
          .eq("id", data.programacion_id)
          .in("estado", ["programada", "error"]);
      }
      await sb.from("instagram_story_tapas").update({ estado: "cancelada" }).eq("semana", semana).neq("estado", "publicada");
    },
  };
}

const json = (cors: Record<string, string>, status: number, body: Record<string, unknown>) =>
  respuestaJson(body, status, { ...cors, "Cache-Control": "no-store" });

export async function manejarMenu(req: Request, deps: DependenciasMenu): Promise<Response> {
  const env = deps.env ?? envDeDeno;
  const permitidos = (env("RRSS_EMBED_PANEL_ORIGINS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);
  const origen = req.headers.get("Origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    ...(permitidos.includes(origen) ? { "Access-Control-Allow-Origin": origen } : {}),
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json(cors, 405, { success: false, error: "Método no permitido" });

  const config = leerConfig(env);
  const destino = env("RRSS_EMBED_MENU_URL")?.trim() ?? "";
  if (!config || !/^https:\/\/[^\s]+$/.test(destino)) {
    console.error("[rrss-menu] Falta la configuración (RRSS_EMBED_* o RRSS_EMBED_MENU_URL).");
    return json(cors, 503, { success: false, error: "Redes no está configurada en este entorno." });
  }
  const usuario = await exigirPermiso(req, "redes", "edit", { ...deps, corsHeaders: cors });
  if (!usuario.ok) return usuario.response;
  const cuerpo = (await req.json().catch(() => null)) as { fecha?: unknown } | null;
  if (!esDia(cuerpo?.fecha)) return json(cors, 400, { success: false, error: "Día no válido." });
  const fecha = cuerpo.fecha;

  let nivel;
  try {
    nivel = await nivelRedes(usuario.userId, deps);
  } catch {
    return json(cors, 503, { success: false, error: "No se pudo comprobar tu permiso." });
  }
  if (nivel !== "superadmin" && nivel !== "editar") {
    return json(cors, 403, { success: false, error: "Hace falta «Redes» con «Puede editar» para mandar las tapas." });
  }

  const datos = deps.datos ?? datosDelPanel(deps);
  const ahora = (deps.ahoraFecha ?? (() => new Date()))();
  if (fecha < hoyEnMadrid(ahora)) return json(cors, 200, { success: true, estado: "pasada" });
  const ajustes = await datos.ajustes();
  if (!ajustes.activa) return json(cors, 200, { success: true, estado: "desactivada" });
  if (!(await datos.tapasEnLaWeb())) return json(cors, 200, { success: true, estado: "web-apagada" });
  const lineas = await datos.tapas(fecha);
  if (!lineas) return json(cors, 404, { success: false, error: "No hay tapas guardadas ese día." });
  const tapas = tapasDelPedido(lineas);
  if (tapas.length === 0) return json(cors, 404, { success: false, error: "No hay tapas guardadas ese día." });
  if (tapas.length > MAX_TAPAS) {
    return json(cors, 422, { success: false, error: `En la historia caben ${MAX_TAPAS} tapas como mucho.` });
  }
  const semana = semanaDe(fecha);
  if (await datos.historiaAntiguaPublicada(semana)) {
    return json(cors, 409, { success: false, error: "La historia de tapas de esta semana ya se publicó con el sistema antiguo." });
  }
  const menu = menuDelDia({ dia: fecha, tapas, hora: ajustes.hora, turnos: await datos.turnos().catch(() => null), ahora });

  const t = Math.floor(ahora.getTime() / 1000);
  const pedido = await firmarPase(config, {
    iss: config.issuer,
    aud: config.audience,
    sub: usuario.userId,
    brand: config.brandId,
    role: nivel,
    typ: "rrss-menu",
    iat: t,
    exp: t + VIDA_PEDIDO_SEGUNDOS,
    jti: (deps.nuevoId ?? (() => crypto.randomUUID()))(),
    menu,
  });
  const enviar = deps.fetch ?? ((url, init) => fetch(url, init));
  const respuesta = await enviar(destino, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ request: pedido }),
  }).catch(() => null);
  if (!respuesta) return json(cors, 502, { success: false, error: "Redes no responde. Inténtalo en un momento." });
  const r = (await respuesta.json().catch(() => null)) as { result?: string; error?: { code?: string } } | null;
  if (respuesta.ok) {
    await datos.cancelarHistoriaAntigua(semana).catch(() => console.error("[rrss-menu] no se pudo cancelar la historia antigua"));
    console.log("[rrss-menu] pedido enviado", JSON.stringify({ result: r?.result ?? null }));
    return json(cors, 200, { success: true, estado: r?.result === "unchanged" ? "sin-cambios" : "enviada", programadaPara: menu.publish_at });
  }
  const codigo = r?.error?.code ?? "";
  console.error("[rrss-menu] rrss no aceptó el pedido", JSON.stringify({ status: respuesta.status, codigo }));
  if (codigo === "published") return json(cors, 409, { success: false, error: "La historia de tapas de esta semana ya se publicó." });
  if (codigo === "cancelled") return json(cors, 409, { success: false, error: "La historia de tapas de esta semana se canceló en Redes." });
  if (respuesta.status === 422) return json(cors, 422, { success: false, error: "Redes no ha aceptado las tapas (¿demasiado largas?)." });
  return json(cors, 502, { success: false, error: "Redes no ha aceptado las tapas. Inténtalo en un momento." });
}
