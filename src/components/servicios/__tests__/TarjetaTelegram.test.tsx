import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { chatIdValido } from "@/hooks/useAvisosTelegram";
import { TarjetaTelegram } from "../TarjetaTelegram";

const h = vi.hoisted(() => ({
  estado: null as unknown,
  guardar: vi.fn(),
  probar: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/hooks/useAvisosTelegram", async (original) => ({
  ...(await original<typeof import("@/hooks/useAvisosTelegram")>()),
  useAvisosTelegram: () => ({ isLoading: false, isError: false, data: h.estado }),
  useGuardarAvisosTelegram: () => ({ mutateAsync: h.guardar, isPending: false }),
  useProbarTelegram: () => ({ mutateAsync: h.probar, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));

const CONFIG = {
  activo: false,
  chat_id: null,
  hora_resumen: 9,
  tipos_al_momento: ["facturas_margen_bajo", "facturas_precio_sube"],
  silencio_activo: true,
  silencio_desde: 23,
  silencio_hasta: 8,
  resumen_ultimo_dia: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.estado = { disponible: true, config: { ...CONFIG }, ultimoEnvio: null, ultimoError: null };
});

describe("TarjetaTelegram", () => {
  it("pinta la configuración por defecto, el estado y las instrucciones", () => {
    render(<TarjetaTelegram />);
    expect(screen.getByRole("region", { name: "Telegram" })).toBeInTheDocument();
    expect(screen.getByText("Desactivado")).toBeInTheDocument();
    expect(screen.getByLabelText(/Resumen diario/)).toHaveValue("9");
    expect(screen.getByLabelText("Margen bajo al momento")).toBeChecked();
    expect(screen.getByLabelText("Reservas nuevas al momento")).not.toBeChecked();
    expect(screen.getByLabelText("Silencio nocturno de")).toBeChecked();
    expect(screen.getByTestId("tg-estado")).toHaveTextContent("Último envío:ninguno");
    expect(screen.getByText(/@BotFather/)).toBeInTheDocument();
    expect(screen.getByText(/TELEGRAM_BOT_TOKEN/)).toBeInTheDocument();
    // Sin cambios no se guarda; sin chat_id no se prueba.
    expect(screen.getByRole("button", { name: "Guardar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Enviar prueba/ })).toBeDisabled();
  });

  it("guarda chat_id, hora y tipos; no deja activar sin chat_id válido", async () => {
    h.guardar.mockResolvedValue(undefined);
    render(<TarjetaTelegram />);
    fireEvent.click(screen.getByRole("switch", { name: "Desactivado" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Para activarlo hace falta un chat_id válido."));
    expect(h.guardar).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/chat_id/), { target: { value: " -1001234567890 " } });
    fireEvent.change(screen.getByLabelText(/Resumen diario/), { target: { value: "20" } });
    fireEvent.click(screen.getByLabelText("Reservas nuevas al momento"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(h.guardar).toHaveBeenCalledTimes(1));
    expect(h.guardar.mock.calls[0][0]).toMatchObject({
      activo: true,
      chat_id: "-1001234567890",
      hora_resumen: 20,
      tipos_al_momento: ["facturas_margen_bajo", "facturas_precio_sube", "reserva_nueva"],
    });
  });

  it("«Enviar prueba» sin token avisa de «Telegram sin configurar»; enseña el último error", async () => {
    h.estado = {
      disponible: true,
      config: { ...CONFIG, chat_id: "-100123" },
      ultimoEnvio: null,
      ultimoError: { tipo: "prueba", enviado_en: new Date().toISOString(), ok: false, error: "Telegram sin configurar" },
    };
    h.probar.mockResolvedValue({ ok: false, sin_configurar: true, error: "Telegram sin configurar" });
    render(<TarjetaTelegram />);
    expect(screen.getByTestId("tg-estado")).toHaveTextContent("Telegram sin configurar");
    fireEvent.click(screen.getByRole("button", { name: /Enviar prueba/ }));
    await waitFor(() => expect(h.toast.error).toHaveBeenCalledWith("Telegram sin configurar"));
  });

  it("sin la migración lo dice", () => {
    h.estado = { disponible: false };
    render(<TarjetaTelegram />);
    expect(screen.getByRole("alert")).toHaveTextContent("20261126001000_avisos_telegram");
  });

  it("valida el chat_id como la base de datos", () => {
    expect(["-1001234567890", "12345", "@canal_ct"].every(chatIdValido)).toBe(true);
    expect(["", "hola", "@abc", "-100 12", "1; drop"].some(chatIdValido)).toBe(false);
  });
});
