/**
 * ¿Es ESTE dispositivo «potente» para procesar vídeos del plato?
 *
 * Potente = es un ordenador donde el recorte en el navegador es seguro
 * (recorteNavegadorSeguro: no móvil/tablet, ≥ 8 GB si se sabe), tiene WebGPU
 * con adaptador y el modelo del recorte tarda menos de UMBRAL_MS_FOTOGRAMA
 * por fotograma (medido con el MISMO modelo/worker que el vídeo, en WebGPU).
 *
 * La medida se guarda en localStorage con caducidad (CADUCIDAD_MS) para no
 * repetir la prueba en cada carga. Si el modelo aún no está descargado no se
 * mide (no se fuerza una descarga de ~40 MB) y no se cachea: se reintenta en
 * el siguiente sondeo, cuando la precarga del panel ya lo habrá bajado.
 *
 * Solo los dispositivos potentes muestran el aviso «Hay N vídeo(s)
 * pendiente(s)…».
 */

export const CLAVE_POTENTE = "panel.video.dispositivoPotente.v1";
/** Umbral de inferencia por fotograma (ms) para considerarse potente. */
export const UMBRAL_MS_FOTOGRAMA = 2000;
/** La medida vale una semana (drivers, navegador o equipo pueden cambiar). */
export const CADUCIDAD_MS = 7 * 24 * 60 * 60 * 1000;
/** Si la prueba falló por algo pasajero, se reintenta antes. */
export const CADUCIDAD_FALLO_MS = 6 * 60 * 60 * 1000;

export interface MedidaPotente {
  potente: boolean;
  /** Inferencia por fotograma (ms) o null si no se llegó a medir. */
  ms: number | null;
  proveedor: "webgpu" | "wasm" | null;
  motivo: string;
  /** Epoch ms de la medida. */
  medidoEn: number;
}

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function almacenPorDefecto(): Almacen | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Decisión pura a partir de los hechos medidos. */
export function decidirPotente(h: {
  seguro: boolean;
  webgpu: boolean;
  ms: number | null;
  proveedor: "webgpu" | "wasm" | null;
}): { potente: boolean; motivo: string } {
  if (!h.seguro) return { potente: false, motivo: "Móvil, tablet o poca memoria" };
  if (!h.webgpu) return { potente: false, motivo: "Sin WebGPU" };
  if (h.ms == null || !(h.ms > 0)) return { potente: false, motivo: "Sin medida del modelo" };
  if (h.proveedor !== "webgpu") return { potente: false, motivo: "El modelo no corre en WebGPU" };
  if (h.ms >= UMBRAL_MS_FOTOGRAMA)
    return { potente: false, motivo: `Lento: ${Math.round(h.ms)} ms por fotograma` };
  return { potente: true, motivo: `${Math.round(h.ms)} ms por fotograma (WebGPU)` };
}

/** Medida guardada si existe y no ha caducado. */
export function leerMedidaCacheada(almacen: Almacen | null = almacenPorDefecto(), ahora = Date.now()): MedidaPotente | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_POTENTE);
    if (!crudo) return null;
    const m = JSON.parse(crudo) as MedidaPotente;
    if (typeof m?.potente !== "boolean" || typeof m.medidoEn !== "number") return null;
    const vida = m.potente || m.ms != null ? CADUCIDAD_MS : CADUCIDAD_FALLO_MS;
    if (ahora - m.medidoEn > vida || m.medidoEn > ahora + 60_000) return null;
    return m;
  } catch {
    return null;
  }
}

export function guardarMedida(m: MedidaPotente, almacen: Almacen | null = almacenPorDefecto()): void {
  try {
    almacen?.setItem(CLAVE_POTENTE, JSON.stringify(m));
  } catch {
    /* modo privado / cuota: se medirá otra vez */
  }
}

export function olvidarMedida(almacen: Almacen | null = almacenPorDefecto()): void {
  try {
    almacen?.removeItem(CLAVE_POTENTE);
  } catch {
    /* nada */
  }
}

type NavegadorGpu = Navigator & { gpu?: { requestAdapter: () => Promise<unknown | null> } };

