// Tapas → Redes (26/11/2026): con Redes configurada (VITE_RRSS_URL), guardar las tapas
// las manda a rrss (solo con «Redes» › «Puede editar») y NO crea la story antigua, ni
// enseña su botón: así nunca salen las dos.
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  alGuardar: vi.fn(async () => ({ estado: "nada" })),
  aRedes: vi.fn(async () => ({ estado: "enviada" })),
  redes: true,
}));

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
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (seccion: string) => ({ canAccess: seccion === "marketing" || mocks.redes, loading: false }),
}));
vi.mock("@/lib/redesTapas", () => ({ enviarTapasARedes: mocks.aRedes }));
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
  mocks.aRedes.mockClear();
  mocks.redes = true;
  vi.stubEnv("VITE_RRSS_URL", "https://rrss.ejemplo.test");
});

describe("Tapas → Redes", () => {
  it("guardar las tapas las manda a Redes y no crea la story antigua", async () => {
    pintar();
    await screen.findByText("Todavía no hay nada guardado");
    expect(screen.queryByRole("button", { name: /Crear story de Instagram/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Tapas (una por línea)"), { target: { value: "Gambón rebozado | 3 €\nBravas" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y publicar" }));
    await waitFor(() => expect(mocks.aRedes).toHaveBeenCalledTimes(1));
    expect(mocks.aRedes.mock.calls[0]![0]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mocks.alGuardar).not.toHaveBeenCalled();
  });

  it("sin «Puede editar» en Redes: se guarda, pero no se manda nada ni sale la antigua", async () => {
    mocks.redes = false;
    pintar();
    await screen.findByText("Todavía no hay nada guardado");
    fireEvent.change(screen.getByLabelText("Tapas (una por línea)"), { target: { value: "Gambón rebozado" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar y publicar" }));
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.aRedes).not.toHaveBeenCalled();
    expect(mocks.alGuardar).not.toHaveBeenCalled();
  });
});
