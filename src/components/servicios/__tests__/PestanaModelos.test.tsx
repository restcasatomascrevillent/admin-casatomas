import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PestanaModelos } from "../PestanaModelos";

const h = vi.hoisted(() => ({
  centro: {
    dias: 30,
    ultima_lista: new Date().toISOString(),
    funciones: [
      { funcion: "chat-facturas", descripcion: null, modelo: "gpt-6-luna", modelo_respaldo: "gpt-4.1-mini", modelo_codigo: "gpt-4.1-mini (secreto CHAT_FACTURAS_MODELO)",
        centralizado: true, notas: null, cambiado_por_email: "dueño", cambiado_en: new Date().toISOString(), ultimo_modelo_usado: "gpt-4.1-mini",
        ultimo_uso: null, coste_usd: 1.234, llamadas: 50, coste_sin_tarifa: false },
      { funcion: "instagram-ia", descripcion: null, modelo: null, modelo_respaldo: null, modelo_codigo: "gpt-5.6-luna (texto) y gpt-4.1 (visión), en código",
        centralizado: false, notas: null, cambiado_por_email: null, cambiado_en: null, ultimo_modelo_usado: null, ultimo_uso: null,
        coste_usd: null, llamadas: null, coste_sin_tarifa: false },
    ],
    disponibles: [
      { id: "gpt-6-luna", owned_by: "system", creado_openai: "2026-09-14T00:00:00Z", primera_vez_visto: "", ultima_vez_visto: "", retirado_en: null,
        de_interes: true, nuevo: true, usd_por_m_input: 0.1, usd_por_m_output: 0.5, precio_fuente: null },
      { id: "gpt-4.1-mini", owned_by: "system", creado_openai: null, primera_vez_visto: "", ultima_vez_visto: "", retirado_en: null,
        de_interes: true, nuevo: false, usd_por_m_input: 0.4, usd_por_m_output: 1.6, precio_fuente: null },
      { id: "dall-e-3", owned_by: "system", creado_openai: null, primera_vez_visto: "", ultima_vez_visto: "", retirado_en: null,
        de_interes: false, nuevo: false, usd_por_m_input: null, usd_por_m_output: null, precio_fuente: null },
    ],
    historial: [{ funcion: "chat-facturas", modelo_anterior: null, modelo_nuevo: "gpt-6-luna", respaldo_anterior: null, respaldo_nuevo: "gpt-4.1-mini",
      notas: "barato", cambiado_por_email: "dueño", cambiado_en: new Date().toISOString() }],
  },
}));

vi.mock("@/hooks/useModelosIa", () => {
  const mut = () => ({ mutateAsync: vi.fn(), isPending: false });
  return {
    useCentroModelos: () => ({ isLoading: false, isError: false, data: { disponible: true, centro: h.centro } }),
    useGuardarModeloFuncion: mut,
    useProbarModelo: mut,
    useSincronizarModelos: mut,
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("PestanaModelos", () => {
  it("pinta cada función con su modelo, coste y botones; la lista marca los nuevos; el historial", () => {
    render(<PestanaModelos />);
    const chat = screen.getByTestId("modelo-funcion-chat-facturas");
    expect(within(chat).getByText("elegido aquí")).toBeInTheDocument();
    expect(within(chat).getByText(/1,23 \$ · 50 llamadas/)).toBeInTheDocument();
    expect(within(chat).getByRole("button", { name: /Probar gpt-6-luna/ })).toBeEnabled();
    expect(within(chat).getByRole("button", { name: "Guardar" })).toBeDisabled();

    const ig = screen.getByTestId("modelo-funcion-instagram-ia");
    expect(within(ig).getByText(/fijo en el código/)).toBeInTheDocument();
    expect(within(ig).queryByRole("button", { name: "Guardar" })).toBeNull();

    const lista = screen.getByRole("region", { name: /Modelos de la cuenta/ });
    expect(within(lista).getAllByText("Nuevo").length).toBeGreaterThan(0);
    expect(within(lista).queryByText("dall-e-3")).toBeNull(); // filtro «solo GPT, o y embeddings»
    expect(screen.getByText("barato")).toBeInTheDocument();
  });
});
