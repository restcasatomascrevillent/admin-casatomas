/**
 * Secretos de Meta en Supabase (Edge Functions → Secrets), los mismos que el
 * resto del panel: NUNCA en Vercel ni con prefijo VITE_ (no deben llegar al
 * navegador). Se leen en cada petición y los secretos se registran para
 * taparlos en cualquier salida. Los mensajes nombran el secreto, nunca su
 * valor.
 *
 *   IG_ACCESS_TOKEN   token del usuario del sistema (Sensitive)
 *   IG_USER_ID        ID numérico de la cuenta profesional de Instagram
 *   META_APP_ID       ID de la app de Meta
 *   META_API_VERSION  vNN.N (por defecto v26.0)
 *   META_APP_SECRET   opcional (Sensitive): debug_token con token de app
 *
 * Cuenta POR MARCA (opcional, 05/11/2026): cada marca publica en su cuenta si
 * existen sus secretos; si no, cae en los generales de arriba. Hoy no hay
 * ninguno y las dos marcas publican en la cuenta de IG_USER_ID (@oficiososia,
 * cuenta de pruebas): no hace falta tocar nada para que siga igual.
 *   IG_USER_ID_CASA_TOMAS / IG_ACCESS_TOKEN_CASA_TOMAS
 *   IG_USER_ID_TOUZA      / IG_ACCESS_TOKEN_TOUZA
 * El token propio solo hace falta si la cuenta de esa marca no la ve el token
 * general (otro usuario del sistema u otro portfolio).
 */
import { enmascarar, registrarSecreto } from "./secretos.ts";

export const VERSION_API_POR_DEFECTO = "v26.0";

export type Entorno = Readonly<Record<string, string | undefined>>;

export interface ConfigMeta {
  token: string;
  igUserId: string;
  appId: string;
  versionApi: string;
  appSecret: string | undefined;
}

/** Marcas que pueden tener cuenta propia (las de instagram_piezas.marca). */
export const MARCAS_CUENTA = ["casa-tomas", "touza"] as const;
export type MarcaCuenta = (typeof MARCAS_CUENTA)[number];

export function esMarcaCuenta(v: unknown): v is MarcaCuenta {
  return typeof v === "string" && (MARCAS_CUENTA as readonly string[]).includes(v);
}

const SUFIJO_MARCA: Record<MarcaCuenta, string> = { "casa-tomas": "CASA_TOMAS", touza: "TOUZA" };

/** Nombres de los secretos opcionales de una marca. */
export function secretosDeMarca(marca: MarcaCuenta): { igUserId: string; token: string } {
  const s = SUFIJO_MARCA[marca];
  return { igUserId: `IG_USER_ID_${s}`, token: `IG_ACCESS_TOKEN_${s}` };
}

/** De dónde sale la cuenta de una marca: sus secretos o los generales. */
export interface OrigenCuenta {
  marca: MarcaCuenta;
  /** Secreto del que sale el ID (IG_USER_ID_TOUZA o IG_USER_ID). */
  variableIgUserId: string;
  /** Secreto del que sale el token (IG_ACCESS_TOKEN_TOUZA o IG_ACCESS_TOKEN). */
  variableToken: string;
  /** true si usa al menos un secreto propio de la marca. */
  propia: boolean;
}

export interface ConfigMetaMarca extends ConfigMeta {
  origen: OrigenCuenta;
}

export interface ProblemaVariable {
  variable: string;
  problema: string;
  comoArreglarlo: string;
}

/** Ref del proyecto de Supabase (de SUPABASE_URL), para que el «cómo arreglarlo» lleve el bueno. */
export function refProyecto(env: Entorno): string | null {
  return /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.SUPABASE_URL ?? "")?.[1] ?? null;
}

/** Dónde se crea un secreto: CLI o Dashboard del proyecto de Supabase de esta función. */
export function dondeSecreto(nombre: string, env: Entorno = {}, ejemplo = "…"): string {
  const ref = refProyecto(env) ?? "<ref del proyecto: demo sfonaclosuafvlhutkon, producción haqmmdfdzzatdnrrcgez>";
  return `los secretos de Supabase: \`npx supabase secrets set ${nombre}=${ejemplo} --project-ref ${ref}\` (desde la raíz del repo) o Dashboard → Edge Functions → Secrets. Se aplica sin volver a desplegar`;
}