/** WebGPU con adaptador real (no basta con que exista navigator.gpu). */
export async function webgpuDisponible(nav: Navigator | undefined = typeof navigator !== "undefined" ? navigator : undefined): Promise<boolean> {
  const gpu = (nav as NavegadorGpu | undefined)?.gpu;
  if (!gpu?.requestAdapter) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export interface DependenciasPotente {
  nav?: Navigator;
  almacen?: Almacen | null;
  ahora?: () => number;
  /** Recorte seguro en este dispositivo (por defecto recorteNavegadorSeguro). */
  seguro?: (nav: Navigator | undefined) => boolean;
  webgpu?: (nav: Navigator | undefined) => Promise<boolean>;
  /** ¿Modelo ya descargado? (por defecto modeloRecorteGuardado). */
  modeloGuardado?: () => Promise<boolean>;
  /** Mide un fotograma con el modelo: ms de inferencia y proveedor. */
  medir?: () => Promise<{ ms: number; proveedor: "webgpu" | "wasm" }>;
}

/** Prueba real: dos inferencias sobre una imagen sintética; vale la segunda (la primera compila shaders). */
async function medirConModelo(): Promise<{ ms: number; proveedor: "webgpu" | "wasm" }> {
  const [{ mascaraModelo }, { LADO_MODELO }] = await Promise.all([
    import("../recorte/quitarFondoNavegador"),
    import("../recorte/mascaraRecorte"),
  ]);
  const crear = () => {
    const rgba = new Uint8ClampedArray(LADO_MODELO * LADO_MODELO * 4);
    for (let i = 0; i < rgba.length; i += 4) {
      const p = i / 4;
      const x = p % LADO_MODELO;
      const y = Math.floor(p / LADO_MODELO);
      const dentro = (x - LADO_MODELO / 2) ** 2 + (y - LADO_MODELO / 2) ** 2 < (LADO_MODELO / 3) ** 2;
      rgba[i] = dentro ? 200 : 40;
      rgba[i + 1] = dentro ? 120 : 40;
      rgba[i + 2] = dentro ? 60 : 50;
      rgba[i + 3] = 255;
    }
    return rgba;
  };
  await mascaraModelo(crear());
  const r = await mascaraModelo(crear());
  return { ms: r.ms, proveedor: r.proveedor };
}

let enCurso: Promise<MedidaPotente> | null = null;

/**
 * Medida (cacheada o nueva) de si este dispositivo es potente. `forzar`
 * ignora la caché. Nunca lanza: ante cualquier fallo devuelve potente=false.
 */
export function medirDispositivoPotente(opciones: { forzar?: boolean } & DependenciasPotente = {}): Promise<MedidaPotente> {
  const almacen = opciones.almacen === undefined ? almacenPorDefecto() : opciones.almacen;
  const ahora = opciones.ahora ?? Date.now;
  if (!opciones.forzar) {
    const cache = leerMedidaCacheada(almacen, ahora());
    if (cache) return Promise.resolve(cache);
  }
  if (enCurso) return enCurso;
  const nav = opciones.nav ?? (typeof navigator !== "undefined" ? navigator : undefined);
  enCurso = (async (): Promise<MedidaPotente> => {
    const base = { ms: null, proveedor: null, medidoEn: ahora() } as const;
    try {
      const seguroFn =
        opciones.seguro ?? (await import("../recorte/quitarFondoNavegador")).recorteNavegadorSeguro;
      const seguro = seguroFn(nav);
      const webgpu = seguro ? await (opciones.webgpu ?? webgpuDisponible)(nav) : false;
      if (!seguro || !webgpu) {
        const m: MedidaPotente = { ...base, ...decidirPotente({ seguro, webgpu, ms: null, proveedor: null }) };
        guardarMedida(m, almacen);
        return m;
      }
      const guardado = await (opciones.modeloGuardado ?? (await import("../recorte/quitarFondoNavegador")).modeloRecorteGuardado)();
      if (!guardado) return { ...base, potente: false, motivo: "Modelo aún sin descargar" }; // sin cachear: se reintenta
      const { ms, proveedor } = await (opciones.medir ?? medirConModelo)();
      const m: MedidaPotente = { ms, proveedor, medidoEn: ahora(), ...decidirPotente({ seguro, webgpu, ms, proveedor }) };
      guardarMedida(m, almacen);
      return m;
    } catch (e) {
      const m: MedidaPotente = { ...base, potente: false, motivo: `Prueba fallida: ${(e as Error)?.message ?? e}` };
      guardarMedida(m, almacen);
      return m;
    }
  })().finally(() => {
    enCurso = null;
  });
  return enCurso;
}
