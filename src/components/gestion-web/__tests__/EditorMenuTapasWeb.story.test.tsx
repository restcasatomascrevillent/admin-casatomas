// Story de Instagram del jueves de tapas desde Gestión web › Tapas (12/11/2026):
// al guardar unas tapas se lanza el automático (sin esperar) con la fecha y las
// tapas guardadas; el botón «Crear story de Instagram» sale con permiso de
// Marketing y abre su diálogo.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ upsert: vi.fn(), alGuardar: vi.fn(async () => ({ estado: "nada" })), marketing: true }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => ({
      select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }),
      upsert: async (filas: unknown) => {
        mocks.upsert(tabla, filas);
        return { error: null };
      },
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
    functions: { invoke: async () => ({ data: { ok: true, translations: { tapas_en: ["Fried prawn"], tapas_fr: ["Gambas"] } }, error: null }) },
  },
}));
vi.mock("@/hooks/usePlatosParaMenu", () => ({ usePlatosParaMenu: () => ({ platos: [], isLoading: false, error: null }), indexarPlatos: () => new Map() }));
vi.mock("@/components/gestion-web/InterruptorMenuTapas", () => ({ InterruptorMenuTapas: () => null }));
vi.mock("@/lib/rebuild-webs", () => ({ notificarGuardadoYPublicacion: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mocks.marketing, loading: false }) }));
vi.mock("@/components/instagram/tapas/automatico", () => ({ storyTapasAlGuardar: mocks.alGuardar }));
vi.mock("@/components/instagram/tapas/DialogoCrearStoryTapas", () => ({
  DialogoCrearStoryTapas: ({ open, fecha, tapas }: { open: boolean; fecha: string; tapas: string[] }) =>
    open ? <div role="dialog">Story del {fecha}: {tapas.join(", ")}</div> : null,
}));

import { EditorMenuTapasWeb } from "@/components/gestion-web/EditorMenuTapasWeb";

const pintar = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {(<EditorMenuTapasWeb seccionActiva="tapas" />) as ReactNode}
    </QueryClientProvider>,
  );

beforeEach(() => {
  mocks.upsert.mockReset();
  mocks.alGuardar.mockClear();
  mocks.marketing = true;
});

describe("Tapas → story de Instagram", () => {
  it("guardar las tapas lanza la story automática con la fecha y las tapas", async () => {
    pintar();
    await screen.findByText("Todavía no hay nada guardado");
    fireEvent.change(screen.getByLabelText("Tapas (una por línea)"), { target: { value: "Gambón rebozado\n\nBravas  " } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y publicar" }));
    await waitFor(() => expect(mocks.alGuardar).toHaveBeenCalled());
    const [fecha, tapas] = mocks.alGuardar.mock.calls[0] as unknown as [string, string[]];
    expect(fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(tapas).toEqual(["Gambón rebozado", "Bravas"]);
  });

  it("«Crear story de Instagram» abre la vista previa con las tapas del formulario", async () => {
    pintar();
    await screen.findByText("Todavía no hay nada guardado");
    const boton = screen.getByRole("button", { name: /Crear story de Instagram/ });
    expect(boton).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Tapas (una por línea)"), { target: { value: "Gambón rebozado\nBravas" } });
    fireEvent.click(boton);
    expect(await screen.findByRole("dialog")).toHaveTextContent("Gambón rebozado, Bravas");
  });

  it("sin Marketing: ni botón ni story automática", async () => {
    mocks.marketing = false;
    pintar();
    await screen.findByText("Todavía no hay nada guardado");
    expect(screen.queryByRole("button", { name: /Crear story de Instagram/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tapas (una por línea)"), { target: { value: "Gambón rebozado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y publicar" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    expect(mocks.alGuardar).not.toHaveBeenCalled();
  });
});
