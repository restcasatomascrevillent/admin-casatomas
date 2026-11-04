/**
 * «Comprobar conexión» del panel: el equivalente de `npm run meta:check` de
 * instagram-studio (src/instagram/comprobacion.ts) para la Edge Function
 * instagram-estado. Comprueba variables, identidad, token y cuota
 * SIN publicar nada y SIN devolver secretos (como mucho «…abcd» del token).
 *
 * Verificación del token, de más a menos completa:
 *   1. META_APP_SECRET presente → debug_token con token de app (documentado).
 *   2. debug_token autenticando con el propio token (no documentado).
 *   3. GET /me/permissions.
 *   4. Inferencia: si responden perfil y content_publishing_limit, el token
 *      es válido y tiene, como mínimo, los permisos que esas llamadas piden.
 */
import { ClienteGraph, type CuentaIg, type DatosDepuracion, type FuncionFetch, type LimitePublicacion, type PaginaConCuenta, type PerfilIg } from "./cliente.ts";
import { arregloVariable, describirVariables, dondeSecreto, problemasVariables, VERSION_API_POR_DEFECTO, type Entorno } from "./entorno.ts";
import { ErrorInstagram } from "./errores.ts";
import { mensajeSaneado, registrarSecreto, sanear, sanearProfundo } from "./secretos.ts";

export type EstadoComprobacion = "ok" | "falla" | "aviso";

export interface Comprobacion {
  seccion: "Variables" | "Identidad" | "Token" | "Cuota";
  nombre: string;
  estado: EstadoComprobacion;
  detalle: string;
  comoArreglarlo?: string;
}

export type MetodoVerificacion = "debug_token_app" | "debug_token_propio" | "me_permissions" | "inferencia";

export interface CuotaPublicacion {
  usadas: number;
  total: number | null;
  restantes: number | null;
  ventanaHoras: number | null;
}

export interface ResultadoEstado {
  ok: boolean;
  /** Variables (nunca valores secretos). */
  variables: Array<{ nombre: string; presente: boolean; obligatoria: boolean; detalle: string; estado: EstadoComprobacion; comoArreglarlo?: string }>;
  /** Variables obligatorias que faltan o están mal. */
  faltan: string[];
  identidad: {
    igUserId: string | null;
    username: string | null;
    nombre: string | null;
    publicaciones: number | null;
    /** ¿IG_USER_ID está entre las cuentas que ve el token? null = no se pudo saber. */
    coincide: boolean | null;
    cuentasVistas: CuentaIg[];
  } | null;
  cuota: CuotaPublicacion | null;
  metodoVerificacion: MetodoVerificacion | null;
  versionApi: string;
  tokenEnmascarado: string | null;
  comprobaciones: Comprobacion[];
  noVerificado: string[];
}

export interface DependenciasEstado {
  fetch?: FuncionFetch;
  dormir?: (ms: number) => Promise<void>;
  ahoraSegundos?: number;
}

export const PERMISOS_NECESARIOS = ["instagram_basic", "instagram_content_publish"] as const;

export function cuotaDe(l: LimitePublicacion): CuotaPublicacion {
  return {
    usadas: l.usadas,
    total: l.total,
    restantes: l.restantes,
    ventanaHoras: l.duracionSegundos === null ? null : Math.round(l.duracionSegundos / 3600),
  };
}

function textoError(e: unknown): { detalle: string; arreglo?: string } {
  if (e instanceof ErrorInstagram) return { detalle: e.message, arreglo: e.comoArreglarlo };
  return { detalle: mensajeSaneado(e) };
}

function describirCuenta(c: CuentaIg): string {
  return `${c.id}${c.username ? ` (@${c.username})` : ""}`;
}

