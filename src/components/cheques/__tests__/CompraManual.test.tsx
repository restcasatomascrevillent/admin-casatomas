import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), edit: true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit }) }));
vi.mock("../VistaChequeRegalo", () => ({ VistaChequeRegalo: () => <div>Vista PDF</div> }));
import { CompraManual } from "../CompraManual";
const cheque = { id: "1", codigo: "CT-123456", importe_eur: 100, comprador_nombre: "Ana", comprador_email: "ana@example.com" };
function completar() {
  fireEvent.change(screen.getByLabelText("Nombre del comprador"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Email del comprador"), { target: { value: "ana@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo/ }));
}
describe("Compra manual", () => {
  beforeEach(() => { mock.edit = true; mock.rpc.mockReset(); mock.invoke.mockReset(); mock.rpc.mockResolvedValue({ data: cheque, error: null }); mock.invoke.mockResolvedValue({ data: { email_enviado: true }, error: null }); });
  it("exige confirmar el cobro y reutiliza la referencia tras un error de conexión", async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: new Error("Conexión interrumpida") });
    render(<CompraManual />);
    expect(screen.getByRole("button", { name: "Generar código y enviar cheque" })).toBeDisabled();
    completar(); fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    await screen.findByRole("alert");
    const referencia = mock.rpc.mock.calls[0][1].p_solicitud_id;
    fireEvent.click(screen.getByRole("button", { name: "Reintentar expedición" }));
    await screen.findByText("Cheque expedido");
    expect(mock.rpc.mock.calls[1][1].p_solicitud_id).toBe(referencia);
    expect(mock.invoke).toHaveBeenCalledWith("cheques-regalo-admin", { body: { accion: "enviar_manual", id: "1" } });
  });
  it("reintenta solo el email si ya hay un código expedido", async () => {
    mock.invoke.mockResolvedValueOnce({ data: { email_enviado: false }, error: null });
    render(<CompraManual />); completar(); fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    await screen.findByText("Cheque expedido");
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar envío" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar envío" })).toBeNull());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
  it("no permite expedir a un usuario con solo lectura", () => {
    mock.edit = false; render(<CompraManual />);
    expect(screen.getByLabelText("Nombre del comprador")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generar código y enviar cheque" })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
