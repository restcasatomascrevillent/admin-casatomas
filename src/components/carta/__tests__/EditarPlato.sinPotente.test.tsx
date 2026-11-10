import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { EditarPlatoModal } from "../EditarPlatoModal";
import type { Plato } from "@/hooks/usePlatos";

vi.mock("@/hooks/usePlatos", () => ({
  usePlatos: () => ({
    crearPlato: { mutateAsync: vi.fn(), isPending: false },
    actualizarPlato: { mutateAsync: vi.fn(), isPending: false },
    categorias: ["POSTRES"],
    unidades: ["Unidad"],
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Dueño (10/11/2026): «Quitar el botón de mandar a dispositivo potente».
describe("Editar plato sin «Mandar a un dispositivo potente»", () => {
  it("el editor no lo muestra", () => {
    const plato = {
      id: "p1", nombre: "Flan", categoria: "POSTRES", precio_eur: 5, descripcion: null,
      alergenos_oficiales: ["huevos"], video_url: null,
    } as unknown as Plato;
    render(<EditarPlatoModal open onOpenChange={vi.fn()} plato={plato} />);
    expect(screen.getAllByText(/Vídeo del plato/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/dispositivo potente/i)).not.toBeInTheDocument();
  });

  it("ni el editor ni «Vídeo del plato» pueden crear trabajos para otro dispositivo", () => {
    for (const ruta of ["src/components/carta/EditarPlatoModal.tsx", "src/components/carta/video/SeccionVideoPlato.tsx"]) {
      const fuente = readFileSync(ruta, "utf8");
      expect(fuente).not.toMatch(/BotonMandarPotente|mandarOriginalAPotente|mandarAPotente/);
    }
  });
});
