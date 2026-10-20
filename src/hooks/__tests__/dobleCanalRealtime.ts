/**
 * Doble de los canales realtime de supabase-js para los tests: `supabase.channel(nombre)`
 * devuelve un canal que apunta sus escuchas (`.on(tipo, filtro, callback)`) y el callback de
 * estado de `.subscribe(cb)`, y deja dispararlos a mano:
 *
 *   const canales = crearDobleCanales();
 *   vi.mocked(supabase.channel).mockImplementation(canales.channel);   // o en el vi.mock
 *   …
 *   canales.ultimo().estado("SUBSCRIBED");
 *   canales.ultimo().cambio({ eventType: "INSERT", new: {…} });
 *
 * `removeChannel(canal)` hace lo mismo que realtime-js 2.81.1: emite CLOSED al callback de estado
 * de forma SÍNCRONA, dentro de la propia llamada (ver realtimeCanal.realtimejs.test.ts). Así un hook
 * que llamara a `removeChannel` antes de `vigilancia.cerrar()` avisaría de su propia salida y su
 * test de desmontaje caería.
 *
 * No es un test (no acaba en `.test.ts`): lo importan los tests de los hooks con realtime.
 */
import { vi } from "vitest";

export interface EscuchaDoble {
  tipo: string;
  filtro: Record<string, unknown>;
  callback: (payload: unknown) => void;
}

export interface CanalDoble {
  nombre: string;
  escuchas: EscuchaDoble[];
  /** El callback que el hook pasó a `.subscribe()` (undefined si no pasó ninguno). */
  alEstado: ((estado: string, error?: Error) => void) | undefined;
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  /** Simula un cambio de estado del canal (SUBSCRIBED, CHANNEL_ERROR, TIMED_OUT, CLOSED). */
  estado: (estado: string, error?: Error) => void;
  /** Simula un evento `postgres_changes` (llega a todas las escuchas de ese tipo). */
  cambio: (payload?: unknown) => void;
  /** Simula un mensaje `system` del servidor. */
  sistema: (payload: unknown) => void;
  /** Tablas de sus escuchas `postgres_changes`. */
  tablas: () => string[];
}

export interface DobleCanales {
  channel: ReturnType<typeof vi.fn>;
  removeChannel: ReturnType<typeof vi.fn>;
  canales: CanalDoble[];
  ultimo: () => CanalDoble;
  /** Nombres pasados a `supabase.channel`, en orden. */
  nombres: () => string[];
  reiniciar: () => void;
}

export function crearDobleCanales(): DobleCanales {
  const canales: CanalDoble[] = [];

  const crearCanal = (nombre: string): CanalDoble => {
    const canal = { nombre, escuchas: [] as EscuchaDoble[], alEstado: undefined } as CanalDoble;
    canal.on = vi.fn((tipo: string, filtro: Record<string, unknown>, callback: (payload: unknown) => void) => {
      canal.escuchas.push({ tipo, filtro, callback });
      return canal;
    });
    canal.subscribe = vi.fn((callback?: (estado: string, error?: Error) => void) => {
      canal.alEstado = callback;
      return canal;
    });
    canal.estado = (estado, error) => canal.alEstado?.(estado, error);
    canal.cambio = (payload = {}) => {
      for (const e of canal.escuchas) if (e.tipo === "postgres_changes") e.callback(payload);
    };
    canal.sistema = (payload) => {
      for (const e of canal.escuchas) if (e.tipo === "system") e.callback(payload);
    };
    canal.tablas = () => canal.escuchas.filter((e) => e.tipo === "postgres_changes").map((e) => String(e.filtro.table));
    return canal;
  };

  const doble: DobleCanales = {
    canales,
    channel: vi.fn((nombre: string) => {
      const canal = crearCanal(nombre);
      canales.push(canal);
      return canal;
    }),
    // Síncrono hasta el primer await, como realtime-js: el CLOSED llega dentro de la llamada.
    removeChannel: vi.fn(async (canal?: CanalDoble) => {
      canal?.alEstado?.("CLOSED");
      return "ok";
    }),
    ultimo: () => {
      const canal = canales[canales.length - 1];
      if (!canal) throw new Error("No se ha creado ningún canal");
      return canal;
    },
    nombres: () => canales.map((c) => c.nombre),
    reiniciar: () => {
      canales.length = 0;
      doble.channel.mockClear();
      doble.removeChannel.mockClear();
    },
  };
  return doble;
}