export function arregloVariable(nombre: string, env: Entorno = {}): string {
  switch (nombre) {
    case "IG_ACCESS_TOKEN":
      return `Crea IG_ACCESS_TOKEN en ${dondeSecreto(nombre, env)}. Es el token del usuario del sistema de Meta (docs/instagram.md, «Secretos»).`;
    case "IG_USER_ID":
      return `Crea IG_USER_ID en ${dondeSecreto(nombre, env)}. Es el ID numérico de la cuenta de Instagram (no el @usuario): «Comprobar conexión» lista los que ve el token.`;
    case "META_APP_ID":
      return `Crea META_APP_ID en ${dondeSecreto(nombre, env)}. Está en developers.facebook.com → Mis apps → (app) → Configuración de la app → Básica.`;
    case "META_API_VERSION":
      return `Opcional. Si la pones, con formato vNN.N (por ejemplo ${VERSION_API_POR_DEFECTO}) en ${dondeSecreto(nombre, env, VERSION_API_POR_DEFECTO)}.`;
    case "META_APP_SECRET":
      return `Opcional. Con ella la comprobación del token usa el método documentado (debug_token con token de app). Créala en ${dondeSecreto(nombre, env)}.`;
    default:
      return `Crea ${nombre} en ${dondeSecreto(nombre, env)}.`;
  }
}

/** Variables que describe el estado, en orden. */
export const VARIABLES_META = [
  { nombre: "IG_ACCESS_TOKEN", obligatoria: true, secreta: true },
  { nombre: "IG_USER_ID", obligatoria: true, secreta: false },
  { nombre: "META_APP_ID", obligatoria: true, secreta: false },
  { nombre: "META_API_VERSION", obligatoria: false, secreta: false },
  { nombre: "META_APP_SECRET", obligatoria: false, secreta: true },
  // Opcionales por marca: sin ellas, la marca usa IG_USER_ID / IG_ACCESS_TOKEN.
  { nombre: "IG_USER_ID_CASA_TOMAS", obligatoria: false, secreta: false },
  { nombre: "IG_ACCESS_TOKEN_CASA_TOMAS", obligatoria: false, secreta: true },
  { nombre: "IG_USER_ID_TOUZA", obligatoria: false, secreta: false },
  { nombre: "IG_ACCESS_TOKEN_TOUZA", obligatoria: false, secreta: true },
] as const;

/** Variable general en la que cae una de marca si no existe. */
function generalDe(nombre: string): "IG_USER_ID" | "IG_ACCESS_TOKEN" | null {
  if (nombre.startsWith("IG_USER_ID_")) return "IG_USER_ID";
  if (nombre.startsWith("IG_ACCESS_TOKEN_")) return "IG_ACCESS_TOKEN";
  return null;
}

