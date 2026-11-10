/**
 * Aceptar, confirmar o verificar con el día a la vista (10/11/2026, petición del dueño: «para aceptar cualquier
 * reserva o verificarla, se abre el pop-up para ver el día, lo que hay ese día y ver si se puede. Y se ven los
 * datos de la persona completos»). El diálogo enseña los datos, el aforo por servicio con sus avisos y las
 * reservas del día con esta resaltada; su botón verde hace lo mismo que hacía el de la fila.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { resumenAforoDia } from "@/lib/reservas/aforoDia";

const h = vi.hoisted(() => ({
  espacios: [] as unknown[],
  ocupacion: [] as unknown[],
  delDia: [] as unknown[],
  cierres: [] as unknown[],
  bloqueados: [] as string[],
}));

vi.mock("@/hooks/useOcupacionSalasDia", () => ({
  useOcupacionSalasDia: () => ({ data: { espacios: h.espacios, reservas: h.ocupacion, horasBase: [], cerrado: false } }),
}));
vi.mock("@/hooks/useCierresReserva", () => ({ useCierresReserva: () => ({ data: { cierres: h.cierres, esquemaPendiente: false } }) }));
vi.mock("@/hooks/useConfiguracionReservas", () => ({ useConfiguracionReservas: () => ({ data: {} }) }));
vi.mock("@/hooks/useServiciosBloqueados", () => ({
  useServiciosBloqueados: () => ({ estaBloqueado: (t: string) => h.bloqueados.includes(t) }),
}));
vi.mock("@/hooks/useReservasServicioDia", () => ({
  CLAVE_RESERVAS_SERVICIO_DIA: "reservas-servicio-dia",
  useReservasServicioDia: () => ({ data: h.delDia, isLoading: false, isError: false, refetch: vi.fn() }),
}));
vi.mock("@/hooks/useEspaciosReserva", () => ({ useEspaciosReserva: () => ({ data: h.espacios }) }));

import { DialogoAccionReserva, type ReservaDelDialogo } from "@/components/reservas/DialogoAccionReserva";

const FECHA = "2026-11-10"; // martes
const ana: ReservaDelDialogo = {
  id: "r-ana",
  nombre: "Ana López",
  telefono: "+34 600 111 222",
  email: "ana@ejemplo.com",
  fecha: FECHA,
  hora: "14:00:00",
  numero_comensales: 4,
  estado: "pendiente",
  espacio_id: "s-comedor",
  notas_cliente: "Trona para un bebé",
  canal: "web",
  importante: true,
  en_blacklist: true,
  menu_del_dia: true,
  menu_cerrado: true,
  menu_precio: 35,
};

beforeEach(() => {
  h.espacios = [{ id: "s-comedor", nombre: "Comedor", capacidad_maxima: 10 }];
  h.ocupacion = [
    { id: "r-otra", hora: "13:30:00", numero_comensales: 4, estado: "confirmada", espacio_id: "s-comedor" },
    { id: "r-ana", hora: "14:00:00", numero_comensales: 4, estado: "pendiente", espacio_id: "s-comedor" },
  ];
  h.delDia = [
    { id: "r-otra", nombre: "Otra Mesa", hora: "13:30:00", numero_comensales: 4, estado: "confirmada", espacio_id: "s-comedor", menu_del_dia: false },
    { id: "r-ana", nombre: "Ana López", hora: "14:00:00", numero_comensales: 4, estado: "pendiente", espacio_id: "s-comedor", menu_del_dia: true },
  ];
  h.cierres = [];
  h.bloqueados = [];
});

function montar(props: Partial<Parameters<typeof DialogoAccionReserva>[0]> = {}) {
  const onAccion = vi.fn().mockResolvedValue({ ok: true });
  const onEditar = vi.fn();
  const onCerrar = vi.fn();
  render(
    <DialogoAccionReserva
      reserva={ana}
      accion="aceptar"
      nombreSala="Comedor"
      onAccion={onAccion}
      onEditar={onEditar}
      onCerrar={onCerrar}
      {...props}
    />,
  );
  return { onAccion, onEditar, onCerrar, dialogo: screen.getByRole("dialog") };
}

describe("DialogoAccionReserva · los datos completos, grandes", () => {
  it("nombre, teléfono con enlace, email, día y hora, personas, sala, servicio, menú cerrado, notas, canal, importante y lista negra", () => {
    const { dialogo } = montar();
    const datos = within(dialogo).getByRole("region", { name: "Datos de la reserva" });
    expect(within(dialogo).getByRole("heading", { name: /Verificar reserva · Ana López/ })).toBeInTheDocument();
    expect(within(datos).getByRole("link", { name: "+34 600 111 222" })).toHaveAttribute("href", "tel:+34600111222");
    for (const texto of [
      "ana@ejemplo.com",
      "Martes 10 de noviembre 2026 · 14:00",
      "Comedor",
      "Menú del día",
      "Menú 35 €",
      "Trona para un bebé",
      "Está en la lista negra",
    ]) {
      expect(within(datos).getByText(texto, { exact: false }), texto).toBeInTheDocument();
    }
    expect(within(datos).getByText("Importante")).toBeInTheDocument();
    expect(within(datos).getByText("Canal")).toBeInTheDocument();
  });

  it("sin email lo dice (no se le manda correo)", () => {
    montar({ reserva: { ...ana, email: "  " } });
    expect(screen.getByText(/Sin email/)).toBeInTheDocument();
  });
});

describe("DialogoAccionReserva · el día", () => {
  it("personas frente al aforo por servicio y las reservas del día, con esta resaltada", () => {
    const { dialogo } = montar();
    expect(within(dialogo).getByTestId("aforo-comida")).toHaveTextContent("8 / 10 personas");
    expect(within(dialogo).getByText(/Cabe: el servicio está abierto/)).toBeInTheDocument();
    const hoja = within(dialogo).getByRole("region", { name: "Comida" });
    expect(hoja).toHaveTextContent("Otra Mesa");
    const propia = within(hoja).getByText("Ana López").closest("li")!;
    expect(propia).toHaveClass("bg-amber-200/50");
  });

  it("aviso claro si con esta reserva se pasa del aforo", () => {
    h.ocupacion = [...(h.ocupacion as object[]), { id: "r-grande", hora: "13:00", numero_comensales: 6, estado: "confirmada", espacio_id: "s-comedor" }];
    montar();
    expect(screen.getByRole("alert")).toHaveTextContent("Con esta reserva se pasa del aforo de la comida: 14 personas para 10.");
  });

  it("aviso si el servicio está cerrado o bloqueado", () => {
    h.cierres = [{ fecha: FECHA, turno: "comida", motivo: "calendario" }];
    h.bloqueados = ["comida"];
    montar();
    const alerta = screen.getByRole("alert");
    expect(alerta).toHaveTextContent("La comida de ese día está CERRADA.");
    expect(alerta).toHaveTextContent("BLOQUEADA");
  });
});

describe("DialogoAccionReserva · los botones", () => {
  it("el botón verde hace lo de siempre y cierra", async () => {
    const { onAccion, onCerrar } = montar();
    const boton = screen.getByRole("button", { name: "Verificar reserva" });
    expect(boton).toHaveClass("bg-emerald-600", "h-14", "text-lg");
    fireEvent.click(boton);
    expect(onAccion).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onCerrar).toHaveBeenCalled());
  });

  it("«Confirmar reserva» y «Verificar» según la acción", () => {
    montar({ accion: "confirmar" });
    expect(screen.getByRole("button", { name: "Confirmar reserva" })).toBeInTheDocument();
  });

  it("«Editar» cierra y abre el editor; «Cerrar» solo cierra", () => {
    const { onEditar, onCerrar, onAccion } = montar({ accion: "verificar" });
    expect(screen.getByRole("button", { name: "Verificar" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    expect(onEditar).toHaveBeenCalledTimes(1);
    expect(onCerrar).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onCerrar).toHaveBeenCalledTimes(2);
    expect(onAccion).not.toHaveBeenCalled();
  });

  it("sin permiso (sin manejadores) no hay acción ni «Editar»: solo mirar y cerrar", () => {
    montar({ onAccion: undefined, onEditar: undefined });
    expect(screen.queryByRole("button", { name: "Verificar reserva" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("con aire: diálogo y pie con relleno, botones separados (dueño: «ojo con los padding y los márgenes»)", () => {
    const { dialogo } = montar();
    const pie = screen.getByRole("button", { name: "Cerrar" }).parentElement!;
    expect(pie).toHaveClass("px-6", "py-5", "gap-3");
    expect(within(dialogo).getByRole("region", { name: "Datos de la reserva" }).parentElement).toHaveClass("space-y-6", "px-6", "py-6");
  });
});

describe("resumenAforoDia", () => {
  const espacios = [
    { id: "c", capacidad_maxima: 20 },
    { id: "res", capacidad_maxima: 12, caracteristicas: { privada: true } },
  ];
  it("cuenta la propia una vez, deja fuera la sala privada, los cancelados y la otra franja", () => {
    const r = resumenAforoDia({
      espacios,
      reservas: [
        { id: "a", hora: "13:00", numero_comensales: 10, estado: "confirmada", espacio_id: "c" },
        { id: "p", hora: "14:00", numero_comensales: 6, estado: "pendiente", espacio_id: null },
        { id: "x", hora: "14:00", numero_comensales: 9, estado: "cancelada", espacio_id: "c" },
        { id: "priv", hora: "14:00", numero_comensales: 12, estado: "confirmada", espacio_id: "res" },
        { id: "n", hora: "21:00", numero_comensales: 3, estado: "confirmada", espacio_id: "c" },
      ],
      propia: { id: "p", hora: "14:00", numero_comensales: 6, estado: "pendiente", espacio_id: null },
    });
    expect(r.servicios).toEqual([
      { servicio: "comida", pax: 16, aforo: 20, cerrado: false, bloqueado: false },
      { servicio: "cena", pax: 3, aforo: 20, cerrado: false, bloqueado: false },
    ]);
    expect(r.pasaAforo).toBe(false);
  });

  it("se pasa si con la propia supera el aforo; en la sala privada no", () => {
    const base = { hora: "14:00", estado: "pendiente" };
    const lleno = [{ id: "a", hora: "13:00", numero_comensales: 18, estado: "confirmada", espacio_id: "c" }];
    expect(resumenAforoDia({ espacios, reservas: lleno, propia: { ...base, id: "p", numero_comensales: 4, espacio_id: null } }).pasaAforo).toBe(true);
    expect(resumenAforoDia({ espacios, reservas: lleno, propia: { ...base, id: "p", numero_comensales: 4, espacio_id: "res" } }).pasaAforo).toBe(false);
  });
});
