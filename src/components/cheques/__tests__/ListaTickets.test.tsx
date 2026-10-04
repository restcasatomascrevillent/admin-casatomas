import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { ListaTickets } from "../ListaTickets";
describe("Listado de tickets", () => {
  beforeEach(() => rpc.mockReset());
  it("destaca canjeados, muestra totales globales y busca en el servidor", async () => {
    rpc.mockResolvedValue({ data: { total: 100, expedidos: 90, canjeados: 12, coincidencias: 100, importe_pagado: 1000, tickets: [{ id: "1", codigo: "CT-ABC", creado_en: null, comprador_nombre: "Ana", importe_eur: 100, estado: "pagado", usado: true }] }, error: null });
    render(<ListaTickets />);
    const codigo = await screen.findByText("CT-ABC");
    expect(codigo.closest("tr")).toHaveClass("bg-red-50");
    expect(screen.getByText("Tickets canjeados").parentElement).toHaveTextContent("12");
    expect(screen.getByText("Tickets expedidos").parentElement).toHaveTextContent("90");
    fireEvent.change(screen.getByLabelText("Buscar tickets por código o comprador"), { target: { value: " Ana " } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v2", { p_pagina: 0, p_busqueda: "Ana" }));
  });
});
