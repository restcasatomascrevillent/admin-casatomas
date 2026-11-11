/**
 * Vino ya en la carta (11/11/2026, petición del dueño: «Revisar si se suben
 * botellas de la misma pero diferente añada no salta duplicada»): distinta
 * añada no es duplicado; misma añada (o las dos sin ella), sí.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { avisoVinoDuplicado, buscarVinoDuplicado, esMismoVino } from "../vinoDuplicado";

describe("esMismoVino", () => {
  it("distinta añada en el nombre no es duplicado; la misma sí", () => {
    expect(esMismoVino({ nombre: "Pago de Carraovejas 2020" }, { nombre: "Pago de Carraovejas 2021" })).toBe(false);
    expect(esMismoVino({ nombre: "Pago de Carraovejas 2020" }, { nombre: "Pago de Carraovejas 2020" })).toBe(true);
    // Sin tildes, mayúsculas ni signos: «‑» (no separable) y «-» son lo mismo.
    expect(esMismoVino({ nombre: "PAGO DE CARRAOVEJAS 2020" }, { nombre: "Pago de Carraovejas  2020" })).toBe(true);
    expect(esMismoVino({ nombre: "Laurent‑Perrier Millésimé 2015" }, { nombre: "Laurent-Perrier Millesime 2015" })).toBe(true);
  });

  it("manda el campo «Añada que se sirve»; si está vacío, el año del nombre", () => {
    expect(esMismoVino({ nombre: "Mauro", anada: 2023 }, { nombre: "Mauro 2023", anada: "" })).toBe(true);
    expect(esMismoVino({ nombre: "Mauro", anada: 2023 }, { nombre: "Mauro", anada: "2024" })).toBe(false);
    expect(esMismoVino({ nombre: "Mauro", anada: 2023 }, { nombre: "Mauro", anada: " 2023 " })).toBe(true);
  });

  it("las dos sin añada (o NV) sí son duplicado; una con añada y otra sin ella, no", () => {
    expect(esMismoVino({ nombre: "Finca Dofí" }, { nombre: "Finca Dofí", anada: null })).toBe(true);
    expect(esMismoVino({ nombre: "Collet Rosé", sin_anada: true }, { nombre: "Collet Rosé" })).toBe(true);
    expect(esMismoVino({ nombre: "Finca Dofí" }, { nombre: "Finca Dofí 2017" })).toBe(false);
  });

  it("otro formato es otro vino", () => {
    expect(esMismoVino({ nombre: "Carraovejas 2023 (Magnum)" }, { nombre: "Carraovejas 2023" })).toBe(false);
  });
});

describe("buscarVinoDuplicado", () => {
  const carta = [
    { id: "a", nombre: "Pago de Carraovejas 2023", anada: 2023, sin_anada: false, activado: true },
    { id: "b", nombre: "Quiñón de Valmira", anada: null, sin_anada: false, activado: false },
  ];

  it("devuelve el vino igual de la carta, nunca el mismo registro", () => {
    expect(buscarVinoDuplicado({ nombre: "Pago de Carraovejas", anada: "2023" }, carta)?.id).toBe("a");
    expect(buscarVinoDuplicado({ nombre: "Pago de Carraovejas", anada: "2021" }, carta)).toBeNull();
    expect(buscarVinoDuplicado({ id: "a", nombre: "Pago de Carraovejas 2023" }, carta)).toBeNull();
    expect(buscarVinoDuplicado({ nombre: "  " }, carta)).toBeNull();
    expect(buscarVinoDuplicado({ nombre: "Pago de Carraovejas 2023" }, undefined)).toBeNull();
  });

  it("el aviso dice la añada o que tampoco la tiene", () => {
    expect(avisoVinoDuplicado(carta[0])).toBe(
      "Ya está en la carta: «Pago de Carraovejas 2023», de la misma añada (2023). Si la botella es de otra añada, cámbiala en «Añada que se sirve».",
    );
    expect(avisoVinoDuplicado(carta[1])).toBe(
      "Ya está en la carta: «Quiñón de Valmira» (desactivado), también sin añada. Si la botella tiene añada, ponla en «Añada que se sirve».",
    );
  });
});
