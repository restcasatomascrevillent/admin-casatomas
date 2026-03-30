/**
 * Mock del cliente Supabase para tests.
 *
 * Cada test que necesite comportamiento específico puede sobrescribir
 * el valor de retorno de las funciones usando vi.mocked() o
 * cambiando mockResolvedValueOnce directamente.
 *
 * Patrón de uso:
 *   import { supabase } from "@/integrations/supabase/client";
 *   vi.mocked(supabase.from).mockReturnValue({ ... })
 */
import { vi } from "vitest";

// Builder encadenable que imita la API de Supabase
const makeQueryBuilder = (overrides: Record<string, unknown> = {}) => {
  const builder: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    // Default resolved value for awaiting the builder directly
    then: undefined as unknown,
    ...overrides,
  };

  // Allow `await supabase.from('x').select('*')` to resolve
  builder.then = (onfulfilled: (value: { data: null; error: null }) => unknown) =>
    Promise.resolve({ data: [], error: null }).then(onfulfilled);

  return builder;
};

const channelMock = {
  on: vi.fn().mockReturnThis(),
  subscribe: vi.fn().mockReturnThis(),
};

export const supabase = {
  from: vi.fn().mockReturnValue(makeQueryBuilder()),
  auth: {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    signUp: vi.fn().mockResolvedValue({ data: null, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: null, error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  },
  channel: vi.fn().mockReturnValue(channelMock),
  removeChannel: vi.fn().mockResolvedValue(undefined),
  functions: {
    invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
  },
};

/** Helper: reemplaza supabase.from() para devolver datos específicos */
export function mockSupabaseFrom(
  data: unknown,
  error: unknown = null,
): void {
  const builder = makeQueryBuilder();
  // Patch terminal methods to resolve with provided values
  (builder.single as ReturnType<typeof vi.fn>).mockResolvedValue({ data, error });
  (builder.maybeSingle as ReturnType<typeof vi.fn>).mockResolvedValue({ data, error });
  builder.then = (onfulfilled: (value: unknown) => unknown) =>
    Promise.resolve({ data, error }).then(onfulfilled);

  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(builder);
}

/** Helper: resetea todos los mocks a sus valores iniciales */
export function resetSupabaseMocks(): void {
  vi.clearAllMocks();
  (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue(makeQueryBuilder());
  (supabase.channel as ReturnType<typeof vi.fn>).mockReturnValue(channelMock);
  channelMock.on.mockReturnThis();
  channelMock.subscribe.mockReturnThis();
}
