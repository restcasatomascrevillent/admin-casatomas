import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { usePlatos, type Plato } from '../usePlatos';

const bd = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn() }));
vi.mock('@/lib/rebuild-webs', () => ({ notificarGuardadoYPublicacion: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  functions: { invoke: vi.fn(async () => ({ data: { ok: true, translations: {} }, error: null })) },
  from: () => {
    const respuesta = { data: { id: 'p1' }, error: null };
    const q = { select: () => q, order: () => q, eq: () => q, single: async () => respuesta,
      insert: (dato: unknown) => { bd.insert(dato); return q; },
      update: (dato: unknown) => { bd.update(dato); return q; },
      then: (fn: (dato: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(fn),
    };
    return q;
  },
} }));

function preparar(anterior: Partial<Plato> = { sin_gluten_disponible: true }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
  client.setQueryData(['platos'], [{ id: 'p1', nombre: 'Croquetas', alergenos_oficiales: ['gluten'], ...anterior }]);
  return renderHook(() => usePlatos(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}

describe('Persistencia de la preparación sin gluten', () => {
  beforeEach(() => vi.clearAllMocks());

  it('guarda true en la inserción del nuevo plato', async () => {
    const { result } = preparar();
    await act(async () => { await result.current.crearPlato.mutateAsync({ nombre: 'Croquetas', categoria: 'SNACK', precio_eur: 12, sin_gluten_disponible: true, alergenos_oficiales: ['gluten'] }); });
    expect(bd.insert).toHaveBeenCalledWith([expect.objectContaining({ sin_gluten_disponible: true, alergenos_oficiales: ['gluten'] })]);
  });

  it('permite quitar el marcador sin tocar los alérgenos ni retraducir el plato', async () => {
    const { result } = preparar();
    await act(async () => { await result.current.actualizarPlato.mutateAsync({ id: 'p1', sin_gluten_disponible: false }); });
    expect(bd.update).toHaveBeenCalledWith({ sin_gluten_disponible: false });
  });

  it('un guardado normal sigue funcionando antes de aplicar la migración', async () => {
    const { result } = preparar({});
    await act(async () => { await result.current.actualizarPlato.mutateAsync({ id: 'p1', precio_eur: 15, sin_gluten_disponible: false }); });
    expect(bd.update).toHaveBeenCalledWith({ precio_eur: 15 });
  });
});
