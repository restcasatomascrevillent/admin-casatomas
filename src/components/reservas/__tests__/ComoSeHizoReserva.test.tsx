/**
 * «Cómo se hizo la reserva»: sección de la ficha con hora de creación, canal,
 * tiempo en el formulario, dispositivo e historial (auditoría).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ComoSeHizoReserva } from "../ComoSeHizoReserva";
import { camposCambiados, formatearDuracion, leerOrigen } from "@/lib/reservas/origenReserva";

const mocks = vi.hoisted(() => ({
  historial: { data: [] as unknown[], error: null as unknown },
  consultas: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (tabla: string) => {
      mocks.consultas.push(tabla);
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.order = () => b;
      b.limit = () => Promise.resolve(mocks.historial);
      return b;
    },
  },
}));

const pintar = (reserva: Parameters<typeof ComoSeHizoReserva>[0]["reserva"], abierta = true) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ComoSeHizoReserva reserva={reserva} abiertaInicial={abierta} />
    </QueryClientProvider>,
  );

const ORIGEN_WEB = {
  v: 1,
  cliente: {
    formulario_abierto_at: "2026-11-10T17:55:00.000Z",
    primer_contacto_at: "2026-11-10T17:56:00.000Z",
    enviado_at: "2026-11-10T17:58:35.000Z",
    duracion_segundos: 155,
    campos_cambiados: ["fecha", "hora"],
    consultas_disponibilidad: 2,
    consultas_sin_hueco: 1,
    intentos_fallidos: 1,
    idioma: "en",
    pagina_entrada: "/en/carta",
    pagina_formulario: "/en/reservas",
    referente: "instagram.com",
    utm_source: "instagram",
    pantalla_ancho: 390,
    pantalla_alto: 844,
  },
  servidor: {
    recibido_at: "2026-11-10T17:58:36.000Z",
    user_agent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Safari/604.1",
    dispositivo: "movil",
    navegador: "Safari",
    sistema: "iOS",
    procedencia: { origen_tipo: "red_social", origen_detalle: "instagram.com", campana: null },
  },
};

beforeEach(() => {
  mocks.historial = { data: [], error: null };
  mocks.consultas = [];
});

describe("formatearDuracion / leerOrigen", () => {
  it("formatea como lo lee el dueño", () => {
    expect(formatearDuracion(155)).toBe("2 min 35 s");
    expect(formatearDuracion(40)).toBe("40 s");
    expect(formatearDuracion(120)).toBe("2 min");
    expect(formatearDuracion(3725)).toBe("1 h 2 min");
    expect(formatearDuracion(null)).toBeNull();
  });
  it("tolera origen ausente o raro", () => {
    expect(leerOrigen(null)).toBeNull();
    expect(leerOrigen("x")).toBeNull();
    expect(leerOrigen({ v: 1 })?.cliente).toBeNull();
  });
  it("campos cambiados de una entrada de auditoría, sin updated_at", () => {
    expect(camposCambiados({ antes: { hora: "20:00", updated_at: 1 }, despues: { hora: "21:00", updated_at: 2 } })).toEqual(["hora"]);
  });
});

describe("ComoSeHizoReserva", () => {
  it("plegada no consulta la auditoría", () => {
    pintar({ id: "r1", canal: "web", origen: ORIGEN_WEB }, false);
    expect(screen.getByRole("button", { name: /cómo se hizo la reserva/i })).toHaveAttribute("aria-expanded", "false");
    expect(mocks.consultas).toEqual([]);
  });

  it("reserva web: duración, dispositivo, entrada, procedencia e intentos", async () => {
    pintar({ id: "r1", canal: "web", created_at: "2026-11-10T17:58:36.000Z", email_verificado_at: "2026-11-10T18:10:00.000Z", origen: ORIGEN_WEB });
    expect(screen.getByText("2 min 35 s")).toBeInTheDocument();
    expect(screen.getByText(/Móvil · Safari · iOS · pantalla 390 × 844/)).toBeInTheDocument();
    expect(screen.getByText("/en/carta")).toBeInTheDocument();
    expect(screen.getByText(/Red social · instagram.com/)).toBeInTheDocument();
    expect(screen.getByText(/^2 \(1 sin hueco/)).toBeInTheDocument();
    expect(screen.getByText("Inglés")).toBeInTheDocument();
    expect(screen.getByText("Email verificado")).toBeInTheDocument();
    expect(await screen.findByText(/Sin cambios registrados/)).toBeInTheDocument();
  });

  it("reserva del panel sin origen: canal, quién la apuntó e historial", async () => {
    mocks.historial = {
      data: [
        { id: "a1", created_at: "2026-11-09T10:00:00Z", accion: "crear", actor_label: "Ana", detalles: {} },
        { id: "a2", created_at: "2026-11-09T11:00:00Z", accion: "actualizar", actor_label: "Luis", detalles: { antes: { hora: "20:00" }, despues: { hora: "21:00" } } },
      ],
      error: null,
    };
    pintar({ id: "r2", canal: "manual", created_at: "2026-11-09T10:00:00Z", origen: null });
    expect(await screen.findByText(/apuntada por Ana/)).toBeInTheDocument();
    expect(screen.getByText(/Modificada por Luis: Hora/)).toBeInTheDocument();
    expect(screen.queryByText("Rellenando el formulario")).toBeNull();
  });

  it("sin permiso de auditoría lo dice en vez de fallar", async () => {
    mocks.historial = { data: null as unknown as unknown[], error: { message: "permission denied" } };
    pintar({ id: "r3", canal: "telefono", origen: null });
    expect(await screen.findByText(/solo lo ve Super Admin/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /cómo se hizo la reserva/i }));
    expect(screen.queryByText("Historial de cambios")).toBeNull();
  });
});
