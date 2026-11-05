/**
 * Cliente mínimo de Google Drive (API v3) para las Edge Functions, con OAuth
 * y refresh token: los mismos secretos que usan las facturas
 * (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN). Es un módulo
 * aparte: procesar-factura/archivo.ts sigue con su propio código y no cambia.
 *
 *  - Los secretos se limpian (trim): pegados en el panel de Supabase pueden
 *    arrastrar un salto de línea y Google responde «invalid_client» (pasó el
 *    04-nov-2026, commit fb30bd56).
 *  - El token de acceso se guarda en memoria hasta 1 min antes de caducar.
 *  - NUNCA se registra ni se devuelve un token o un secreto: los errores llevan
 *    el estado HTTP y el mensaje de Google, recortado y sin parámetros.
 *  - Alcance (scope): la respuesta del refresh dice qué permisos tiene el
 *    token. Con `drive.file` la app SOLO ve lo que ella misma ha creado (no
 *    las carpetas ni los ficheros creados a mano); con `drive`, todo.
 *
 * Sin dependencias: solo fetch (que se simula en las pruebas).
 */

export const URL_TOKEN = "https://oauth2.googleapis.com/token";
export const URL_DRIVE = "https://www.googleapis.com/drive/v3";
export const URL_SUBIDA = "https://www.googleapis.com/upload/drive/v3";
export const TIPO_CARPETA = "application/vnd.google-apps.folder";
export const ALCANCE_DRIVE = "https://www.googleapis.com/auth/drive";
export const ALCANCE_DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";

const MS_TIEMPO = 20_000;

export interface ConfigGoogle {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/** Quita espacios y saltos de línea de los secretos (ver cabecera). */
export function limpiarConfigGoogle(cfg: Partial<ConfigGoogle>): ConfigGoogle {
  return {
    clientId: (cfg.clientId ?? "").trim(),
    clientSecret: (cfg.clientSecret ?? "").trim(),
    refreshToken: (cfg.refreshToken ?? "").trim(),
  };
}

export function configGoogleCompleta(cfg: ConfigGoogle): boolean {
  return !!(cfg.clientId && cfg.clientSecret && cfg.refreshToken);
}

/** Id de fichero o carpeta de Drive: solo letras, números, «-» y «_». */
export function esIdDrive(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(v);
}

export type MotivoErrorDrive = "sin_config" | "token" | "no_encontrado" | "permiso" | "limite" | "red" | "respuesta";

export class ErrorDrive extends Error {
  readonly estado: number;
  readonly motivo: MotivoErrorDrive;
  constructor(mensaje: string, motivo: MotivoErrorDrive, estado = 0) {
    super(mensaje);
    this.name = "ErrorDrive";
    this.motivo = motivo;
    this.estado = estado;
  }
}

/** Mensaje de error de Google, recortado (nunca lleva credenciales: no se reenvía la petición). */
async function detalleGoogle(r: Response): Promise<string> {
  const texto = await r.text().catch(() => "");
  try {
    const j = JSON.parse(texto) as { error?: string | { message?: string }; error_description?: string };
    if (typeof j.error === "string") return `${j.error}${j.error_description ? `: ${j.error_description}` : ""}`.slice(0, 300);
    if (j.error?.message) return j.error.message.slice(0, 300);
  } catch {
    /* no es JSON */
  }
  return texto.replace(/\s+/g, " ").slice(0, 200);
}

function motivoDeEstado(estado: number): MotivoErrorDrive {
  if (estado === 401) return "token";
  if (estado === 403) return "permiso";
  if (estado === 404) return "no_encontrado";
  if (estado === 429) return "limite";
  return "respuesta";
}

export interface FicheroDrive {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  parents?: string[];
  trashed?: boolean;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number; rotation?: number };
  capabilities?: { canAddChildren?: boolean; canEdit?: boolean };
}

export interface OpcionesCliente {
  config: Partial<ConfigGoogle>;
  fetch?: typeof fetch;
  ahora?: () => number;
  /** Se llama con cada token de acceso obtenido, para taparlo en los registros. */
  registrarSecreto?: (valor: string) => void;
}

interface TokenEnMemoria {
  clave: string;
  token: string;
  caduca: number;
  alcances: string[];
}
// Un token por instancia de la función (se reutiliza entre peticiones).
let tokenEnMemoria: TokenEnMemoria | null = null;

/** Solo para pruebas. */
export function olvidarTokenDrive(): void {
  tokenEnMemoria = null;
}

