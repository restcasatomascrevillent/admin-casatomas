/**
 * Variables de entorno de Meta en Vercel (NUNCA con prefijo VITE_: no deben
 * llegar al navegador). Se leen en cada petición y los secretos se registran
 * para taparlos en cualquier salida. Los mensajes nombran la variable, nunca
 * su valor.
 *
 *   IG_ACCESS_TOKEN   token del usuario del sistema (Sensitive)
 *   IG_USER_ID        ID numérico de la cuenta profesional de Instagram
 *   META_APP_ID       ID de la app de Meta
 *   META_API_VERSION  vNN.N (por defecto v26.0)
 *   META_APP_SECRET   opcional (Sensitive): debug_token con token de app
 */
import { enmascarar, registrarSecreto } from "./secretos.js";

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

const DONDE = "Vercel → proyecto admin-casatomas → Settings → Environment Variables (Production y Preview) y vuelve a desplegar";

export const ARREGLO_VARIABLE: Record<string, string> = {
  IG_ACCESS_TOKEN: `Crea IG_ACCESS_TOKEN en ${DONDE}. Márcala como Sensitive. Es el token del usuario del sistema de Meta (docs/instagram.md, «Variables»).`,
  IG_USER_ID: `Crea IG_USER_ID en ${DONDE}. Es el ID numérico de la cuenta de Instagram (no el @usuario): «Comprobar conexión» lista los que ve el token.`,
  META_APP_ID: `Crea META_APP_ID en ${DONDE}. Está en developers.facebook.com → Mis apps → (app) → Configuración de la app → Básica.`,
  META_API_VERSION: `Opcional. Si la pones, con formato vNN.N (por ejemplo ${VERSION_API_POR_DEFECTO}) en ${DONDE}.`,
  META_APP_SECRET: `Opcional. Con ella la comprobación del token usa el método documentado (debug_token con token de app). Créala como Sensitive en ${DONDE}.`,
};

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
  if (!token) p.push({ variable: "IG_ACCESS_TOKEN", problema: "falta", comoArreglarlo: ARREGLO_VARIABLE.IG_ACCESS_TOKEN });
  else if (token.length < 20 || /\s/.test(token))
    p.push({ variable: "IG_ACCESS_TOKEN", problema: "parece incompleto o tiene espacios/saltos de línea", comoArreglarlo: "Cópialo de nuevo, sin espacios, en Vercel (IG_ACCESS_TOKEN)." });
  if (!ig) p.push({ variable: "IG_USER_ID", problema: "falta", comoArreglarlo: ARREGLO_VARIABLE.IG_USER_ID });
  else if (!/^\d+$/.test(ig)) p.push({ variable: "IG_USER_ID", problema: "debe ser solo dígitos (el ID, no el @usuario)", comoArreglarlo: ARREGLO_VARIABLE.IG_USER_ID });
  if (!app) p.push({ variable: "META_APP_ID", problema: "falta", comoArreglarlo: ARREGLO_VARIABLE.META_APP_ID });
  else if (!/^\d+$/.test(app)) p.push({ variable: "META_APP_ID", problema: "debe ser solo dígitos", comoArreglarlo: ARREGLO_VARIABLE.META_APP_ID });
  if (version && !/^v\d+\.\d+$/.test(version))
    p.push({ variable: "META_API_VERSION", problema: "formato inválido (usa vNN.N)", comoArreglarlo: ARREGLO_VARIABLE.META_API_VERSION });
  return p;
}

/** Configuración lista para publicar, o los problemas que lo impiden. */
export function leerConfigMeta(env: Entorno = process.env): { ok: true; config: ConfigMeta } | { ok: false; problemas: ProblemaVariable[] } {
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