function valor(env: Entorno, nombre: string): string | undefined {
  const v = env[nombre];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/** Problemas de las variables (faltan o tienen mal formato). */
export function problemasVariables(env: Entorno): ProblemaVariable[] {
  const p: ProblemaVariable[] = [];
  const token = valor(env, "IG_ACCESS_TOKEN");
  const ig = valor(env, "IG_USER_ID");
  const app = valor(env, "META_APP_ID");
  const version = valor(env, "META_API_VERSION");
  if (!token) p.push({ variable: "IG_ACCESS_TOKEN", problema: "falta", comoArreglarlo: arregloVariable("IG_ACCESS_TOKEN", env) });
  else if (token.length < 20 || /\s/.test(token))
    p.push({ variable: "IG_ACCESS_TOKEN", problema: "parece incompleto o tiene espacios/saltos de línea", comoArreglarlo: `Cópialo de nuevo, sin espacios, en ${dondeSecreto("IG_ACCESS_TOKEN", env)}.` });
  if (!ig) p.push({ variable: "IG_USER_ID", problema: "falta", comoArreglarlo: arregloVariable("IG_USER_ID", env) });
  else if (!/^\d+$/.test(ig)) p.push({ variable: "IG_USER_ID", problema: "debe ser solo dígitos (el ID, no el @usuario)", comoArreglarlo: arregloVariable("IG_USER_ID", env) });
  if (!app) p.push({ variable: "META_APP_ID", problema: "falta", comoArreglarlo: arregloVariable("META_APP_ID", env) });
  else if (!/^\d+$/.test(app)) p.push({ variable: "META_APP_ID", problema: "debe ser solo dígitos", comoArreglarlo: arregloVariable("META_APP_ID", env) });
  if (version && !/^v\d+\.\d+$/.test(version))
    p.push({ variable: "META_API_VERSION", problema: "formato inválido (usa vNN.N)", comoArreglarlo: arregloVariable("META_API_VERSION", env) });
  // Las de marca son opcionales: solo se comprueba su formato si existen.
  for (const marca of MARCAS_CUENTA) {
    const n = secretosDeMarca(marca);
    const igMarca = valor(env, n.igUserId);
    const tokenMarca = valor(env, n.token);
    if (igMarca && !/^\d+$/.test(igMarca)) {
      p.push({ variable: n.igUserId, problema: "debe ser solo dígitos (el ID, no el @usuario)", comoArreglarlo: `Corrígelo (o bórralo: sin él, ${marca} usa IG_USER_ID) en ${dondeSecreto(n.igUserId, env)}.` });
    }
    if (tokenMarca && (tokenMarca.length < 20 || /\s/.test(tokenMarca))) {
      p.push({ variable: n.token, problema: "parece incompleto o tiene espacios/saltos de línea", comoArreglarlo: `Cópialo de nuevo, sin espacios (o bórralo: sin él, ${marca} usa IG_ACCESS_TOKEN), en ${dondeSecreto(n.token, env)}.` });
    }
  }
  return p;
}

/** Problemas que impiden publicar con la cuenta de una marca (los generales que le afectan + los suyos). */
export function problemasDeMarca(env: Entorno, marca: MarcaCuenta): ProblemaVariable[] {
  const n = secretosDeMarca(marca);
  const otras = new Set(MARCAS_CUENTA.filter((m) => m !== marca).flatMap((m) => Object.values(secretosDeMarca(m))));
  const tieneId = Boolean(valor(env, n.igUserId));
  const tieneToken = Boolean(valor(env, n.token));
  return problemasVariables(env).filter((x) => {
    if (otras.has(x.variable)) return false;
    // Si la marca tiene su ID (o su token), el general no le hace falta.
    if (x.variable === "IG_USER_ID" && tieneId) return false;
    if (x.variable === "IG_ACCESS_TOKEN" && tieneToken) return false;
    return true;
  });
}

/** De qué secretos sale la cuenta de una marca (sin leer valores secretos). */
export function origenCuenta(env: Entorno, marca: MarcaCuenta): OrigenCuenta {
  const n = secretosDeMarca(marca);
  const idPropio = Boolean(valor(env, n.igUserId));
  const tokenPropio = Boolean(valor(env, n.token));
  return {
    marca,
    variableIgUserId: idPropio ? n.igUserId : "IG_USER_ID",
    variableToken: tokenPropio ? n.token : "IG_ACCESS_TOKEN",
    propia: idPropio || tokenPropio,
  };
}

/**
 * Configuración para publicar con la cuenta de una marca: sus secretos si
 * existen y, si no, los generales (IG_USER_ID / IG_ACCESS_TOKEN). App, versión
 * y secreto de la app son siempre los generales.
 */
export function leerConfigMetaMarca(env: Entorno, marca: MarcaCuenta): { ok: true; config: ConfigMetaMarca } | { ok: false; problemas: ProblemaVariable[] } {
  const origen = origenCuenta(env, marca);
  registrarSecreto(valor(env, "IG_ACCESS_TOKEN"));
  registrarSecreto(valor(env, secretosDeMarca(marca).token));
  registrarSecreto(valor(env, "META_APP_SECRET"));
  const problemas = problemasDeMarca(env, marca);
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    config: {
      token: valor(env, origen.variableToken) as string,
      igUserId: valor(env, origen.variableIgUserId) as string,
      appId: valor(env, "META_APP_ID") as string,
      versionApi: valor(env, "META_API_VERSION") ?? VERSION_API_POR_DEFECTO,
      appSecret: valor(env, "META_APP_SECRET"),
      origen,
    },
  };
}

