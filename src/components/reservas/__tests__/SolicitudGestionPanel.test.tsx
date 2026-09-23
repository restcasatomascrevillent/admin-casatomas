/**
 * "Registrar que aceptó por teléfono" (SolicitudGestionPanel): teléfono y
 * email son obligatorios (decisión del dueño 2026-09-23) y se piden en el
 * propio paso si la solicitud no los trae.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { format, addDays } from "date-fns";

vi.mock("sonner");
vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: undefined, horasBase: [] }),
  CLAVE_OCUPACION_SALAS_DIA: "ocupacion-salas-dia",
}));
vi.mock("@/components/reservas/GestionSolicitudes", () => ({ SolicitudCard: () => null }));
vi.mock("@/components/reservas/OcupacionSalas", () => ({ OcupacionSalas: () => null }));

import { SolicitudGestionPanel } from "@/components/reservas/SolicitudGestionPanel";
import type { SolicitudPendiente } from "@/hooks/useSolicitudesPendientes";
import { MENSAJES_CONTACTO } from "@/lib/reservas/altaPanel";

const manana = format(addDays(new Date(), 1), "yyyy-MM-dd");

const solicitud = (extra: Partial<SolicitudPendiente> = {}): SolicitudPendiente => ({
  id: "sol-1",
  nombre: "Ana",
  telefono: "612345678",
  email: null,
  fecha_solicitada: manana,
  hora_solicitada: "21:00",
  numero_comensales: 4,
  notas_cliente: null,
  motivo_rechazo: "grupo_grande",
  descripcion_rechazo: null,
  estado: "pendiente",
  notas_internas: null,
  created_at: null,
  updated_at: null,
  espacio_propuesto_id: null,
  propuesta_estado: "borrador",
  ...extra,
});

function montar(s: SolicitudPendiente) {
  const onAceptarTelefono = vi.fn().mockResolvedValue({ ok: true, reserva_id: "res-1", estado: "verificada" });
  render(
    <SolicitudGestionPanel
      solicitud={s}
      onUpdateEstado={vi.fn().mockResolvedValue(true)}
      onUpdateNotas={vi.fn().mockResolvedValue(true)}
      onGuardarPropuesta={vi.fn().mockResolvedValue(true)}
      onAceptarTelefono={onAceptarTelefono}
    />,
  );
  return { onAceptarTelefono };
}

describe("SolicitudGestionPanel · aceptó por teléfono", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin email no crea la reserva y lo pide; con email la crea con el contacto normalizado", async () => {
    const { onAceptarTelefono } = montar(solicitud());

    fireEvent.click(screen.getByRole("button", { name: /Registrar que aceptó por teléfono/ }));
    expect(await screen.findByText(/correo para que confirme su reserva/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Crear reserva" }));
    expect(await screen.findByText(MENSAJES_CONTACTO.emailObligatorio)).toBeInTheDocument();
    expect(onAceptarTelefono).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear reserva" }));

    await waitFor(() =>
      expect(onAceptarTelefono).toHaveBeenCalledWith("sol-1", {
        telefono: "+34612345678",
        email: "ana@example.com",
      }),
    );
  });

  it("teléfono borrado: error de teléfono obligatorio", async () => {
    const { onAceptarTelefono } = montar(solicitud({ email: "ana@example.com" }));

    fireEvent.click(screen.getByRole("button", { name: /Registrar que aceptó por teléfono/ }));
    fireEvent.change(await screen.findByLabelText("Teléfono"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Crear reserva" }));

    expect(await screen.findByText(MENSAJES_CONTACTO.telefonoObligatorio)).toBeInTheDocument();
    expect(onAceptarTelefono).not.toHaveBeenCalled();
  });
});
