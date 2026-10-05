/**
 * Pestaña Newsletter › Estadísticas: las tarjetas, el desglose y los porcentajes salen de la MISMA
 * cuenta y cuadran entre sí. Supabase: doble en memoria con el tope de 1.000 filas de PostgREST.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/integrations/supabase/client", async () => {
  const { crearDobleSupabase } = await import("@/lib/reservas/__tests__/dobleSupabaseLotes");
  return { supabase: crearDobleSupabase() };
});

// Recharts en jsdom no mide nada; la tendencia se prueba en lib/newsletter.
vi.mock("recharts", () => {
  const Nada = () => null;
  return {
    LineChart: Nada,
    Line: Nada,
    XAxis: Nada,
    YAxis: Nada,
    CartesianGrid: Nada,
    Tooltip: Nada,
    ResponsiveContainer: Nada,
    Legend: Nada,
  };
});

import { supabase } from "@/integrations/supabase/client";
import type { DobleSupabase } from "@/lib/reservas/__tests__/dobleSupabaseLotes";
import { EstadisticasNewsletter } from "../EstadisticasNewsletter";

const doble = supabase as unknown as DobleSupabase;

let secuencia = 0;
function fila(email_id: string, tipo_evento: string) {
  secuencia++;
  const instante = new Date(Date.UTC(2026, 9, 5, 8, 0, 0) + secuencia * 1000).toISOString();
  return {
    id: `ev-${String(secuencia).padStart(6, "0")}`,
    email_id,
    tipo_evento,
    email_destinatario: `${email_id}@example.com`,
    timestamp_evento: instante,
    created_at: instante,
    metadata: null,
  };
}

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <EstadisticasNewsletter />
    </QueryClientProvider>,
  );
}

/** Tarjeta superior por su título: su porcentaje y su línea «n de N correos». */
function tarjeta(titulo: string) {
  const el = screen.getAllByText(titulo)[0].closest(".rounded-lg") as HTMLElement;
  return within(el);
}

/** Casilla del desglose por su etiqueta: la cifra grande de encima. */
function desglose(etiqueta: string) {
  const seccion = screen.getByText("Desglose").closest(".rounded-lg") as HTMLElement;
  const casilla = within(seccion).getByText(etiqueta).parentElement as HTMLElement;
  return casilla.firstElementChild?.textContent;
}

beforeEach(() => {
  doble.reiniciar();
  secuencia = 0;
});

describe("EstadisticasNewsletter", () => {
  it("el caso del dueño (30 enviados, 30 entregados, 5 abiertos, 4 con clic) cuadra en tarjetas y desglose", async () => {
    const filas = [];
    for (let i = 0; i < 30; i++) {
      filas.push(fila(`m${i}`, "sent"), fila(`m${i}`, "delivered"));
      if (i < 5) filas.push(fila(`m${i}`, "opened"), fila(`m${i}`, "opened")); // dos aperturas
      if (i < 4) filas.push(fila(`m${i}`, "clicked"));
    }
    filas.push(fila("contact.updated:c1", "contact.updated")); // no es un correo
    doble.tablas.email_eventos = filas;

    pintar();
    await screen.findByText("Desglose");

    // Antes: «39 entregados» y «9 abiertos» en las tarjetas.
    expect(screen.queryByText(/39 entregados/)).toBeNull();
    expect(screen.queryByText(/9 abiertos/)).toBeNull();

    expect(tarjeta("Entregados").getByText("100%")).toBeInTheDocument();
    expect(tarjeta("Entregados").getByText("30 de 30 correos")).toBeInTheDocument();
    expect(tarjeta("Abiertos").getByText("17%")).toBeInTheDocument();
    expect(tarjeta("Abiertos").getByText("5 de 30 correos")).toBeInTheDocument();
    expect(tarjeta("Con clic").getByText("13%")).toBeInTheDocument();
    expect(tarjeta("Con clic").getByText("4 de 30 correos")).toBeInTheDocument();

    expect(desglose("Enviados")).toBe("30");
    expect(desglose("Entregados")).toBe("30");
    expect(desglose("Abiertos")).toBe("5");
    expect(desglose("Con clic")).toBe("4");

    // El subtítulo dice en llano qué correos cuenta.
    expect(screen.getByText(/todos los correos que envía el restaurante/i)).toBeInTheDocument();
  });

  it("con más de 1.000 eventos (tope de PostgREST) sigue contando todos los correos", async () => {
    const filas = [];
    for (let i = 0; i < 400; i++) filas.push(fila(`m${i}`, "sent"), fila(`m${i}`, "delivered"), fila(`m${i}`, "opened"));
    doble.tablas.email_eventos = filas;

    pintar();
    await screen.findByText("Desglose");
    expect(desglose("Enviados")).toBe("400");
    expect(desglose("Abiertos")).toBe("400");
    expect(tarjeta("Abiertos").getByText("100%")).toBeInTheDocument();
  });

  it("ya no muestra los últimos movimientos ni el aviso del webhook", async () => {
    doble.tablas.email_eventos = [fila("a", "sent"), fila("a", "delivered")];
    pintar();
    await screen.findByText("Desglose");
    expect(screen.queryByText(/Últimos movimientos/i)).toBeNull();
    expect(screen.queryByText(/Detalle técnico/i)).toBeNull();
    expect(screen.queryByText(/webhook/i)).toBeNull();
    expect(screen.queryByText(/a@example.com/)).toBeNull();
  });
});