/**
 * Cuentas distintas que hay que leer (métricas): una por par ID + token, con
 * las marcas que la usan. Hoy, una sola (las dos marcas en IG_USER_ID).
 */
export function cuentasDistintas(env: Entorno): Array<{ config: ConfigMetaMarca; marcas: MarcaCuenta[] }> {
  const salida: Array<{ config: ConfigMetaMarca; marcas: MarcaCuenta[] }> = [];
  for (const marca of MARCAS_CUENTA) {
    const r = leerConfigMetaMarca(env, marca);
    if (!r.ok) continue;
    const igual = salida.find((x) => x.config.igUserId === r.config.igUserId && x.config.token === r.config.token);
    if (igual) igual.marcas.push(marca);
    else salida.push({ config: r.config, marcas: [marca] });
  }
  return salida;
}

/** Configuración lista para publicar, o los problemas que lo impiden. */
export function leerConfigMeta(env: Entorno): { ok: true; config: ConfigMeta } | { ok: false; problemas: ProblemaVariable[] } {
  const token = valor(env, "IG_ACCESS_TOKEN");
  const appSecret = valor(env, "META_APP_SECRET");
  registrarSecreto(token);
  registrarSecreto(appSecret);
  const problemas = problemasVariables(env);
  if (problemas.length) return { ok: false, problemas };
  return {
    ok: true,
    config: {
      token: token as string,
      igUserId: valor(env, "IG_USER_ID") as string,
      appId: valor(env, "META_APP_ID") as string,
      versionApi: valor(env, "META_API_VERSION") ?? VERSION_API_POR_DEFECTO,
      appSecret,
    },
  };
}

export interface DescripcionVariable {
  nombre: string;
  presente: boolean;
  obligatoria: boolean;
  /** Texto seguro: «…abcd (N caracteres)» para las secretas, el valor para las demás. */
  detalle: string;
}

/** Describe las variables SIN revelar secretos. */
export function describirVariables(env: Entorno): DescripcionVariable[] {
  return VARIABLES_META.map(({ nombre, obligatoria, secreta }) => {
    const v = valor(env, nombre);
    let detalle: string;
    const general = generalDe(nombre);
    if (!v) detalle = nombre === "META_API_VERSION" ? `no definida (se usa ${VERSION_API_POR_DEFECTO})` : general ? `no definida (se usa ${general})` : "no definida";
    else if (secreta) {
      registrarSecreto(v);
      detalle = nombre.startsWith("IG_ACCESS_TOKEN") ? `${enmascarar(v)} (${v.length} caracteres)` : `definida (${v.length} caracteres)`;
    } else detalle = v;
    return { nombre, presente: Boolean(v), obligatoria, detalle };
  });
}

/** Nombres que leen las funciones de Instagram (secretos de Meta y de Google + los de Supabase que inyecta la plataforma). */
export const NOMBRES_ENTORNO = [
  ...VARIABLES_META.map((v) => v.nombre),
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  // Solo para escribir el estado de publicación (columnas que el panel ya no
  // puede tocar, migración 20261107000000) y el cerrojo de publicación. La
  // inyecta la plataforma en todas las Edge Functions.
  "SUPABASE_SERVICE_ROLE_KEY",
  // Google Drive (archivo de fotos y piezas publicadas; ver drive.ts).
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_MARKETING_FOLDER_ID",
] as const;

/** Entorno de la Edge Function: solo los nombres que hacen falta (nunca Deno.env entero). */
export function entornoDeno(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO) salida[n] = deno?.env.get(n);
  return salida;
}
