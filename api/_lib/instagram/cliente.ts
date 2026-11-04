/**
 * Cliente mínimo de la Graph API para publicar en Instagram con un token de
 * USUARIO DEL SISTEMA (configuración «API setup with Unified login»).
 *
 *  - Host: https://graph.facebook.com (NUNCA graph.instagram.com con este token).
 *  - Versión configurable (META_API_VERSION, por defecto v26.0).
 *  - El token va en la cabecera `Authorization: Bearer`. La única excepción es
 *    /debug_token, que exige input_token (y access_token si es el de la app)
 *    en la query: esa URL se sanea antes de registrarla.
 *  - Reintentos con espera creciente solo para errores transitorios.
 *  - `fetch`, `dormir` y `ahora` se inyectan para poder probar sin red.
 */
import { sanear, sanearUrl, mensajeSaneado, registrarSecreto } from "./secretos.js";
import { VERSION_API_POR_DEFECTO } from "./entorno.js";
import { ErrorInstagram, mapearErrorGraph, tipoDesdeTextoEstado, textoDeTipo } from "./errores.js";

export const HOST_GRAPH = "https://graph.facebook.com";

export type FuncionFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpcionesCliente {
  token: string;
  versionApi?: string | undefined;
  /** ID de la cuenta de Instagram por defecto para los métodos que lo usan. */
  igUserId?: string | undefined;
  appId?: string | undefined;
  appSecret?: string | undefined;
  fetch?: FuncionFetch | undefined;
  /** Tiempo máximo por petición (ms). Por defecto 30 s. */
  timeoutMs?: number | undefined;
  /** Reintentos extra para errores transitorios. Por defecto 3. */
  reintentos?: number | undefined;
  /** Espera base del backoff exponencial (ms). Por defecto 1000. */
  esperaBaseMs?: number | undefined;
  dormir?: ((ms: number) => Promise<void>) | undefined;
  ahora?: (() => number) | undefined;
  /** Registro de cada llamada (método, ruta y estado HTTP; nunca credenciales). */
  registro?: ((linea: string) => void) | undefined;
}

export interface CuentaIg {
  id: string;
  username: string | null;
}

export interface PaginaConCuenta {
  paginaId: string;
  paginaNombre: string | null;
  cuenta: CuentaIg | null;
}

export interface PerfilIg {
  id: string;
  username: string | null;
  name: string | null;
  mediaCount: number | null;
}

export interface DatosDepuracion {
  app_id?: string;
  application?: string;
  type?: string;
  is_valid?: boolean;
  expires_at?: number;
  data_access_expires_at?: number;
  scopes?: string[];
  granular_scopes?: Array<{ scope: string; target_ids?: string[] }>;
  user_id?: string;
  error?: { code?: number; message?: string; subcode?: number };
}

export type ModoDepuracion = "token_app" | "token_propio";

export interface PermisoConcedido {
  permission: string;
  status: string;
}

export interface LimitePublicacion {
  usadas: number;
  /** config.quota_total: NUNCA se supone un valor fijo (la doc dice 50 y 100). */
  total: number | null;
  duracionSegundos: number | null;
  restantes: number | null;
}

export type TipoPublicacion = "post" | "story";

export interface DatosContenedor {
  imageUrl: string;
  caption?: string | undefined;
  tipo: TipoPublicacion;
  /** Texto alternativo; solo se envía en publicaciones de feed. */
  altText?: string | undefined;
  igUserId?: string | undefined;
}

export type EstadoContenedor = "EXPIRED" | "ERROR" | "FINISHED" | "IN_PROGRESS" | "PUBLISHED";

export interface InfoContenedor {
  id: string;
  estado: EstadoContenedor | string;
  /** Campo `status` (texto libre de Meta, saneado). */
  detalle: string | null;
}

export interface OpcionesSondeo {
  /** Intervalo entre consultas. Por defecto 5 s (Meta sugiere 1 por minuto: ajústalo si publicas mucho). */
  intervaloMs?: number | undefined;
  /** Tiempo total máximo. Por defecto 5 min. */
  maxMs?: number | undefined;
  alConsultar?: ((info: InfoContenedor, transcurridoMs: number) => void) | undefined;
}

export const SONDEO_POR_DEFECTO = { intervaloMs: 5_000, maxMs: 5 * 60_000 } as const;

type Metodo = "GET" | "POST" | "DELETE";

interface OpcionesPeticion {
  consulta?: Record<string, string>;
  cuerpo?: Record<string, string>;
  /** «bearer» (por defecto) o «ninguna» (la credencial va ya en la consulta). */
  auth?: "bearer" | "ninguna";
  reintentos?: number;
}

const dormirReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ClienteGraph {
  private readonly token: string;
  readonly versionApi: string;
  readonly igUserId: string | undefined;
  private readonly appId: string | undefined;
  private readonly appSecret: string | undefined;
  private readonly fetch: FuncionFetch;
  private readonly timeoutMs: number;
  private readonly reintentos: number;
  private readonly esperaBaseMs: number;
  private readonly dormir: (ms: number) => Promise<void>;
  private readonly ahora: () => number;
  private readonly registro: ((linea: string) => void) | undefined;

  constructor(o: OpcionesCliente) {
    if (!o.token) throw new Error("ClienteGraph: falta el token (IG_ACCESS_TOKEN).");
    this.token = o.token;
    registrarSecreto(o.token);
    registrarSecreto(o.appSecret);
    this.versionApi = o.versionApi ?? VERSION_API_POR_DEFECTO;
    this.igUserId = o.igUserId;
    this.appId = o.appId;
    this.appSecret = o.appSecret;
    this.fetch = o.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.reintentos = o.reintentos ?? 3;
    this.esperaBaseMs = o.esperaBaseMs ?? 1_000;
    this.dormir = o.dormir ?? dormirReal;
    this.ahora = o.ahora ?? Date.now;
    this.registro = o.registro;
  }

  /** «…abcd» del token, para informes. */
  get tokenEnmascarado(): string {
    return this.token.length >= 12 ? `…${this.token.slice(-4)}` : "…(oculto)";
  }

  private idCuenta(igUserId?: string): string {
    const id = igUserId ?? this.igUserId;
    if (!id) throw new Error("ClienteGraph: falta IG_USER_ID para esta operación.");
    return id;
  }

  private url(ruta: string, consulta?: Record<string, string>): string {
    const limpia = ruta.startsWith("/") ? ruta : `/${ruta}`;
    const u = new URL(`${HOST_GRAPH}/${this.versionApi}${limpia}`);
    for (const [k, v] of Object.entries(consulta ?? {})) u.searchParams.set(k, v);
    return u.toString();
  }

  /** Petición con reintentos, timeout, mapeo de errores y saneado. */
  async peticion<T>(metodo: Metodo, ruta: string, op: OpcionesPeticion = {}): Promise<T> {
    const url = this.url(ruta, op.consulta);
    const rutaVisible = sanearUrl(url).replace(HOST_GRAPH, "");
    const cabeceras: Record<string, string> = { Accept: "application/json" };
    if ((op.auth ?? "bearer") === "bearer") cabeceras.Authorization = `Bearer ${this.token}`;
    const init: RequestInit = { method: metodo, headers: cabeceras };
    if (op.cuerpo) {
      cabeceras["Content-Type"] = "application/x-www-form-urlencoded";
      init.body = new URLSearchParams(op.cuerpo).toString();
    }

    const maxReintentos = op.reintentos ?? this.reintentos;
    let intento = 0;
    for (;;) {
      let error: ErrorInstagram;
      try {
        const respuesta = await this.fetch(url, { ...init, signal: AbortSignal.timeout(this.timeoutMs) });
        const texto = await respuesta.text();
        let cuerpo: unknown = null;
        try {
          cuerpo = texto ? JSON.parse(texto) : null;
        } catch {
          cuerpo = null;
        }
        this.registro?.(sanear(`${metodo} ${rutaVisible} → ${respuesta.status}`));
        const conError = cuerpo !== null && typeof cuerpo === "object" && "error" in cuerpo;
        if (respuesta.ok && !conError) {
          if (cuerpo === null) {
            throw new ErrorInstagram({
              tipo: "respuesta_inesperada",
              mensaje: `Respuesta no JSON de ${metodo} ${rutaVisible} (HTTP ${respuesta.status})`,
            });
          }
          return cuerpo as T;
        }
        error = mapearErrorGraph({ estadoHttp: respuesta.status, cuerpo, cabeceras: respuesta.headers });
      } catch (e) {
        if (e instanceof ErrorInstagram) {
          error = e;
        } else {
          const esTimeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
          this.registro?.(sanear(`${metodo} ${rutaVisible} → ${esTimeout ? "tiempo agotado" : "error de red"}`));
          error = new ErrorInstagram({
            tipo: esTimeout ? "tiempo_agotado" : "red",
            mensaje: `${textoDeTipo(esTimeout ? "tiempo_agotado" : "red").mensaje} (${metodo} ${rutaVisible}): ${mensajeSaneado(e)}`,
          });
        }
      }

      // «Contenedor inexistente» solo se reintenta 1-2 veces (puede tardar en propagarse).
      const limite = error.tipo === "contenedor_inexistente" ? Math.min(maxReintentos, 2) : maxReintentos;
      if (!error.reintentable || intento >= limite) throw error;
      const espera = this.esperaBaseMs * 2 ** intento;
      this.registro?.(`  reintento ${intento + 1}/${limite} en ${Math.round(espera / 100) / 10} s (${error.tipo})`);
      await this.dormir(espera);
      intento++;
    }
  }

  // ── Identidad ────────────────────────────────────────────────────────────

  /** Cuentas de Instagram asignadas al usuario del sistema (Unified login). */
  async cuentasAsignadas(): Promise<CuentaIg[]> {
    const r = await this.peticion<{ data?: Array<{ id: string; username?: string }> }>(
      "GET",
      "/me/assigned_instagram_accounts",
      { consulta: { fields: "id,username" } },
    );
    return (r.data ?? []).map((c) => ({ id: String(c.id), username: c.username ?? null }));
  }

  /** Ruta alternativa: páginas del usuario → instagram_business_account de cada una. */
  async cuentaDesdePaginas(): Promise<PaginaConCuenta[]> {
    const r = await this.peticion<{ data?: Array<{ id: string; name?: string }> }>("GET", "/me/accounts", {
      consulta: { fields: "id,name", limit: "100" },
    });
    const salida: PaginaConCuenta[] = [];
    for (const pagina of r.data ?? []) {
      const p = await this.peticion<{ instagram_business_account?: { id: string; username?: string } }>(
        "GET",
        `/${encodeURIComponent(pagina.id)}`,
        { consulta: { fields: "instagram_business_account{id,username}" } },
      );
      const cuenta = p.instagram_business_account;
      salida.push({
        paginaId: String(pagina.id),
        paginaNombre: pagina.name ?? null,
        cuenta: cuenta ? { id: String(cuenta.id), username: cuenta.username ?? null } : null,
      });
    }
    return salida;
  }

  async perfil(igUserId?: string): Promise<PerfilIg> {
    const id = this.idCuenta(igUserId);
    const r = await this.peticion<{ id: string; username?: string; name?: string; media_count?: number }>(
      "GET",
      `/${encodeURIComponent(id)}`,
      { consulta: { fields: "id,username,name,media_count" } },
    );
    return {
      id: String(r.id),
      username: r.username ?? null,
      name: r.name ?? null,
      mediaCount: typeof r.media_count === "number" ? r.media_count : null,
    };
  }

  // ── Token ────────────────────────────────────────────────────────────────

  /**
   * GET /debug_token. Con «token_app» usa `${META_APP_ID}|${META_APP_SECRET}`
   * como access_token (método documentado); con «token_propio» se autentica con
   * el propio IG_ACCESS_TOKEN (no verificado en la documentación).
   */
  async depurarToken(modo: ModoDepuracion): Promise<DatosDepuracion> {
    let r: { data?: DatosDepuracion };
    if (modo === "token_app") {
      if (!this.appId || !this.appSecret) {
        throw new Error("depurarToken(token_app) necesita META_APP_ID y META_APP_SECRET.");
      }
      const tokenApp = `${this.appId}|${this.appSecret}`;
      registrarSecreto(tokenApp);
      r = await this.peticion("GET", "/debug_token", {
        consulta: { input_token: this.token, access_token: tokenApp },
        auth: "ninguna",
        reintentos: 1,
      });
    } else {
      r = await this.peticion("GET", "/debug_token", { consulta: { input_token: this.token }, reintentos: 1 });
    }
    if (!r.data) {
      throw new ErrorInstagram({ tipo: "respuesta_inesperada", mensaje: "debug_token no devolvió «data»." });
    }
    return r.data;
  }

  /** GET /me/permissions: permisos concedidos al usuario (del sistema) del token. */
  async permisos(): Promise<PermisoConcedido[]> {
    const r = await this.peticion<{ data?: PermisoConcedido[] }>("GET", "/me/permissions", { reintentos: 1 });
    return r.data ?? [];
  }

  // ── Publicación ──────────────────────────────────────────────────────────

  async limitePublicacion(igUserId?: string): Promise<LimitePublicacion> {
    const id = this.idCuenta(igUserId);
    const r = await this.peticion<{
      data?: Array<{ quota_usage?: number; config?: { quota_total?: number; quota_duration?: number } }>;
    }>("GET", `/${encodeURIComponent(id)}/content_publishing_limit`, {
      consulta: { fields: "config,quota_usage" },
    });
    const fila = r.data?.[0];
    if (!fila || typeof fila.quota_usage !== "number") {
      throw new ErrorInstagram({
        tipo: "respuesta_inesperada",
        mensaje: "content_publishing_limit no devolvió quota_usage.",
      });
    }
    const total = typeof fila.config?.quota_total === "number" ? fila.config.quota_total : null;
    const duracion = typeof fila.config?.quota_duration === "number" ? fila.config.quota_duration : null;
    return {
      usadas: fila.quota_usage,
      total,
      duracionSegundos: duracion,
      restantes: total === null ? null : Math.max(0, total - fila.quota_usage),
    };
  }

  /** POST /{ig-user-id}/media → id del contenedor. */
  async crearContenedor(d: DatosContenedor): Promise<string> {
    const id = this.idCuenta(d.igUserId);
    const cuerpo: Record<string, string> = { image_url: d.imageUrl };
    if (d.tipo === "story") {
      cuerpo.media_type = "STORIES";
    } else {
      if (d.caption) cuerpo.caption = d.caption;
      if (d.altText) cuerpo.alt_text = d.altText;
    }
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(id)}/media`, { cuerpo });
    if (!r.id) throw new ErrorInstagram({ tipo: "respuesta_inesperada", mensaje: "Meta no devolvió el id del contenedor." });
    return String(r.id);
  }

  async estadoContenedor(contenedorId: string): Promise<InfoContenedor> {
    const r = await this.peticion<{ id?: string; status_code?: string; status?: string }>(
      "GET",
      `/${encodeURIComponent(contenedorId)}`,
      { consulta: { fields: "status_code,status" } },
    );
    return {
      id: String(r.id ?? contenedorId),
      estado: r.status_code ?? "DESCONOCIDO",
      detalle: r.status ? sanear(r.status) : null,
    };
  }

  /**
   * Sondea el contenedor hasta FINISHED. Lanza ErrorInstagram si llega a
   * ERROR / EXPIRED / PUBLISHED o si se agota el tiempo.
   */
  async esperarFinished(contenedorId: string, o: OpcionesSondeo = {}): Promise<InfoContenedor> {
    const intervalo = o.intervaloMs ?? SONDEO_POR_DEFECTO.intervaloMs;
    const maximo = o.maxMs ?? SONDEO_POR_DEFECTO.maxMs;
    const inicio = this.ahora();
    for (;;) {
      const info = await this.estadoContenedor(contenedorId);
      const transcurrido = this.ahora() - inicio;
      o.alConsultar?.(info, transcurrido);
      switch (info.estado) {
        case "FINISHED":
          return info;
        case "ERROR": {
          const tipo = tipoDesdeTextoEstado(info.detalle ?? undefined);
          throw new ErrorInstagram({
            tipo: "contenedor_error",
            mensaje: `${textoDeTipo("contenedor_error").mensaje}${info.detalle ? ` — Meta dice: «${info.detalle}»` : ""}`,
            ...(tipo ? { comoArreglarlo: textoDeTipo(tipo).comoArreglarlo } : {}),
          });
        }
        case "EXPIRED":
          throw new ErrorInstagram({ tipo: "contenedor_caducado" });
        case "PUBLISHED":
          throw new ErrorInstagram({ tipo: "contenedor_ya_publicado" });
        default:
          break;
      }
      if (transcurrido + intervalo > maximo) {
        throw new ErrorInstagram({
          tipo: "contenedor_tiempo_agotado",
          mensaje: `${textoDeTipo("contenedor_tiempo_agotado").mensaje} (${Math.round(maximo / 1000)} s; último estado: ${info.estado})`,
        });
      }
      await this.dormir(intervalo);
    }
  }

  /** POST /{ig-user-id}/media_publish con creation_id → id del medio publicado. */
  async publicar(creationId: string, igUserId?: string): Promise<string> {
    const id = this.idCuenta(igUserId);
    const r = await this.peticion<{ id?: string }>("POST", `/${encodeURIComponent(id)}/media_publish`, {
      cuerpo: { creation_id: creationId },
    });
    if (!r.id) throw new ErrorInstagram({ tipo: "respuesta_inesperada", mensaje: "Meta no devolvió el id del medio publicado." });
    return String(r.id);
  }

  /** GET /{media-id}?fields=permalink. */
  async permalink(mediaId: string): Promise<string | null> {
    const r = await this.peticion<{ permalink?: string }>("GET", `/${encodeURIComponent(mediaId)}`, {
      consulta: { fields: "permalink" },
    });
    return r.permalink ?? null;
  }
}
