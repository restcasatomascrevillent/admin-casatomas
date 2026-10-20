import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn(), edit: true, from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mock.from, rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit }) }));
vi.mock("../VistaChequeRegalo", () => ({ VistaChequeRegalo: ({ cheque }: { cheque: { mensaje?: string | null; ocultar_importe?: boolean } }) => <div data-testid="vista-pdf" data-importe={cheque.ocultar_importe ? "oculto" : "visible"}>{cheque.mensaje || "Sin dedicatoria"}</div> }));
import { CompraManual } from "../CompraManual";
const cheque = { id: "1", codigo: "CT-123456", importe_eur: 100, comprador_nombre: "Ana", comprador_email: "ana@example.com" };
function completar() {
  fireEvent.change(screen.getByLabelText("Nombre del comprador"), { target: { value: "Ana" } });
  fireEvent.change(screen.getByLabelText("Email del comprador"), { target: { value: "ana@example.com" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo/ }));
}
describe("Compra manual", () => {
  beforeEach(() => { mock.edit = true; mock.from.mockReturnValue({ select: () => ({ eq: () => ({ single: async () => ({ data: {}, error: null }) }) }) }); mock.rpc.mockReset(); mock.invoke.mockReset(); mock.rpc.mockResolvedValue({ data: cheque, error: null }); mock.invoke.mockResolvedValue({ data: { email_enviado: true }, error: null }); });
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
  it("muestra las opciones antes de expedir y excluye la dedicatoria desmarcada", async () => {
    render(<CompraManual />);
    fireEvent.change(screen.getByLabelText("Dedicatoria (opcional)"), { target: { value: "Un regalo especial" } });
    expect(await screen.findByTestId("vista-pdf")).toHaveTextContent("Un regalo especial");
    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar el importe en el regalo y en el PDF" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Incluir dedicatoria en el PDF" }));
    expect(screen.getByTestId("vista-pdf")).toHaveAttribute("data-importe", "oculto");
    expect(screen.getByTestId("vista-pdf")).toHaveTextContent("Sin dedicatoria");
    expect(screen.queryByLabelText("Dedicatoria (opcional)")).toBeNull();
    completar(); fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1].p_datos).toMatchObject({ ocultar_importe: true, mensaje: null, destinatario_nombre: "" });
  });
  it("solicita factura con datos fiscales completos y conserva el importe real", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ...cheque, solicita_factura: true }, error: null });
    mock.invoke.mockResolvedValueOnce({ data: { email_enviado: true, factura_enviada: true }, error: null });
    render(<CompraManual />); completar();
    fireEvent.click(screen.getByRole("checkbox", { name: "Solicitar factura" }));
    expect(screen.getByLabelText("Nombre o razón social")).toHaveValue("Ana");
    expect(screen.getByLabelText("NIF / CIF")).toBeRequired();
    fireEvent.change(screen.getByLabelText("NIF / CIF"), { target: { value: " 12345678Z " } });
    fireEvent.change(screen.getByLabelText("Dirección fiscal completa"), { target: { value: " Calle Mayor, 1 " } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Mostrar el importe en el regalo y en el PDF" }));
    fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    expect(await screen.findByText("Factura enviada al email del comprador.")).toBeTruthy();
    expect(mock.rpc).toHaveBeenCalledWith("crear_cheque_manual_v2", expect.objectContaining({
      p_datos: expect.objectContaining({ solicita_factura: true, importe_eur: 100, ocultar_importe: true,
        datos_factura: { nombre: "Ana", nif: "12345678Z", direccion: "Calle Mayor, 1" } }),
    }));
  });
  it("no expide si faltan los datos fiscales solicitados", async () => {
    render(<CompraManual />); completar();
    fireEvent.click(screen.getByRole("checkbox", { name: "Solicitar factura" }));
    fireEvent.submit(screen.getByRole("button", { name: "Generar código y enviar cheque" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("Completa nombre o razón social");
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("reintenta una factura pendiente sin expedir otra compra", async () => {
    mock.rpc.mockResolvedValueOnce({ data: { ...cheque, solicita_factura: true }, error: null });
    mock.invoke.mockResolvedValueOnce({ data: { email_enviado: true, factura_enviada: false }, error: null });
    render(<CompraManual />); completar();
    fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    expect(await screen.findByText("Factura solicitada · envío pendiente.")).toBeTruthy();
    mock.invoke.mockResolvedValueOnce({ data: { email_enviado: true, factura_enviada: true }, error: null });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar envío" }));
    expect(await screen.findByText("Factura enviada al email del comprador.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Reintentar envío" })).toBeNull());
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledTimes(2);
  });
  it("sin factura, omite datos fiscales y no los exige", async () => {
    render(<CompraManual />); completar();
    expect(screen.queryByLabelText("NIF / CIF")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generar código y enviar cheque" }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalled());
    expect(mock.rpc.mock.calls[0][1].p_datos).toMatchObject({ solicita_factura: false, datos_factura: null });
  });
  it("no permite expedir a un usuario con solo lectura", () => {
    mock.edit = false; render(<CompraManual />);
    expect(screen.getByLabelText("Nombre del comprador")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Generar código y enviar cheque" })).toBeDisabled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
