/**
 * Saneado de secretos de las funciones de Instagram. NINGÚN texto que salga
 * por consola, en una respuesta JSON o en un error lanzado debe contener el
 * valor de IG_ACCESS_TOKEN, META_APP_SECRET ni el JWT del usuario.
 *
 * Dos capas (portado de instagram-studio/src/config/secretos.ts):
 *  1. Lista de secretos registrados (el token de Meta, el secreto de la app,
 *     «APP_ID|APP_SECRET» y el JWT de la petición): cualquier aparición
 *     literal se sustituye por [OCULTO].
 *  2. Patrones genéricos (access_token=…, input_token=…, Authorization,
 *     Bearer …, apikey, JWT sueltos) para lo que no se haya registrado.
 *
 * `registro` es el ÚNICO camino a console.* de estas funciones.
 */

export const OCULTO = "[OCULTO]";

const secretosRegistrados = new Set<string>();

/** Registra un valor secreto para taparlo en todo lo que se sanee. */
export function registrarSecreto(valor: string | undefined | null): void {
  if (typeof valor !== "string") return;
  const limpio = valor.trim();
  // Valores muy cortos darían falsos positivos; los tapan los patrones.
  if (limpio.length >= 6) secretosRegistrados.add(limpio);
}

/** Solo para pruebas. */
export function olvidarSecretos(): void {
  secretosRegistrados.clear();
}

const PATRONES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(access_token|input_token|client_secret|fb_exchange_token|apikey|api_key)=([^&\s"'#<>]+)/gi, `$1=${OCULTO}`],
  [/("(?:access_token|input_token|client_secret|apikey|authorization)"\s*:\s*")[^"]*(")/gi, `$1${OCULTO}$2`],
  [/\b(authorization\s*[:=]\s*)(bearer\s+)?[^\s"',;}]+/gi, `$1$2${OCULTO}`],
  [/\bBearer\s+(?!\[OCULTO\])[A-Za-z0-9._~+/=|-]+/g, `Bearer ${OCULTO}`],
  [/\b(apikey\s*:\s*)[^\s"',;}]+/gi, `$1${OCULTO}`],
  // JWT sueltos (eyJ… . … . …) y tokens de Meta (EAA…) aunque no se hayan registrado.
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, OCULTO],
  [/\bEAA[A-Za-z0-9]{20,}/g, OCULTO],
];

/** Texto sin credenciales. Úsalo en TODO lo que se muestre o se registre. */
export function sanear(texto: unknown): string {
  let salida = String(texto ?? "");
  const literales = [...secretosRegistrados].sort((a, b) => b.length - a.length);
  for (const secreto of literales) {
    if (salida.includes(secreto)) salida = salida.split(secreto).join(OCULTO);
  }
  for (const [patron, reemplazo] of PATRONES) salida = salida.replace(patron, reemplazo);
  return salida;
}

/** URL sin parámetros con credenciales. */
export function sanearUrl(url: string | URL): string {
  try {
    const u = new URL(String(url));
    for (const nombre of ["access_token", "input_token", "client_secret", "apikey", "api_key"]) {
      if (u.searchParams.has(nombre)) u.searchParams.set(nombre, OCULTO);
    }
    return sanear(u.toString().split("%5BOCULTO%5D").join(OCULTO));
  } catch {
    return sanear(String(url));
  }
}

/** Mensaje saneado de cualquier valor lanzado. */
export function mensajeSaneado(error: unknown): string {
  if (error instanceof Error) return sanear(error.message);
  if (typeof error === "string") return sanear(error);
  try {
    return sanear(JSON.stringify(error));
  } catch {
    return "error desconocido";
  }
}

/** Sanea en profundidad un valor serializable (para las respuestas JSON). */
export function sanearProfundo<T>(valor: T): T {
  if (typeof valor === "string") return sanear(valor) as unknown as T;
  if (Array.isArray(valor)) return valor.map((v) => sanearProfundo(v)) as unknown as T;
  if (valor && typeof valor === "object") {
    const salida: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(valor as Record<string, unknown>)) salida[k] = sanearProfundo(v);
    return salida as T;
  }
  return valor;
}

/** «…abcd»: como mucho los 4 últimos caracteres. Tokens cortos no muestran nada. */
export function enmascarar(token: string | undefined | null): string {
  if (!token) return "(vacío)";
  const t = token.trim();
  if (t.length < 12) return "…(oculto)";
  return `…${t.slice(-4)}`;
}

type Nivel = "info" | "warn" | "error";

/**
 * Única salida a consola de las funciones de Instagram: etiqueta + mensaje +
 * datos, todo saneado. Los Error se reducen a su mensaje (nunca la pila con
 * variables ni la causa sin sanear).
 */
export function registro(nivel: Nivel, etiqueta: string, mensaje: string, datos?: unknown): void {
  let extra = "";
  if (datos !== undefined) {
    if (datos instanceof Error) extra = ` ${mensajeSaneado(datos)}`;
    else {
      try {
        extra = ` ${sanear(JSON.stringify(datos))}`;
      } catch {
        extra = "";
      }
    }
  }
  const linea = `[${etiqueta}] ${sanear(mensaje)}${extra}`;
  if (nivel === "error") console.error(linea);
  else if (nivel === "warn") console.warn(linea);
  else console.info(linea);
}
