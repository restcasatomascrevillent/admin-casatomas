import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), edit: true, toast: vi.fn(), plantillaError: null as null | { code: string; message: string } }));
vi.mock("@/components/cheques/ListaTickets", () => ({ ListaTickets: () => <div>Listado de tickets</div> }));
vi.mock("@/components/DashboardLayout", () => ({ DashboardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
// «Ver» en Cheques siempre; «Editar» según `mock.edit` (un super admin, como «Editar»: puede todo).
vi.mock("@/hooks/useUserRole", () => ({
  useCanAccessSection: (_seccion: string, tipo: string = "view") => ({ canAccess: tipo === "view" || mock.edit, loading: false }),
}));
vi.mock("sonner", () => ({ toast: { error: mock.toast, success: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  rpc: mock.rpc,
  from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { id: true, emisor_nombre: "Casa Tomás", emisor_nif: "B12345678", emisor_direccion: "Crevillent", iva_porcentaje: 0, logo_data: "", pie: "" }, error: mock.plantillaError }) }) }) }),
} }));
import Cheques from "../Cheques";
const valido = { encontrado: true, codigo: "CT-ABCDEFGH", importe_eur: 100, estado: "pagado", usado: false, valido: true };
function abrirVerificador() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: "Verificar cheque" }), { button: 0, ctrlKey: false });
}
async function buscar() {
  abrirVerificador();
  fireEvent.change(screen.getByLabelText("Código del cheque"), { target: { value: " ct-abcdefgh " } });
  fireEvent.click(screen.getByRole("button", { name: "Verificar cheque" }));
  await screen.findByText("Cheque válido para canjear");
}
describe("Verificación y canje", () => {
  beforeEach(() => { mock.plantillaError = null; mock.rpc.mockReset(); mock.toast.mockReset(); mock.edit = true; mock.rpc.mockResolvedValue({ data: valido, error: null }); });
  it("normaliza el código, exige confirmar y utiliza el resultado devuelto por la base", async () => {
    render(<Cheques />); await buscar();
    expect(mock.rpc).toHaveBeenCalledWith("verificar_cheque_regalo", { p_codigo: "CT-ABCDEFGH" });
    fireEvent.click(screen.getByRole("button", { name: "Canjear cheque" }));
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    mock.rpc.mockResolvedValueOnce({ data: { ...valido, usado: true, valido: false }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar canje" }));
    await screen.findByText("Este cheque ya está canjeado");
    expect(mock.rpc).toHaveBeenLastCalledWith("canjear_cheque_regalo", { p_codigo: "CT-ABCDEFGH" });
    expect(screen.queryByRole("button", { name: "Canjear cheque" })).toBeNull();
  });
  it("descarta una comprobación al cambiar el código", async () => {
    render(<Cheques />); await buscar();
    fireEvent.change(screen.getByLabelText("Código del cheque"), { target: { value: "CT-OTROCODO" } });
    expect(screen.queryByText("Cheque válido para canjear")).toBeNull();
    expect(screen.queryByRole("button", { name: "Canjear cheque" })).toBeNull();
  });
  // 06/11/2026 (decisión del dueño): con solo «Ver» se consulta Y se canjea; el servidor lo permite desde
  // la migración 20261106520000 (canjear_cheque_regalo con permiso de vista).
  it("con solo «Ver» se verifica Y se canjea un cheque", async () => {
    mock.edit = false; render(<Cheques />); await buscar();
    expect(screen.queryByText("Necesitas permiso de edición para canjearlo.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Canjear cheque" }));
    mock.rpc.mockResolvedValueOnce({ data: { ...valido, usado: true, valido: false }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar canje" }));
    await screen.findByText("Este cheque ya está canjeado");
    expect(mock.rpc).toHaveBeenLastCalledWith("canjear_cheque_regalo", { p_codigo: "CT-ABCDEFGH" });
  });
  it("un error de canje obliga a comprobar de nuevo, sin presentar el cheque como válido", async () => {
    render(<Cheques />); await buscar();
    fireEvent.click(screen.getByRole("button", { name: "Canjear cheque" }));
    mock.rpc.mockResolvedValueOnce({ data: null, error: new Error("Ya canjeado") });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar canje" }));
    await waitFor(() => expect(mock.toast).toHaveBeenCalledWith("Ya canjeado"));
    expect(screen.queryByText("Cheque válido para canjear")).toBeNull();
  });
  it("muestra el fallo de Supabase y no confunde un validador ausente con un cheque inválido", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Function missing" } });
    render(<Cheques />);
    abrirVerificador();
    fireEvent.change(screen.getByLabelText("Código del cheque"), { target: { value: "CT-ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar cheque" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("todavía no está instalada en Supabase");
    expect(screen.queryByText("Cheque no encontrado")).toBeNull();
  });
  it("muestra la vista previa con edición bloqueada cuando la tabla de plantilla no está instalada", async () => {
    mock.plantillaError = { code: "PGRST205", message: "Table missing" };
    render(<Cheques />);
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
    const tab = screen.getByRole("tab", { name: "Plantilla de factura" });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    await screen.findByText("Personaliza tu factura");
    expect(screen.getByRole("alert")).toHaveTextContent("todavía no está instalada en Supabase");
    expect(screen.getByLabelText("NIF / CIF del emisor")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar plantilla" })).toBeDisabled();
    expect(screen.getByText("Así recibirá su factura el cliente")).toBeTruthy();
  });

  it("un cheque caducado nunca muestra el botón de canje", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ...valido, caduca_el: "2020-01-01", caducado: true, valido: false }, error: null });
    render(<Cheques />); abrirVerificador();
    fireEvent.change(screen.getByLabelText("Código del cheque"), { target: { value: "CT-ABCDEFGH" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar cheque" }));
    expect(await screen.findByText("Este cheque está caducado")).toBeTruthy();
    expect(screen.getByText(/Válido hasta el 01\/01\/2020/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Canjear cheque" })).toBeNull();
  });

});

describe("Pestañas según el permiso (06/11/2026)", () => {
  beforeEach(() => { mock.plantillaError = null; mock.rpc.mockReset(); mock.edit = true; mock.rpc.mockResolvedValue({ data: valido, error: null }); });
  const pestanas = () => screen.getAllByRole("tab").map((t) => t.textContent?.trim());

  it("con solo «Ver»: expedición y verificar; sin compra manual, configuración, plantilla ni Stripe (10/11/2026), y con la etiqueta «Solo lectura»", async () => {
    mock.edit = false;
    render(<Cheques />);
    expect(pestanas()).toEqual(["Expedición de tickets", "Verificar cheque"]);
    expect(screen.queryByRole("tab", { name: /Stripe/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Generar informe/ })).toBeNull();
    expect(screen.getByTestId("etiqueta-solo-lectura")).toHaveTextContent("Solo lectura");
    // Ni siquiera montadas (la compra manual iba con `forceMount`).
    expect(screen.queryByText("Personaliza tu factura")).toBeNull();
    expect(screen.queryByRole("button", { name: /Generar código y enviar cheque/ })).toBeNull();
    expect(screen.queryByText(/Necesitas permiso de edición de Cheques/)).toBeNull();
  });

  it("con «Editar» (o super admin): las seis pestañas y sin etiqueta «Solo lectura»", async () => {
    render(<Cheques />);
    expect(pestanas()).toEqual(["Expedición de tickets", "Verificar cheque", "Compra manual", "Configuración", "Plantilla de factura", "Stripe"]);
    expect(screen.queryByTestId("etiqueta-solo-lectura")).toBeNull();
    await waitFor(() => expect(screen.queryByText("Cargando plantilla…")).toBeNull());
  });
});
