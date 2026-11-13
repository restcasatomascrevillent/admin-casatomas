/**
 * «Reenviar correo al cliente» en la información de la compra: solo en cheques
 * web pagados y con permiso de edición, pide confirmación, enseña que está
 * enviando y avisa con el resultado (o con el motivo que da el servidor).
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
  edit: true,
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mock.rpc, functions: { invoke: mock.invoke } } }));
vi.mock("@/hooks/useUserRole", () => ({ useCanAccessSection: () => ({ canAccess: mock.edit, loading: false }) }));
vi.mock("@/hooks/useHoyCheques", () => ({ useHoyCheques: () => "2026-11-13" }));
vi.mock("sonner", () => ({ toast: mock.toast }));
import { DetalleCompra } from "../DetalleCompra";

const ID = "0621b106-0000-4000-8000-000000000001";
const WEB = {
  id: ID, codigo: "CT-ABCD-1234", importe_eur: 10, comprador_nombre: "Ana García", comprador_email: "ana@example.com",
  comprador_telefono: null, destinatario_nombre: "María", mensaje: null, fecha_entrega_deseada: null, caduca_el: "2027-11-10",
  estado: "pagado", usado: false, creado_en: "2026-11-10T10:00:00Z", email_enviado_en: null, canjeado_en: null, origen: "web",
  pago_manual_metodo: null, solicita_factura: false, datos_factura: null, factura_numero: null,
  stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", ocultar_importe: false,
};

function pintar(compra: Record<string, unknown> = WEB) {
  mock.rpc.mockResolvedValue({ data: compra, error: null });
  return render(<DetalleCompra id={ID} onClose={() => undefined} />);
}

const BOTON = { name: /Reenviar correo al cliente/ };

describe("Reenviar correo al cliente", () => {
  beforeEach(() => {
    mock.rpc.mockReset();
    mock.invoke.mockReset();
    mock.toast.success.mockReset();
    mock.toast.error.mockReset();
    mock.edit = true;
  });

  it("en un cheque web pagado: pide confirmación, envía, avisa y recarga la compra", async () => {
    pintar();
    let responder: (valor: unknown) => void = () => undefined;
    mock.invoke.mockReturnValue(new Promise((resolve) => { responder = resolve; }));

    fireEvent.click(await screen.findByRole("button", BOTON));
    const confirmacion = await screen.findByRole("alertdialog");
    expect(confirmacion).toHaveTextContent("CT-ABCD-1234");
    expect(confirmacion).toHaveTextContent("ana@example.com");
    expect(mock.invoke).not.toHaveBeenCalled();
    fireEvent.click(within(confirmacion).getByRole("button", { name: "Sí, reenviar" }));

    // Mientras se envía: el botón dice que está enviando y no se puede repetir.
    const enviando = await screen.findByRole("button", { name: /Reenviando/ });
    expect(enviando).toBeDisabled();
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    const [funcion, { body }] = mock.invoke.mock.calls[0];
    expect(funcion).toBe("cheques-regalo-admin");
    expect(body).toMatchObject({ accion: "reenviar_email", id: ID });
    expect(typeof body.clave_envio).toBe("string");

    mock.rpc.mockResolvedValue({ data: { ...WEB, email_enviado_en: "2026-11-13T19:00:00Z" }, error: null });
    responder({ data: { email_enviado: true, email_enviado_en: "2026-11-13T19:00:00Z" }, error: null });
    await waitFor(() => expect(mock.toast.success).toHaveBeenCalledWith("Correo reenviado a ana@example.com.", undefined));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", BOTON)).not.toBeDisabled();
  });

  it("si el servidor no lo envía, enseña su motivo (p. ej. falta RESEND_API_KEY en la demo)", async () => {
    pintar();
    const mensaje = "No se ha enviado: falta RESEND_API_KEY en los secretos de Supabase de este entorno. En la demo es lo normal: no manda correos.";
    mock.invoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: new Response(JSON.stringify({ motivo: "sin_resend", mensaje, email_enviado: false }), { status: 503 }) },
    });
    fireEvent.click(await screen.findByRole("button", BOTON));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sí, reenviar" }));
    await waitFor(() => expect(mock.toast.error).toHaveBeenCalledWith(mensaje));
    expect(mock.toast.success).not.toHaveBeenCalled();
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it("si se corta la red, mensaje genérico y el siguiente intento usa la misma clave (no manda dos correos)", async () => {
    pintar();
    mock.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError", message: "Failed to send a request" } });
    mock.invoke.mockResolvedValueOnce({ data: { email_enviado: true }, error: null });
    for (let intento = 0; intento < 2; intento++) {
      fireEvent.click(await screen.findByRole("button", BOTON));
      fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Sí, reenviar" }));
      await waitFor(() => expect(mock.invoke).toHaveBeenCalledTimes(intento + 1));
    }
    expect(mock.toast.error).toHaveBeenCalledWith("No se pudo reenviar el correo. Vuelve a intentarlo.");
    await waitFor(() => expect(mock.toast.success).toHaveBeenCalled());
    expect(mock.invoke.mock.calls[0][1].body.clave_envio).toBe(mock.invoke.mock.calls[1][1].body.clave_envio);
  });

  it("cancelar la confirmación no envía nada", async () => {
    pintar();
    fireEvent.click(await screen.findByRole("button", BOTON));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "No, volver" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mock.invoke).not.toHaveBeenCalled();
  });

  it("no sale en compras manuales, cheques cancelados ni sin permiso de edición", async () => {
    for (const [compra, edit] of [[{ ...WEB, origen: "manual", pago_manual_metodo: "efectivo" }, true], [{ ...WEB, estado: "cancelado" }, true], [WEB, false]] as const) {
      mock.edit = edit;
      const { unmount } = pintar(compra);
      await screen.findByText("Pago y entrega");
      expect(screen.queryByRole("button", BOTON)).toBeNull();
      unmount();
    }
  });
});
