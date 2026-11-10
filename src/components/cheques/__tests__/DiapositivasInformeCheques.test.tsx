import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DiapositivasInformeCheques } from "../informe/Diapositivas";
import { construirInformeCheques, type InformeCheques } from "@/lib/informes/cheques/modelo";
import { periodoInforme } from "@/lib/informes/cheques/periodo";

const fila = (creado: string, importe: number, canal: "web" | "manual" | "cortesia" = "web", canjeado: string | null = null) => ({
  creado: `${creado}T12:00:00`, importe_eur: importe, gastos_gestion_eur: 0, stripe_fee_eur: 1, canal, estado: "pagado" as const, canjeado, caduca_el: null,
});

describe("Diapositivas del informe de cheques", () => {
  it("pinta portada, resumen, evolución, cobros, canjes, días y conclusiones", () => {
    const informe = construirInformeCheques(
      { cheques: [fila("2026-09-02", 50), fila("2026-10-03", 100), fila("2026-10-04", 50, "manual"), fila("2026-10-11", 50), fila("2026-09-10", 25, "web", "2026-10-20T20:00:00")] },
      periodoInforme("2026-10", "2026-11-10"),
    ) as InformeCheques;
    const { container } = render(<DiapositivasInformeCheques informe={informe} />);
    expect(container.querySelectorAll("[data-diapositiva]")).toHaveLength(7);
    expect(screen.getByText("Vendido en cheques")).toBeTruthy();
    expect(screen.getByText("Por dónde se vendió")).toBeTruthy();
    expect(screen.getByText("Importes más vendidos")).toBeTruthy();
    expect(screen.getByText("Qué nos dice octubre")).toBeTruthy();
  });
});
