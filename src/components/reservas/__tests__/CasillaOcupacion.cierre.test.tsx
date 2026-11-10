// Etiqueta de cierre de la casilla del calendario (dueño, 2026-11-10: «si es medio día cerrado y medio
// abierto la palabra cerrado se ve cortada»). En el navegador la etiqueta se aplastaba hasta 0 px en
// las casillas de alto fijo con reservas (la columna flex la encogía contra la cifra) y la densidad
// compacta escondía la de medio servicio. jsdom no calcula layout: aquí se vigilan las clases y lo que
// se pinta; la medida real está en `tests/e2e-movil/calendario-cierres.capturas.mjs`.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CasillaOcupacion } from "../CasillaOcupacion";
import { resumirDia } from "@/lib/reservas/ocupacionCalendario";
import type { DensidadCasilla } from "@/lib/reservas/alturaCalendario";
import type { ServicioCerrado } from "../../../../supabase/functions/_shared/cierres";

const DOMINGO = "2026-11-22";
const resumen = resumirDia(
  DOMINGO,
  [
    { fecha: DOMINGO, hora: "13:30", numero_comensales: 8, estado: "confirmada", marca: "casa_tomas", espacio_id: "s1" },
    { fecha: DOMINGO, hora: "14:00", numero_comensales: 7, estado: "confirmada", marca: "casa_tomas", espacio_id: "s1" },
  ],
  100,
  { hoy: "2026-11-10", ahora: Date.parse("2026-11-10T10:00:00Z"), ventanaHoras: 48 },
);
const sinCena: ServicioCerrado[] = [{ fecha: DOMINGO, turno: "cena", origen: "semanal" }];
const todoElDia: ServicioCerrado[] = [
  { fecha: DOMINGO, turno: "comida", origen: "manual" },
  { fecha: DOMINGO, turno: "cena", origen: "manual" },
];

function pintar(cierres: ServicioCerrado[] | undefined, densidad?: DensidadCasilla, sinReservaWeb?: ServicioCerrado[]) {
  return render(
    <TooltipProvider>
      <CasillaOcupacion
        dia={new Date(2026, 10, 22)}
        fechaISO={DOMINGO}
        resumen={resumen}
        cierres={cierres}
        sinReservaWeb={sinReservaWeb}
        esPasado={false}
        esHoy={false}
        seleccionada={false}
        ventanaHoras={48}
        onSeleccionar={() => {}}
        densidad={densidad}
        fuenteComensales={densidad ? 22 : undefined}
      />
    </TooltipProvider>,
  );
}

describe("CasillaOcupacion — etiqueta de cierre", () => {
  it.each<DensidadCasilla | undefined>([undefined, "completa", "media", "compacta"])(
    "medio servicio cerrado: «Sin cena» se ve y no se puede recortar (densidad %s)",
    (densidad) => {
      pintar(sinCena, densidad);
      const etiqueta = screen.getByTestId("cierre-casilla");
      expect(etiqueta).toHaveTextContent("Sin cena");
      // Antes la compacta la escondía y todas llevaban `truncate` y podían encoger.
      expect(etiqueta.className).not.toMatch(/\bhidden\b/);
      expect(etiqueta.className).not.toMatch(/\btruncate\b/);
      expect(etiqueta.className).toMatch(/\bshrink-0\b/);
      expect(screen.getByRole("button")).toHaveAttribute("data-cierre", "cena");
    },
  );

  it("día entero cerrado: «Cerrado» en rojo, sin recorte", () => {
    pintar(todoElDia, "compacta");
    const etiqueta = screen.getByTestId("cierre-casilla");
    expect(etiqueta).toHaveTextContent("Cerrado");
    expect(etiqueta.className).toMatch(/text-destructive/);
    expect(etiqueta.className).toMatch(/\bshrink-0\b/);
  });

  it("con etiqueta, la cifra cede el alto de esa línea y «N res.» se calla (sigue en el aria-label)", () => {
    const { unmount } = pintar(undefined, "completa");
    expect(screen.getByTestId("comensales-casilla")).toHaveAttribute("data-fuente", "22");
    expect(screen.getByTestId("reservas-casilla")).toHaveTextContent("2 res.");
    unmount();

    pintar(sinCena, "completa");
    expect(screen.getByTestId("comensales-casilla")).toHaveAttribute("data-fuente", "20");
    expect(screen.queryByTestId("reservas-casilla")).toBeNull();
    expect(screen.getByRole("button").getAttribute("aria-label")).toMatch(/Sin cena para reservas/);
  });

  // Jueves de tapas (dueño, 2026-11-10: «Abierto, sin reservas web»).
  it("jueves de tapas: «Sin reservas web» discreto, sin «Cerrado» ni rayado", () => {
    const JUEVES = "2026-11-19";
    pintar(undefined, "compacta", [
      { fecha: JUEVES, turno: "comida", origen: "semanal" },
      { fecha: JUEVES, turno: "cena", origen: "semanal" },
    ]);
    const etiqueta = screen.getByTestId("cierre-casilla");
    expect(etiqueta).toHaveTextContent("Sin reservas web");
    expect(etiqueta.className).not.toMatch(/text-destructive|uppercase|\btruncate\b|\bhidden\b/);
    expect(etiqueta.className).toMatch(/\bshrink-0\b/);
    const boton = screen.getByRole("button");
    expect(boton).toHaveAttribute("data-cierre", "sin-web");
    expect(boton.className).not.toMatch(/repeating-linear-gradient/);
    expect(boton.getAttribute("aria-label")).toMatch(/Abierto, sin reservas por la web ni por teléfono/);
    expect(boton.getAttribute("aria-label")).not.toMatch(/Cerrado/);
  });

  it("si además hay un cierre de verdad, manda el cierre", () => {
    pintar(sinCena, "completa", [{ fecha: DOMINGO, turno: "comida", origen: "semanal" }]);
    expect(screen.getByTestId("cierre-casilla")).toHaveTextContent("Sin cena");
  });

  it("sin cierres no hay etiqueta", () => {
    pintar([], "completa");
    expect(screen.queryByTestId("cierre-casilla")).toBeNull();
  });
});
