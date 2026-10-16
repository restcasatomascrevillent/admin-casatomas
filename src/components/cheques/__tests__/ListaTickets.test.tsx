import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));
import { ListaTickets } from "../ListaTickets";
describe("Listado de tickets", () => {
  beforeEach(() => rpc.mockReset());
  it("destaca canjeados y busca en el servidor", async () => {
    rpc.mockResolvedValue({ data: { total: 100, expedidos: 90, canjeados: 12, coincidencias: 100, importe_pagado: 1000, tickets: [{ id: "1", codigo: "CT-ABC", creado_en: null, comprador_nombre: "Ana", importe_eur: 100, estado: "pagado", usado: true }] }, error: null });
    render(<ListaTickets />);
    const codigo = await screen.findByText("CT-ABC");
    expect(codigo.closest("tr")).toHaveClass("border-l-rose-400");
    expect(screen.queryByRole("heading", { name: "Expedición total de tickets" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Cheques expedidos, del más reciente/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Actualizar" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar tickets por código o comprador"), { target: { value: " Ana " } });
    expect(screen.queryByRole("button", { name: "Buscar" })).toBeNull();
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", { p_pagina: 0, p_busqueda: "Ana", p_tamano: 6, p_orden: "fecha_desc", p_estado: "todos", p_desde: null, p_hasta: null }));
  });
  it("filtra al escribir desde la primera página y limpiar recupera todos los tickets", async () => {
    const ticket = { id: "1", codigo: "CT-ABC", creado_en: null, comprador_nombre: "Ana", importe_eur: 100, estado: "pagado", usado: false };
    rpc.mockResolvedValue({ data: { expedidos: 100, canjeados: 0, coincidencias: 100, importe_pagado: 1000, tickets: [ticket] }, error: null });
    render(<ListaTickets />);
    await screen.findByText("CT-ABC");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", { p_pagina: 1, p_busqueda: "", p_tamano: 6, p_orden: "fecha_desc", p_estado: "todos", p_desde: null, p_hasta: null }));
    const buscador = screen.getByLabelText("Buscar tickets por código o comprador");
    fireEvent.change(buscador, { target: { value: "A" } });
    fireEvent.change(buscador, { target: { value: "An" } });
    fireEvent.change(buscador, { target: { value: "Ana" } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", { p_pagina: 0, p_busqueda: "Ana", p_tamano: 6, p_orden: "fecha_desc", p_estado: "todos", p_desde: null, p_hasta: null }));
    expect(rpc).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", { p_pagina: 0, p_busqueda: "", p_tamano: 6, p_orden: "fecha_desc", p_estado: "todos", p_desde: null, p_hasta: null }));
    expect(buscador).toHaveValue("");
  });
  it("una respuesta lenta no sustituye los resultados de lo último escrito", async () => {
    const listado = (codigo: string) => ({ data: { expedidos: 1, canjeados: 0, coincidencias: 1, importe_pagado: 100, tickets: [{ id: codigo, codigo, creado_en: null, comprador_nombre: "Ana", importe_eur: 100, estado: "pagado", usado: false }] }, error: null });
    let resolver!: (value: ReturnType<typeof listado>) => void;
    rpc.mockResolvedValueOnce(listado("CT-INICIAL"))
      .mockImplementationOnce(() => new Promise(resolve => { resolver = resolve; }))
      .mockResolvedValueOnce(listado("CT-RECIENTE"));
    render(<ListaTickets />);
    await screen.findByText("CT-INICIAL");
    const buscador = screen.getByLabelText("Buscar tickets por código o comprador");
    fireEvent.change(buscador, { target: { value: "An" } });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
    expect(screen.getByText("CT-INICIAL")).toBeTruthy();
    fireEvent.change(buscador, { target: { value: "Ana" } });
    await screen.findByText("CT-RECIENTE");
    await act(async () => resolver(listado("CT-OBSOLETO")));
    expect(screen.getByText("CT-RECIENTE")).toBeTruthy();
    expect(screen.queryByText("CT-OBSOLETO")).toBeNull();
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
  it("pagina sin scroll interno de tabla y adapta las filas al móvil", async () => {
    rpc.mockResolvedValue({ data: { total: 1, expedidos: 1, canjeados: 0, coincidencias: 1, importe_pagado: 50, tickets: [{ id: "1", codigo: "CT-XYZ", creado_en: null, comprador_nombre: "Luis", importe_eur: 50, estado: "pagado", usado: false }] }, error: null });
    render(<ListaTickets />);
    const tabla = (await screen.findByText("CT-XYZ")).closest("table")!;
    const caja = tabla.parentElement!;
    expect(caja.className).not.toMatch(/overflow|h-\[/);
    expect(tabla).toHaveClass("[@container(min-width:60rem)]:table-fixed");
    expect(tabla.querySelector("thead")).toHaveClass("hidden", "[@container(min-width:60rem)]:table-header-group");
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
    expect((await screen.findByText("CT-EXP")).closest("tr")).toHaveClass("border-l-rose-400");
    expect(screen.getByText("CT-HOY").closest("tr")).toHaveClass("border-l-emerald-400");
    expect(screen.getByText("Caduca hoy")).toBeTruthy();
    expect(screen.getByText("01/01/2020")).toBeTruthy();
  });

  it("ordena y filtra todas las coincidencias desde la primera página", async () => {
    rpc.mockResolvedValue({ data: { expedidos: 24, canjeados: 0, coincidencias: 24, importe_pagado: 2000, tickets: [] }, error: null });
    render(<ListaTickets />);
    await screen.findByText("Página 1 de 4");
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    await screen.findByText("Página 2 de 4");
    await waitFor(() => expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled());
    fireEvent.change(screen.getByLabelText("Ordenar tickets"), { target: { value: "importe_asc" } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", expect.objectContaining({ p_pagina: 0, p_orden: "importe_asc" })));
    fireEvent.change(screen.getByLabelText("Filtrar por estado"), { target: { value: "disponible" } });
    fireEvent.change(screen.getByLabelText("Fecha desde"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Fecha hasta"), { target: { value: "2026-10-15" } });
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", expect.objectContaining({ p_estado: "disponible", p_desde: "2026-10-01", p_hasta: "2026-10-15" })));
    expect(screen.getByText("Página 1 de 4")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));
    await waitFor(() => expect(rpc).toHaveBeenLastCalledWith("listar_cheques_regalo_v3", expect.objectContaining({ p_estado: "todos", p_orden: "fecha_desc", p_desde: null, p_hasta: null })));
  });
  it("bloquea rangos de fechas invertidos", async () => {
    rpc.mockResolvedValue({ data: { expedidos: 0, canjeados: 0, coincidencias: 0, importe_pagado: 0, tickets: [] }, error: null });
    render(<ListaTickets />);
    await screen.findByText("Página 1 de 1");
    fireEvent.change(screen.getByLabelText("Fecha desde"), { target: { value: "2026-10-15" } });
    fireEvent.change(screen.getByLabelText("Fecha hasta"), { target: { value: "2026-10-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent("La fecha inicial no puede ser posterior");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
  });

});
