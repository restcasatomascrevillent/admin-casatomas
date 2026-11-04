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
] as const;

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
  return p;
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
    if (!v) detalle = nombre === "META_API_VERSION" ? `no definida (se usa ${VERSION_API_POR_DEFECTO})` : "no definida";
    else if (secreta) {
      registrarSecreto(v);
      detalle = nombre === "IG_ACCESS_TOKEN" ? `${enmascarar(v)} (${v.length} caracteres)` : `definida (${v.length} caracteres)`;
    } else detalle = v;
    return { nombre, presente: Boolean(v), obligatoria, detalle };
  });
}

/** Nombres que leen las funciones de Instagram (secretos de Meta + los de Supabase que inyecta la plataforma). */
export const NOMBRES_ENTORNO = [...VARIABLES_META.map((v) => v.nombre), "SUPABASE_URL", "SUPABASE_ANON_KEY"] as const;

/** Entorno de la Edge Function: solo los nombres que hacen falta (nunca Deno.env entero). */
export function entornoDeno(): Record<string, string | undefined> {
  const deno = (globalThis as unknown as { Deno?: { env: { get(n: string): string | undefined } } }).Deno;
  const salida: Record<string, string | undefined> = {};
  for (const n of NOMBRES_ENTORNO) salida[n] = deno?.env.get(n);
  return salida;
}