/** «drive», «drive.file»… a partir de las URL de alcance de Google. */
export function nombreAlcance(url: string): string {
  return url.replace(/^https:\/\/www\.googleapis\.com\/auth\//, "");
}

export class ClienteDrive {
  private readonly cfg: ConfigGoogle;
  private readonly f: typeof fetch;
  private readonly ahora: () => number;
  private readonly registrar?: (valor: string) => void;

  constructor(o: OpcionesCliente) {
    this.cfg = limpiarConfigGoogle(o.config);
    this.f = o.fetch ?? fetch;
    this.ahora = o.ahora ?? Date.now;
    this.registrar = o.registrarSecreto;
    this.registrar?.(this.cfg.clientSecret);
    this.registrar?.(this.cfg.refreshToken);
  }

  get configurado(): boolean {
    return configGoogleCompleta(this.cfg);
  }

  /** Token de acceso y alcances concedidos. */
  async token(): Promise<{ token: string; alcances: string[] }> {
    if (!this.configurado) {
      throw new ErrorDrive("Faltan los secretos de Google (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)", "sin_config");
    }
    const clave = `${this.cfg.clientId}|${this.cfg.refreshToken}`;
    if (tokenEnMemoria && tokenEnMemoria.clave === clave && tokenEnMemoria.caduca > this.ahora()) {
      return { token: tokenEnMemoria.token, alcances: tokenEnMemoria.alcances };
    }
    let r: Response;
    try {
      r = await this.f(URL_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.cfg.clientId,
          client_secret: this.cfg.clientSecret,
          refresh_token: this.cfg.refreshToken,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(MS_TIEMPO),
      });
    } catch (e) {
      throw new ErrorDrive(`No se pudo pedir el token de Google: ${(e as Error)?.message ?? e}`, "red");
    }
    if (!r.ok) throw new ErrorDrive(`Google no dio el token (${r.status}): ${await detalleGoogle(r)}`, "token", r.status);
    const j = (await r.json().catch(() => null)) as { access_token?: string; expires_in?: number; scope?: string } | null;
    if (!j?.access_token) throw new ErrorDrive("Google respondió sin token de acceso", "token", r.status);
    this.registrar?.(j.access_token);
    const alcances = (j.scope ?? "").split(/\s+/).filter(Boolean);
    tokenEnMemoria = { clave, token: j.access_token, caduca: this.ahora() + Math.max(0, (j.expires_in ?? 3600) - 60) * 1000, alcances };
    return { token: j.access_token, alcances };
  }

  /** Petición autenticada a Drive. Lanza ErrorDrive si la respuesta no es 2xx. */
  async pedir(url: string, init: RequestInit = {}): Promise<Response> {
    const { token } = await this.token();
    let r: Response;
    try {
      r = await this.f(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
        signal: init.signal ?? AbortSignal.timeout(MS_TIEMPO),
      });
    } catch (e) {
      throw new ErrorDrive(`Sin conexión con Google Drive: ${(e as Error)?.message ?? e}`, "red");
    }
    if (!r.ok) {
      if (r.status === 401) tokenEnMemoria = null;
      throw new ErrorDrive(`Google Drive respondió ${r.status}: ${await detalleGoogle(r)}`, motivoDeEstado(r.status), r.status);
    }
    return r;
  }

  async json<T>(url: string, init: RequestInit = {}): Promise<T> {
    const r = await this.pedir(url, init);
    return (await r.json()) as T;
  }

  /** Metadatos de un fichero o carpeta (null si no existe o el token no lo ve). */
  async metadatos(id: string, campos = "id,name,mimeType,size,parents,trashed,capabilities(canAddChildren,canEdit)"): Promise<FicheroDrive | null> {
    if (!esIdDrive(id)) return null;
    try {
      return await this.json<FicheroDrive>(`${URL_DRIVE}/files/${id}?fields=${encodeURIComponent(campos)}&supportsAllDrives=true`);
    } catch (e) {
      if (e instanceof ErrorDrive && e.motivo === "no_encontrado") return null;
      throw e;
    }
  }

  /** Subcarpeta por nombre dentro de `padre` (null si no hay). */
  async buscarCarpeta(nombre: string, padre: string): Promise<string | null> {
    if (!esIdDrive(padre)) throw new ErrorDrive("Id de carpeta no válido", "respuesta");
    const q = `name='${nombre.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and '${padre}' in parents and mimeType='${TIPO_CARPETA}' and trashed=false`;
    const j = await this.json<{ files?: Array<{ id: string }> }>(
      `${URL_DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=10&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    );
    return j.files?.[0]?.id ?? null;
  }

  async crearCarpeta(nombre: string, padre: string): Promise<string> {
    const j = await this.json<{ id: string }>(`${URL_DRIVE}/files?fields=id&supportsAllDrives=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nombre, mimeType: TIPO_CARPETA, parents: [padre] }),
    });
    return j.id;
  }

  /** La carpeta `nombre` dentro de `padre`; la crea si no existe. */
  async asegurarCarpeta(nombre: string, padre: string): Promise<string> {
    return (await this.buscarCarpeta(nombre, padre)) ?? (await this.crearCarpeta(nombre, padre));
  }

  /** Recorre (y crea si falta) una ruta de carpetas desde `raiz`. Devuelve el id de la última. */
  async asegurarRuta(raiz: string, tramos: readonly string[]): Promise<string> {
    let actual = raiz;
    for (const t of tramos) actual = await this.asegurarCarpeta(t, actual);
    return actual;
  }

  /** Imágenes (no en la papelera) de una carpeta, las más recientes primero. */
  async listarImagenes(carpeta: string, maximo = 500): Promise<FicheroDrive[]> {
    if (!esIdDrive(carpeta)) throw new ErrorDrive("Id de carpeta no válido", "respuesta");
    const q = `'${carpeta}' in parents and trashed=false and mimeType contains 'image/'`;
    const campos = "nextPageToken,files(id,name,mimeType,size,createdTime,parents,thumbnailLink,imageMediaMetadata(width,height,rotation))";
    const salida: FicheroDrive[] = [];
    let pagina: string | undefined;
    do {
      const url =
        `${URL_DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(campos)}&orderBy=createdTime%20desc` +
        `&pageSize=${Math.min(200, maximo)}&supportsAllDrives=true&includeItemsFromAllDrives=true${pagina ? `&pageToken=${encodeURIComponent(pagina)}` : ""}`;
      const j = await this.json<{ files?: FicheroDrive[]; nextPageToken?: string }>(url);
      salida.push(...(j.files ?? []));
      pagina = j.nextPageToken;
    } while (pagina && salida.length < maximo);
    return salida.slice(0, maximo);
  }

  /** Sube un fichero (multipart: metadatos + contenido en una sola petición). */
  async subir(carpeta: string, nombre: string, tipo: string, bytes: Uint8Array, descripcion?: string): Promise<FicheroDrive> {
    const frontera = `frontera-${crypto.randomUUID()}`;
    const meta = JSON.stringify({ name: nombre, parents: [carpeta], ...(descripcion ? { description: descripcion } : {}) });
    const cod = new TextEncoder();
    const cabeza = cod.encode(`--${frontera}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${frontera}\r\nContent-Type: ${tipo}\r\n\r\n`);
    const cola = cod.encode(`\r\n--${frontera}--`);
    const cuerpo = new Uint8Array(cabeza.length + bytes.length + cola.length);
    cuerpo.set(cabeza, 0);
    cuerpo.set(bytes, cabeza.length);
    cuerpo.set(cola, cabeza.length + bytes.length);
    return await this.json<FicheroDrive>(
      `${URL_SUBIDA}/files?uploadType=multipart&supportsAllDrives=true&fields=${encodeURIComponent("id,name,mimeType,size,parents,createdTime")}`,
      { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${frontera}` }, body: cuerpo, signal: AbortSignal.timeout(60_000) },
    );
  }

  /** Contenido de un fichero. */
  async descargar(id: string): Promise<{ bytes: Uint8Array; tipo: string }> {
    if (!esIdDrive(id)) throw new ErrorDrive("Id de fichero no válido", "respuesta");
    const r = await this.pedir(`${URL_DRIVE}/files/${id}?alt=media&supportsAllDrives=true`, { signal: AbortSignal.timeout(60_000) });
    const tipo = (r.headers.get("content-type") ?? "application/octet-stream").split(";")[0].trim();
    return { bytes: new Uint8Array(await r.arrayBuffer()), tipo };
  }

  /**
   * Miniatura de un fichero a partir de su `thumbnailLink` (solo si es de
   * googleusercontent.com, para no pedir otra URL con el token). null si no hay.
   */
  async miniatura(thumbnailLink: string | undefined, lado = 400): Promise<{ bytes: Uint8Array; tipo: string } | null> {
    const url = urlMiniatura(thumbnailLink, lado);
    if (!url) return null;
    try {
      const r = await this.pedir(url);
      const tipo = (r.headers.get("content-type") ?? "").split(";")[0].trim();
      if (!tipo.startsWith("image/")) return null;
      return { bytes: new Uint8Array(await r.arrayBuffer()), tipo };
    } catch {
      return null;
    }
  }
}

/** thumbnailLink → URL con el tamaño pedido; null si no es https de *.googleusercontent.com. */
export function urlMiniatura(thumbnailLink: string | undefined, lado = 400): string | null {
  if (!thumbnailLink) return null;
  let u: URL;
  try {
    u = new URL(thumbnailLink);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !(u.hostname === "googleusercontent.com" || u.hostname.endsWith(".googleusercontent.com"))) return null;
  if (u.username || u.password || u.port) return null;
  const n = Math.max(32, Math.min(1600, Math.round(lado)));
  return /=s\d+$/.test(u.href) ? u.href.replace(/=s\d+$/, `=s${n}`) : u.href;
}

/**
 * Medidas de un JPEG leyendo su cabecera (marcadores SOF). null si no es un
 * JPEG o no se encuentra. No aplica la orientación EXIF.
 */
export function medidasJpeg(b: Uint8Array): { ancho: number; alto: number } | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const m = b[i + 1];
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2;
      continue;
    }
    const largo = (b[i + 2] << 8) | b[i + 3];
    // SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const alto = (b[i + 5] << 8) | b[i + 6];
      const ancho = (b[i + 7] << 8) | b[i + 8];
      return ancho > 0 && alto > 0 ? { ancho, alto } : null;
    }
    if (m === 0xda || largo < 2) return null;
    i += 2 + largo;
  }
  return null;
}
