// Preferencias y estado compartido de los avisos en vivo (sonido y avisos «sin ver»).
// localStorage puede fallar (modo privado, almacenamiento bloqueado): todo va en try/catch.

export const CLAVE_SONIDO = "panel-avisos-sonido";

type AlmacenMinimo = Pick<Storage, "getItem" | "setItem">;

const almacen = (): AlmacenMinimo | null => {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
};

/** Sonido activado por defecto; solo «0» lo silencia. */
export function leerSonidoActivo(storage: AlmacenMinimo | null = almacen()): boolean {
  try {
    return storage?.getItem(CLAVE_SONIDO) !== "0";
  } catch {
    return true;
  }
}

export function guardarSonidoActivo(activo: boolean, storage: AlmacenMinimo | null = almacen()): void {
  try {
    storage?.setItem(CLAVE_SONIDO, activo ? "1" : "0");
  } catch {
    // Sin almacenamiento: vale para esta sesión (estado en memoria).
  }
}

// ─── Estado compartido (useSyncExternalStore) ────────────────────────────────

export interface EstadoAvisosEnVivo {
  sonido: boolean;
  /** Avisos que han saltado y nadie ha mirado aún: mientras haya, los botones laten. */
  sinVer: number;
}

let estado: EstadoAvisosEnVivo = { sonido: leerSonidoActivo(), sinVer: 0 };
const oyentes = new Set<() => void>();
const emitir = () => oyentes.forEach((o) => o());

export const avisosEnVivo = {
  suscribir(oyente: () => void) {
    oyentes.add(oyente);
    return () => {
      oyentes.delete(oyente);
    };
  },
  leer: (): EstadoAvisosEnVivo => estado,
  sumarSinVer(n: number) {
    if (n <= 0) return;
    estado = { ...estado, sinVer: estado.sinVer + n };
    emitir();
  },
  marcarVistos() {
    if (estado.sinVer === 0) return;
    estado = { ...estado, sinVer: 0 };
    emitir();
  },
  ponerSonido(activo: boolean) {
    guardarSonidoActivo(activo);
    estado = { ...estado, sonido: activo };
    emitir();
  },
  __reset() {
    estado = { sonido: leerSonidoActivo(), sinVer: 0 };
    emitir();
  },
};