function fecha(segundos: number): string {
  return new Date(segundos * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export async function comprobarEstado(env: Entorno, deps: DependenciasEstado = {}): Promise<ResultadoEstado> {
  const c: Comprobacion[] = [];
  const noVerificado: string[] = [];
  const agregar = (x: Comprobacion) => c.push({ ...x, detalle: sanear(x.detalle), ...(x.comoArreglarlo ? { comoArreglarlo: sanear(x.comoArreglarlo) } : {}) });

  const token = env.IG_ACCESS_TOKEN?.trim() || undefined;
  const igUserId = env.IG_USER_ID?.trim() || undefined;
  const appId = env.META_APP_ID?.trim() || undefined;
  const appSecret = env.META_APP_SECRET?.trim() || undefined;
  const versionApi = env.META_API_VERSION?.trim() || VERSION_API_POR_DEFECTO;
  registrarSecreto(token);
  registrarSecreto(appSecret);

  // ── 1. Variables ─────────────────────────────────────────────────────────
  const problemas = problemasVariables(env);
  const variables = describirVariables(env).map((v) => {
    const p = problemas.find((x) => x.variable === v.nombre);
    const estado: EstadoComprobacion = p ? "falla" : !v.presente && v.nombre === "META_APP_SECRET" ? "aviso" : "ok";
    const comoArreglarlo = p?.comoArreglarlo ?? (estado === "aviso" ? arregloVariable("META_APP_SECRET", env) : undefined);
    const detalle = p ? `${v.detalle} — ${p.problema}` : v.detalle;
    agregar({ seccion: "Variables", nombre: v.nombre, estado, detalle, comoArreglarlo });
    return { ...v, detalle, estado, ...(comoArreglarlo ? { comoArreglarlo } : {}) };
  });
  const faltan = problemas.map((p) => p.variable);

  const base = (): ResultadoEstado => ({
    ok: false,
    variables,
    faltan,
    identidad: null,
    cuota: null,
    metodoVerificacion: null,
    versionApi,
    tokenEnmascarado: token ? (token.length >= 12 ? `…${token.slice(-4)}` : "…(oculto)") : null,
    comprobaciones: c,
    noVerificado,
  });

  if (!token || faltan.includes("IG_ACCESS_TOKEN") || faltan.includes("META_API_VERSION")) {
    agregar({ seccion: "Identidad", nombre: "Llamadas a Meta", estado: "falla", detalle: "no se hacen: falta un token utilizable o la versión de la API no es válida" });
    noVerificado.push("identidad, token y cuota (no se llamó a Meta)");
    return sanearProfundo(base());
  }

  const igValido = igUserId && /^\d+$/.test(igUserId) ? igUserId : undefined;
  const cliente = new ClienteGraph({
    token,
    versionApi,
    igUserId: igValido,
    appId,
    appSecret,
    fetch: deps.fetch,
    dormir: deps.dormir,
    reintentos: 1,
    timeoutMs: 12_000,
  });

  // ── 2. Identidad ─────────────────────────────────────────────────────────
  let asignadas: CuentaIg[] | null = null;
  let paginas: PaginaConCuenta[] | null = null;
  try {
    asignadas = await cliente.cuentasAsignadas();
    agregar({
      seccion: "Identidad",
      nombre: "Cuentas asignadas (/me/assigned_instagram_accounts)",
      estado: asignadas.length ? "ok" : "aviso",
      detalle: asignadas.length ? asignadas.map(describirCuenta).join(", ") : "ninguna",
      comoArreglarlo: asignadas.length ? undefined : "Asigna la cuenta de Instagram como activo al usuario del sistema (Configuración del negocio → Usuarios del sistema → Asignar activos).",
    });
  } catch (e) {
    agregar({ seccion: "Identidad", nombre: "Cuentas asignadas (/me/assigned_instagram_accounts)", estado: "aviso", detalle: `no disponible: ${textoError(e).detalle}`, comoArreglarlo: "Se prueba la ruta de páginas." });
  }
  if (!asignadas?.some((x) => x.id === igValido)) {
    try {
      paginas = await cliente.cuentaDesdePaginas();
      agregar({
        seccion: "Identidad",
        nombre: "Páginas (/me/accounts → instagram_business_account)",
        estado: paginas.some((p) => p.cuenta) ? "ok" : "aviso",
        detalle: paginas.length ? paginas.map((p) => `${p.paginaNombre ?? p.paginaId} → ${p.cuenta ? describirCuenta(p.cuenta) : "sin cuenta de IG"}`).join("; ") : "ninguna página",
      });
    } catch (e) {
      agregar({ seccion: "Identidad", nombre: "Páginas (/me/accounts → instagram_business_account)", estado: "aviso", detalle: `no disponible: ${textoError(e).detalle}`, comoArreglarlo: "Normal si el token no tiene pages_show_list; no es imprescindible." });
    }
  }
  const cuentasVistas: CuentaIg[] = [...(asignadas ?? []), ...(paginas ?? []).flatMap((p) => (p.cuenta ? [p.cuenta] : []))];
  const encontrada = cuentasVistas.find((x) => x.id === igValido) ?? null;

  let perfil: PerfilIg | null = null;
  let errorPerfil: unknown = null;
  if (igValido) {
    try {
      perfil = await cliente.perfil(igValido);
    } catch (e) {
      errorPerfil = e;
    }
  }
  if (!igValido) {
    agregar({
      seccion: "Identidad",
      nombre: "IG_USER_ID",
      estado: "falla",
      detalle: cuentasVistas.length ? `el token ve: ${cuentasVistas.map(describirCuenta).join(", ")}` : "el token no ve ninguna cuenta",
      comoArreglarlo: cuentasVistas.length ? `Copia el ID numérico de la cuenta correcta en IG_USER_ID: ${dondeSecreto("IG_USER_ID", env)}.` : "Asigna la cuenta de Instagram al usuario del sistema y regenera el token.",
    });
  } else if (encontrada) {
    agregar({ seccion: "Identidad", nombre: "IG_USER_ID entre las cuentas del token", estado: "ok", detalle: `encontrada: ${describirCuenta(encontrada)}` });
  } else if (perfil) {
    agregar({
      seccion: "Identidad",
      nombre: "IG_USER_ID entre las cuentas del token",
      estado: "aviso",
      detalle: `no aparece en los listados${cuentasVistas.length ? ` (ve: ${cuentasVistas.map(describirCuenta).join(", ")})` : ""}, pero su perfil sí responde`,
      comoArreglarlo: "Si publicar falla por permisos, revisa la asignación de la cuenta al usuario del sistema.",
    });
  } else {
    agregar({
      seccion: "Identidad",
      nombre: "IG_USER_ID entre las cuentas del token",
      estado: "falla",
      detalle: cuentasVistas.length ? `${igValido} no coincide; el token ve: ${cuentasVistas.map(describirCuenta).join(", ")}` : `${igValido} no aparece y el token no ve ninguna cuenta`,
      comoArreglarlo: cuentasVistas.length ? `Pon en IG_USER_ID uno de los IDs que ve el token: ${dondeSecreto("IG_USER_ID", env)}.` : "Asigna la cuenta de Instagram como activo al usuario del sistema (control total) y regenera el token.",
    });
  }
  if (perfil) {
    agregar({
      seccion: "Identidad",
      nombre: "Perfil de IG_USER_ID",
      estado: "ok",
      detalle: [`@${perfil.username ?? "?"}`, perfil.name, perfil.mediaCount !== null ? `${perfil.mediaCount} publicaciones` : null].filter(Boolean).join(" · "),
    });
  } else if (errorPerfil) {
    const { detalle, arreglo } = textoError(errorPerfil);
    agregar({ seccion: "Identidad", nombre: "Perfil de IG_USER_ID", estado: "falla", detalle, comoArreglarlo: arreglo });
  }

  // ── Cuota (antes del token: la inferencia la usa) ───────────────────────
  let cuota: LimitePublicacion | null = null;
  let errorCuota: unknown = null;
  if (igValido) {
    try {
      cuota = await cliente.limitePublicacion(igValido);
    } catch (e) {
      errorCuota = e;
    }
  }

  // ── 3. Token ─────────────────────────────────────────────────────────────
  const fallos: string[] = [];
  let metodo: MetodoVerificacion | null = null;
  let datos: DatosDepuracion | null = null;
  let concedidos: string[] | null = null;
  if (appSecret && appId) {
    try {
      datos = await cliente.depurarToken("token_app");
      metodo = "debug_token_app";
    } catch (e) {
      fallos.push(`debug_token con token de app: ${textoError(e).detalle}`);
    }
  } else fallos.push("debug_token con token de app: no hay META_APP_SECRET");
  if (!metodo) {
    try {
      datos = await cliente.depurarToken("token_propio");
      metodo = "debug_token_propio";
    } catch (e) {
      fallos.push(`debug_token con el propio token: ${textoError(e).detalle}`);
    }
  }
  if (!metodo) {
    try {
      concedidos = (await cliente.permisos()).filter((p) => p.status === "granted").map((p) => p.permission);
      metodo = "me_permissions";
    } catch (e) {
      fallos.push(`/me/permissions: ${textoError(e).detalle}`);
    }
  }
  if (!metodo) metodo = "inferencia";
  const nombreMetodo: Record<MetodoVerificacion, string> = {
    debug_token_app: "debug_token con token de app (método documentado)",
    debug_token_propio: "debug_token autenticado con el propio token (no documentado)",
    me_permissions: "/me/permissions (sin debug_token)",
    inferencia: "inferencia por llamadas que funcionan (sin debug_token ni /me/permissions)",
  };
  agregar({
    seccion: "Token",
    nombre: "Método de verificación",
    estado: metodo === "debug_token_app" ? "ok" : "aviso",
    detalle: nombreMetodo[metodo] + (fallos.length && metodo !== "debug_token_app" ? `. Intentos fallidos: ${fallos.join(" | ")}` : ""),
    comoArreglarlo: metodo === "debug_token_app" ? undefined : `Para una verificación completa, añade META_APP_SECRET: ${dondeSecreto("META_APP_SECRET", env)}.`,
  });

  const evaluarPermisos = (lista: string[]) => {
    const faltanPermisos = PERMISOS_NECESARIOS.filter((p) => !lista.includes(p));
    agregar({
      seccion: "Token",
      nombre: "Permisos necesarios",
      estado: faltanPermisos.length ? "falla" : "ok",
      detalle: faltanPermisos.length ? `faltan: ${faltanPermisos.join(", ")} (tiene: ${lista.join(", ") || "ninguno"})` : PERMISOS_NECESARIOS.join(" + "),
      comoArreglarlo: faltanPermisos.length ? "Regenera el token del usuario del sistema marcando instagram_basic e instagram_content_publish." : undefined,
    });
  };

  if (datos) {
    const ahora = deps.ahoraSegundos ?? Math.floor(Date.now() / 1000);
    agregar({
      seccion: "Token",
      nombre: "Token válido (is_valid)",
      estado: datos.is_valid ? "ok" : "falla",
      detalle: datos.is_valid ? "sí" : `no${datos.error?.message ? `: ${datos.error.message}` : ""}`,
      comoArreglarlo: datos.is_valid ? undefined : "Regenera el token (docs/instagram.md). Si la app se quitó del portfolio o se reasignó la cuenta, vuelve a asignarlas antes.",
    });
    if (typeof datos.expires_at === "number") {
      if (datos.expires_at === 0) agregar({ seccion: "Token", nombre: "Caducidad", estado: "ok", detalle: "no caduca" });
      else if (datos.expires_at <= ahora) agregar({ seccion: "Token", nombre: "Caducidad", estado: "falla", detalle: `caducó el ${fecha(datos.expires_at)}`, comoArreglarlo: "Genera un token nuevo con caducidad «Nunca»." });
      else agregar({ seccion: "Token", nombre: "Caducidad", estado: "aviso", detalle: `caduca el ${fecha(datos.expires_at)}`, comoArreglarlo: "Un token de usuario del sistema debería ser «Nunca caduca». Regenéralo con esa opción." });
    } else noVerificado.push("caducidad del token (debug_token no la indicó)");
    if (datos.app_id) {
      const coincide = datos.app_id === appId;
      agregar({
        seccion: "Token",
        nombre: "app_id == META_APP_ID",
        estado: coincide ? "ok" : "falla",
        detalle: coincide ? datos.app_id : `el token es de la app ${datos.app_id}, META_APP_ID es ${appId ?? "(vacío)"}`,
        comoArreglarlo: coincide ? undefined : "Corrige META_APP_ID o genera el token eligiendo la app correcta.",
      });
    }
    if (datos.type) {
      agregar({
        seccion: "Token",
        nombre: "Tipo de token",
        estado: datos.type === "SYSTEM_USER" ? "ok" : "aviso",
        detalle: datos.type,
        comoArreglarlo: datos.type === "SYSTEM_USER" ? undefined : "Se esperaba un token de usuario del sistema (SYSTEM_USER), que no caduca.",
      });
    }
    evaluarPermisos(datos.scopes ?? []);
  } else if (concedidos) {
    noVerificado.push("caducidad del token y app_id (solo debug_token los da)");
    evaluarPermisos(concedidos);
  } else {
    noVerificado.push("caducidad, app_id y lista de permisos del token");
    const valido = Boolean(perfil) || Boolean(cuota);
    agregar({
      seccion: "Token",
      nombre: "Token válido (inferido)",
      estado: valido ? "aviso" : "falla",
      detalle: valido ? "las llamadas de perfil/cuota funcionan, así que el token es válido" : "ninguna llamada ha funcionado",
      comoArreglarlo: valido ? undefined : textoError(errorPerfil ?? errorCuota).arreglo,
    });
    agregar({
      seccion: "Token",
      nombre: "Permisos (inferidos)",
      estado: cuota ? "aviso" : "falla",
      detalle: cuota ? "content_publishing_limit responde: se infiere instagram_basic + instagram_content_publish (no verificado)" : perfil ? "el perfil responde; instagram_content_publish sin confirmar" : "sin datos",
      comoArreglarlo: cuota ? undefined : "Regenera el token con instagram_basic e instagram_content_publish.",
    });
  }

  // ── 4. Cuota ─────────────────────────────────────────────────────────────
  if (cuota) {
    const horas = cuota.duracionSegundos !== null ? `${Math.round(cuota.duracionSegundos / 3600)} h` : "ventana desconocida";
    if (cuota.total === null) agregar({ seccion: "Cuota", nombre: "Límite de publicación", estado: "aviso", detalle: `usadas ${cuota.usadas}; Meta no devolvió config.quota_total (${horas})` });
    else {
      const agotada = cuota.usadas >= cuota.total;
      agregar({
        seccion: "Cuota",
        nombre: "Límite de publicación",
        estado: agotada ? "falla" : "ok",
        detalle: `${cuota.usadas}/${cuota.total} en ${horas} (quedan ${cuota.restantes})`,
        comoArreglarlo: agotada ? "Límite alcanzado: espera a que pase la ventana antes de publicar." : undefined,
      });
    }
  } else if (errorCuota) {
    const { detalle, arreglo } = textoError(errorCuota);
    agregar({ seccion: "Cuota", nombre: "Límite de publicación", estado: "falla", detalle, comoArreglarlo: arreglo });
  } else {
    agregar({ seccion: "Cuota", nombre: "Límite de publicación", estado: "falla", detalle: "no consultado (IG_USER_ID no válido)" });
  }

  const r = base();
  r.metodoVerificacion = metodo;
  r.cuota = cuota ? cuotaDe(cuota) : null;
  r.identidad = {
    igUserId: igValido ?? null,
    username: perfil?.username ?? encontrada?.username ?? null,
    nombre: perfil?.name ?? null,
    publicaciones: perfil?.mediaCount ?? null,
    coincide: igValido ? (encontrada ? true : cuentasVistas.length ? false : null) : false,
    cuentasVistas,
  };
  r.ok = !c.some((x) => x.estado === "falla");
  return sanearProfundo(r);
}
