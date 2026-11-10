/**
 * Añada en el nombre de la carta (10/11/2026, petición del dueño: «las añadas
 * de los vinos en el nombre según las fotos que hay subidas»).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { nombreConAnada } from "../parker/parker";
// Script de Node: misma regla para los scripts de datos.
import { nombreConAnada as nombreConAnadaScripts } from "../../../../scripts/parker/generar-sql-anadas.mjs";
import { PanelParker } from "../parker/PanelParker";
import { useBusquedaParker } from "../parker/useBusquedaParker";
import type { DatosVinoFoto } from "../leerVinoFoto";

describe("nombreConAnada", () => {
  it("añade la añada al final o delante del formato entre paréntesis", () => {
    expect(nombreConAnada("Aalto PS", 2022)).toBe("Aalto PS 2022");
    expect(nombreConAnada("Carraovejas (Magnum)", 2023)).toBe("Carraovejas 2023 (Magnum)");
    expect(nombreConAnada("  Pingus  ", 2023)).toBe("Pingus 2023");
    // Paréntesis que no son formato: la añada va al final, como en la carta.
    expect(nombreConAnada("Capellanía Reserva (Marqués de Murrieta)", 2019)).toBe("Capellanía Reserva (Marqués de Murrieta) 2019");
  });

  it("si ya hay año, cambia el último; sin añada no toca nada", () => {
    expect(nombreConAnada("Léon Beyer (Alsacia) 2019", 2021)).toBe("Léon Beyer (Alsacia) 2021");
    expect(nombreConAnada("Dom Pérignon Plénitude 2 (2002)", 2002)).toBe("Dom Pérignon Plénitude 2 (2002)");
    expect(nombreConAnada("L. Roederer Brut Vintage Rosé 2012 (Magnum)", 2015)).toBe("L. Roederer Brut Vintage Rosé 2015 (Magnum)");
    expect(nombreConAnada("Gran Reserva 904 (La Rioja Alta)", null)).toBe("Gran Reserva 904 (La Rioja Alta)");
    expect(nombreConAnada("Aalto", 1800)).toBe("Aalto");
    expect(nombreConAnada("", 2020)).toBe("");
  });

  it("los scripts de datos usan la misma regla que el panel", () => {
    const casos: [string, number | null][] = [
      ["Aalto PS", 2022], ["Carraovejas (Magnum)", 2023], ["Léon Beyer (Alsacia) 2019", 2021],
      ["Capellanía Reserva (Marqués de Murrieta)", 2019], ["Tomás Postigo 5º Año", 2020], ["Pingus", null], ["PSI (Magnum)", 2021],
    ];
    for (const [nombre, anada] of casos) expect(nombreConAnadaScripts(nombre, anada)).toBe(nombreConAnada(nombre, anada));
  });
});

function Prueba({ datos, valores = {} }: { datos: DatosVinoFoto | null; valores?: Record<string, unknown> }) {
  const form = useForm({ defaultValues: { nombre: "Aalto PS", denominacion_origen: "D.O. Ribera del Duero", anada: "", sin_anada: false, ...valores } });
  const buscar = vi.fn().mockResolvedValue({ resultado: null, desdeCache: false });
  const busqueda = useBusquedaParker(buscar as unknown as Parameters<typeof useBusquedaParker>[0]);
  const nombre = form.watch("nombre");
  return (
    <Form {...form}>
      <span data-testid="nombre-actual">{String(nombre)}</span>
      <PanelParker control={form.control} getValues={form.getValues} setValue={form.setValue} busqueda={busqueda} datosEtiqueta={datos} incluirConFicha onIncluirConFicha={() => {}} />
    </Form>
  );
}

const etiqueta = (p: Partial<DatosVinoFoto>): DatosVinoFoto => ({
  nombre: "Aalto PS", categoria: null, descripcion: null, ingredientes: null, denominacion_origen: null,
  ubicacion_region: null, ubicacion_pais: null, bodega: "Aalto", cuvee: "PS",
  anada: null, sin_anada: false, identificacion_ambigua: false, motivo_ambiguedad: null, puntuaciones_etiqueta: [], ...p,
});

describe("PanelParker: añada y nombre", () => {
  it("la añada leída en la etiqueta va también al nombre si no lleva año", async () => {
    render(<Prueba datos={etiqueta({ anada: 2022 })} />);
    await waitFor(() => expect(screen.getByTestId("nombre-actual")).toHaveTextContent("Aalto PS 2022"));
    expect(screen.getByLabelText("Añada que se sirve")).toHaveValue("2022");
  });

  it("si el nombre ya dice otro año no lo cambia solo: avisa y ofrece el botón", async () => {
    render(<Prueba datos={null} valores={{ nombre: "Aalto PS 2019", anada: "2022" }} />);
    expect(screen.getByText(/El nombre dice 2019 y la añada que se sirve es 2022/)).toBeInTheDocument();
    expect(screen.getByTestId("nombre-actual")).toHaveTextContent("Aalto PS 2019");
    fireEvent.click(screen.getByRole("button", { name: "Poner 2022 en el nombre" }));
    await waitFor(() => expect(screen.getByTestId("nombre-actual")).toHaveTextContent("Aalto PS 2022"));
  });

  it("añada puesta y nombre sin año: botón para añadirla", async () => {
    render(<Prueba datos={null} valores={{ nombre: "Carraovejas (Magnum)", anada: "2023" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir 2023 al nombre" }));
    await waitFor(() => expect(screen.getByTestId("nombre-actual")).toHaveTextContent("Carraovejas 2023 (Magnum)"));
  });

  it("nombre con año y añada vacía: botón para usar la del nombre", async () => {
    render(<Prueba datos={null} valores={{ nombre: "Macán 2020" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Usar 2020 (la del nombre)" }));
    await waitFor(() => expect(screen.getByLabelText("Añada que se sirve")).toHaveValue("2020"));
  });
});
