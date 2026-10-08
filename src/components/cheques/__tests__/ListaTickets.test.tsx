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
  it("oculta compras sin código y abre la ficha privada al pulsar una compra", async () => {
    const ticket = { id: "1", codigo: "CT-ABC", creado_en: null, comprador_nombre: "Ana", comprador_telefono: "600123456", importe_eur: 100, estado: "pagado", usado: false };
    rpc.mockResolvedValueOnce({ data: { expedidos: 1, canjeados: 0, coincidencias: 1, importe_pagado: 100, tickets: [ticket, { ...ticket, id: "2", codigo: null, comprador_nombre: "Sin emitir" }, { ...ticket, id: "3", codigo: "   " }] }, error: null });
    rpc.mockResolvedValueOnce({ data: { ...ticket, comprador_email: "ana@example.com", mensaje: "Feliz cumpleaños", origen: "web" }, error: null });
    render(<ListaTickets />);
    expect(await screen.findByText("600123456")).toBeTruthy();
    expect(screen.queryByText("Sin emitir")).toBeNull();
    expect(screen.queryByText("Sin expedir")).toBeNull();
    expect(screen.queryByText("ana@example.com")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Ver compra CT-ABC" }));
    expect(await screen.findByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("Feliz cumpleaños")).toBeTruthy();
    expect(rpc).toHaveBeenLastCalledWith("detalle_cheque_regalo", { p_id: "1" });
  });
  it("sin scroll de página: solo desplaza la tabla, con la cabecera pegada y totales y paginación fuera", async () => {
    rpc.mockResolvedValue({ data: { total: 1, expedidos: 1, canjeados: 0, coincidencias: 1, importe_pagado: 50, tickets: [{ id: "1", codigo: "CT-XYZ", creado_en: null, comprador_nombre: "Luis", importe_eur: 50, estado: "pagado", usado: false }] }, error: null });
    render(<ListaTickets />);
    const tabla = (await screen.findByText("CT-XYZ")).closest("table")!;
    const caja = tabla.parentElement!;
    expect(caja).toHaveClass("flex-1", "overflow-auto");
    expect(tabla.querySelector("thead")).toHaveClass("sticky", "top-0", "bg-background");
    expect(caja).not.toContainElement(screen.getByText("Tickets expedidos"));
    expect(caja).not.toContainElement(screen.getByRole("button", { name: "Siguiente" }));
  });
  it("separa caducados y disponibles y muestra la fecha y los días restantes", async () => {
    const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const base = { creado_en: null, comprador_nombre: "Ana", importe_eur: 100, estado: "pagado", usado: false };
    rpc.mockResolvedValueOnce({ data: { expedidos: 2, canjeados: 0, caducados: 1, coincidencias: 2, importe_pagado: 200, tickets: [
      { ...base, id: "1", codigo: "CT-EXP", caduca_el: "2020-01-01" },
      { ...base, id: "2", codigo: "CT-HOY", caduca_el: hoy },
    ] }, error: null });
    render(<ListaTickets />);
    expect((await screen.findByText("CT-EXP")).closest("tr")).toHaveClass("bg-red-50");
    expect(screen.getByText("CT-HOY").closest("tr")).toHaveClass("bg-emerald-50");
    expect(screen.getByText("Caduca hoy")).toBeTruthy();
    expect(screen.getByText("01/01/2020")).toBeTruthy();
    expect(screen.getByText("Tickets caducados").parentElement).toHaveTextContent("1");
  });

});
