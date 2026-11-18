import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DatosAuditoria } from "@/lib/informes/fuentes/auditoria";

const estado = vi.hoisted(() => ({ datos: null as unknown, mesPedido: "", descargas: [] as { nombre: string; texto: Promise<string> }[] }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/informes/fuentes/auditoria", async (original) => ({
  ...(await original<typeof import("@/lib/informes/fuentes/auditoria")>()),
  obtenerDatosAuditoria: async (mes: string) => {
    estado.mesPedido = mes;
    return estado.datos;
  },
}));
vi.mock("@/components/trafico-web/informe/fuente", () => ({ prepararFuenteInforme: () => Promise.resolve(), cssFuenteEmbebida: () => Promise.resolve(null) }));
vi.mock("@/components/trafico-web/informe/pdf", () => ({
  descargarBlob: (b: Blob, nombre: string) => estado.descargas.push({ nombre, texto: b.text() }),
  descargarPdfInforme: vi.fn(),
}));

import InformeAuditoriaGenerador from "../generadores/InformeAuditoriaGenerador";

const datos: DatosAuditoria = {
  usuarios: [
    {
      quien: "ana@staff.local", acciones: 30, dias: 2, ultima: "2026-10-20T16:30:00Z", borrados: 0, precios: 0, secciones: [],
      primera: "2026-10-13T07:00:00Z", entradas: 3,
      por_dia: [{ dia: "2026-10-13", n: 10 }, { dia: "2026-10-20", n: 20 }],
      por_hora: [{ hora: 10, n: 30 }],
      tablas: [{ tabla: "reservas", crear: 10, actualizar: 20, eliminar: 0, n: 30 }],
      servidor: [], recientes: [{ created_at: "2026-10-20T16:30:00Z", accion: "crear", tabla: "reservas", nombre: "Mesa López" }],
    },
    { quien: "luis@staff.local", acciones: 2, dias: 1, ultima: "2026-10-02T09:00:00Z", borrados: 0, precios: 0, secciones: [], entradas: 1,
      por_dia: [{ dia: "2026-10-02", n: 2 }], por_hora: [{ hora: 9, n: 2 }], tablas: [{ tabla: "Platos", crear: 0, actualizar: 2, eliminar: 0, n: 2 }], servidor: [],
      recientes: [{ created_at: "2026-10-02T09:00:00Z", accion: "actualizar", tabla: "Platos", nombre: "Arroz negro", campos: ["precio_eur"] }] },
  ],
  por_dia: [], por_hora: [], delicadas_total: 0, delicadas: [],
  sistema: [{ actor_label: "API · service_role · emails-reserva", tabla: "reservas", accion: "actualizar", n: 40 }],
  sistema_total: 40, accesos_fallidos: 0,
};

const Marco = ({ acciones, children }: { acciones: ReactNode; children: ReactNode }) => (
  <div>
    <div>{acciones}</div>
    <div data-testid="vista">{children}</div>
  </div>
);

function pintar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <InformeAuditoriaGenerador periodo={{ tipo: "mes", mes: "2026-10" }} hoy="2026-11-18" Marco={Marco} />
    </QueryClientProvider>,
  );
}

describe("Informe mensual de auditoría (diapositivas)", () => {
  it("una o varias diapositivas por persona y el sistema al final, explicado", async () => {
    estado.datos = datos;
    pintar();
    const vista = screen.getByTestId("vista");
    await waitFor(() => expect(within(vista).getAllByTestId(/^diapositiva-/).length).toBeGreaterThan(0));
    expect(estado.mesPedido).toBe("2026-10");
    // Portada, equipo, Ana (4: ficha, cuándo, qué, lo último), Luis (solo su ficha: hizo poco), sistema (resumen y procesos).
    const titulos = [...vista.querySelectorAll("section[data-diapositiva]")].map((s) => s.getAttribute("aria-label"));
    expect(titulos).toEqual([
      "Informe mensual de auditoría",
      "2 personas usaron el panel; Ana fue quien más (30 cosas)",
      "Ana hizo 30 cosas en 2 días, sobre todo en Reservas",
      "Ana trabaja sobre todo por la mañana y los martes",
      "Lo que más toca Ana: Reservas",
      "Lo último que hizo Ana",
      "Luis hizo 2 cosas en 1 día, sobre todo en Platos",
      "Además, el sistema hizo 40 cosas solo",
      "Qué es cada proceso",
    ]);
    // Sin gráfico global por días: cada persona tiene su calendario.
    expect(vista.querySelectorAll("[data-dia='2026-10-20']")).toHaveLength(1);
    expect(within(vista).getAllByText("Correos de las reservas")).toHaveLength(2); // en el resumen del sistema y en su tarjeta
    expect(within(vista).getByText(/Envía los correos de las reservas/)).toBeInTheDocument();
    // La ficha de quien hizo poco enseña también lo que hizo.
    expect(within(vista).getByText("Cambió un plato «Arroz negro» (precio)")).toBeInTheDocument();
    expect(within(vista).getAllByText("Nada delicado")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Descargar CSV" }));
    expect(estado.descargas[0].nombre).toBe("informe-informe-mensual-de-auditoria-2026-10.csv");
    expect(await estado.descargas[0].texto).toContain("ana@staff.local;Reservas;10;20;0;30");
  });

  it("sin nada en el mes: lo dice", async () => {
    estado.datos = { ...datos, usuarios: [], sistema: [], sistema_total: 0 };
    pintar();
    expect(await screen.findByText("No hay datos para este informe")).toBeInTheDocument();
    expect(screen.getByText(/No hay nada en el registro de octubre de 2026/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar CSV" })).toBeDisabled();
  });
});
