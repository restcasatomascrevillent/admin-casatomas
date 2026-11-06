/**
 * Diálogo «Programar publicación» y calendario de Instagram con Supabase
 * simulado: la hora se manda en UTC desde la hora de Madrid, el aviso de ±30
 * min pide confirmación y reenvía con p_confirmar_conflicto, el calendario
 * pinta programadas, con error y publicadas en su día, y cancelar / ver error
 * van por el menú de cada pieza.
 */
import type { ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const sbFalso = vi.hoisted(() => ({
  datos: {} as Record<string, unknown[]>,
  rpc: null as unknown as Mock<(...a: unknown[]) => Promise<unknown>>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabla: string) => {
    const q: Record<string, unknown> = {};
    for (const m of ["select", "in", "gte", "lt", "order", "limit", "not", "eq"]) q[m] = () => q;
    q.then = (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
      Promise.resolve({ data: sbFalso.datos[tabla] ?? [], error: null }).then(ok, ko);
    return q;
  };
  return { supabase: { from: consulta, rpc: (...a: unknown[]) => sbFalso.rpc(...a) } };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CalendarioInstagram, ProgramarPiezaDialog } from "../index";

const AHORA = new Date("2026-11-10T10:00:00Z"); // martes, 11:00 en Madrid
const PIEZA = { id: "p1", marca: "casa-tomas", formato: "post", plantilla: "ct-tipografica", datos: { titular: "Chuleta de vaca" }, imagen_ruta: "piezas/2026-11/p1.jpg", updated_at: "2026-11-09T10:00:00Z", estado: "generada" };

function envolver(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AHORA);
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  sbFalso.datos = {};
  sbFalso.rpc = vi.fn();
});

describe("ProgramarPiezaDialog", () => {
  it("manda la hora de Madrid en UTC y, si hay otra a ±30 min, pide confirmación", async () => {
    const onHecho = vi.fn();
    const onOpenChange = vi.fn();
    sbFalso.rpc
      .mockResolvedValueOnce({ data: { ok: false, requiereConfirmacion: true, conflictos: [{ id: "x", piezaId: "p9", programadaPara: "2026-11-12T17:15:00Z" }] }, error: null })
      .mockResolvedValueOnce({ data: { ok: true, accion: "programada", conflictos: [], programacion: { id: "n1", pieza_id: "p1", programada_para: "2026-11-12T17:00:00Z" } }, error: null });
    envolver(<ProgramarPiezaDialog piezaId="p1" open onOpenChange={onOpenChange} onHecho={onHecho} />);

    const fecha = screen.getByLabelText("Día") as HTMLInputElement;
    expect(fecha.value).toBe("2026-11-11"); // por defecto, mañana a las 13:00
    fireEvent.change(fecha, { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Hora (Madrid)"), { target: { value: "18:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Programar" }));

    expect(await screen.findByText(/Ya hay otra publicación de esta marca/)).toBeInTheDocument();
    expect(screen.getByText("jue 12 nov, 18:15")).toBeInTheDocument();
    expect(sbFalso.rpc).toHaveBeenNthCalledWith(1, "instagram_programar", { p_pieza_id: "p1", p_para: "2026-11-12T17:00:00.000Z", p_confirmar_conflicto: false });

    fireEvent.click(screen.getByRole("button", { name: "Programar igualmente" }));
    await waitFor(() => expect(onHecho).toHaveBeenCalled());
    expect(sbFalso.rpc).toHaveBeenNthCalledWith(2, "instagram_programar", { p_pieza_id: "p1", p_para: "2026-11-12T17:00:00.000Z", p_confirmar_conflicto: true });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("no deja enviar con menos de 10 minutos y enseña el error del servidor", async () => {
    sbFalso.rpc.mockResolvedValueOnce({ data: null, error: { message: "La pieza no tiene imagen: genérala antes de programarla" } });
    envolver(<ProgramarPiezaDialog piezaId="p1" open onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByLabelText("Día"), { target: { value: "2026-11-10" } });
    fireEvent.change(screen.getByLabelText("Hora (Madrid)"), { target: { value: "11:05" } });
    expect(screen.getByRole("alert")).toHaveTextContent("al menos 10 minutos");
    expect(screen.getByRole("button", { name: "Programar" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Hora (Madrid)"), { target: { value: "12:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Programar" }));
    expect(await screen.findByText("La pieza no tiene imagen: genérala antes de programarla")).toBeInTheDocument();
  });

  it("al mover una programación concreta usa instagram_reprogramar", async () => {
    sbFalso.rpc.mockResolvedValueOnce({ data: { ok: true, accion: "reprogramada", conflictos: [], programacion: { id: "r1", pieza_id: "p1", programada_para: "2026-11-13T09:00:00Z" } }, error: null });
    envolver(<ProgramarPiezaDialog piezaId="p1" programacionId="r1" inicial="2026-11-13T09:00:00Z" open onOpenChange={() => undefined} />);
    expect((screen.getByLabelText("Hora (Madrid)") as HTMLInputElement).value).toBe("10:00");
    fireEvent.click(screen.getByRole("button", { name: "Mover" }));
    await waitFor(() =>
      expect(sbFalso.rpc).toHaveBeenCalledWith("instagram_reprogramar", { p_id: "r1", p_para: "2026-11-13T09:00:00.000Z", p_confirmar_conflicto: false }),
    );
  });
});

describe("CalendarioInstagram", () => {
  beforeEach(() => {
    sbFalso.datos = {
      instagram_programaciones: [
        { id: "a", pieza_id: "p1", marca: "casa-tomas", programada_para: "2026-11-12T12:30:00Z", estado: "programada", intentos: 0, ultimo_error: null, pieza: PIEZA },
        { id: "b", pieza_id: "p2", marca: "touza", programada_para: "2026-11-13T19:00:00Z", estado: "error", intentos: 3, ultimo_error: "Al token le faltan permisos", pieza: { ...PIEZA, id: "p2", marca: "touza", datos: { titular: "Vermú" } } },
      ],
      instagram_piezas: [
        { ...PIEZA, id: "p3", estado: "publicada", datos: { titular: "Arroz" }, publicada_at: "2026-11-09T08:00:00Z", permalink: "https://www.instagram.com/p/Z/" },
      ],
    };
  });

  it("pinta la semana con programadas, errores y publicadas en su día de Madrid", async () => {
    envolver(<CalendarioInstagram vistaInicial="semana" />);
    expect(screen.getByText("9–15 nov 2026")).toBeInTheDocument();
    const eventos = await screen.findAllByTestId("evento-instagram");
    expect(eventos.map((e) => e.getAttribute("data-estado"))).toEqual(["publicada", "programada", "error"]);
    const jueves = screen.getByRole("region", { name: "jue 12 nov" });
    expect(within(jueves).getByText("13:30")).toBeInTheDocument();
    expect(within(jueves).getByText("Chuleta de vaca")).toBeInTheDocument();
  });

  it("filtra por marca y cambia a la vista de mes", async () => {
    envolver(<CalendarioInstagram vistaInicial="semana" marca="touza" />);
    await waitFor(() => expect(screen.getAllByTestId("evento-instagram")).toHaveLength(1));
    fireEvent.click(screen.getByRole("radio", { name: "Mes" }));
    expect(await screen.findByText("noviembre de 2026")).toBeInTheDocument();
  });

  it("ver el error y cancelar desde el menú de la pieza", async () => {
    sbFalso.rpc.mockResolvedValue({ data: { ok: true, programacion: { id: "a", estado: "cancelada" } }, error: null });
    envolver(<CalendarioInstagram vistaInicial="semana" />);
    const [, programada, conError] = await screen.findAllByTestId("evento-instagram");

    fireEvent.keyDown(conError, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Ver qué ha pasado" }));
    // En llano arriba; el texto de Meta, plegado en «Para Oficiosos».
    expect(await screen.findByText("Instagram no nos deja publicar en esa cuenta.")).toBeInTheDocument();
    expect(screen.getByText("Al token le faltan permisos").closest("details")).not.toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    fireEvent.keyDown(programada, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Cancelar la programación" }));
    const alerta = await screen.findByRole("alertdialog");
    fireEvent.click(within(alerta).getByRole("button", { name: "Cancelar la programación" }));
    await waitFor(() => expect(sbFalso.rpc).toHaveBeenCalledWith("instagram_cancelar_programacion", { p_id: "a" }));
  });
});
