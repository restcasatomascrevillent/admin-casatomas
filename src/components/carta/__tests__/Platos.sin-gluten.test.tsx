import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PlatoForm } from '../PlatoForm';
import { EditarPlatoModal } from '../EditarPlatoModal';
import type { Plato } from '@/hooks/usePlatos';

const mutaciones = vi.hoisted(() => ({ crear: vi.fn(), actualizar: vi.fn() }));
vi.mock('@/hooks/usePlatos', () => ({ usePlatos: () => ({
  crearPlato: { mutateAsync: mutaciones.crear, isPending: false },
  actualizarPlato: { mutateAsync: mutaciones.actualizar, isPending: false },
  categorias: ['SNACK'], unidades: ['ración'],
}) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const plato = {
  id: 'p1', nombre: 'Croquetas', categoria: 'SNACK', precio_eur: 12,
  descripcion: 'Croquetas de jamón', alergenos_oficiales: ['gluten'], sin_gluten_disponible: true,
} as Plato;

describe('Marcador sin gluten al crear y editar platos', () => {
  beforeEach(() => { vi.clearAllMocks(); mutaciones.crear.mockResolvedValue({ id: 'p2' }); mutaciones.actualizar.mockResolvedValue(undefined); });

  it('incluye el marcador al crear un plato', async () => {
    render(<PlatoForm open onOpenChange={vi.fn()} categoriaInicial="SNACK" />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: 'Croquetas' } });
    const checkbox = screen.getByRole('checkbox', { name: 'Se puede hacer sin gluten' });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar Plato' }));
    await waitFor(() => expect(mutaciones.crear).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Croquetas', sin_gluten_disponible: true })));
  });

  it('recupera el marcador guardado y permite quitarlo sin borrar el alérgeno gluten', async () => {
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={plato} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Se puede hacer sin gluten' });
    await waitFor(() => expect(checkbox).toBeChecked());
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }));
    await waitFor(() => expect(mutaciones.actualizar).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', sin_gluten_disponible: false, alergenos_oficiales: ['gluten'] })));
  });
});
