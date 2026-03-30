/**
 * Tests para src/schemas/carta.ts
 *
 * Estos son tests puramente unitarios: Zod schemas + helper functions.
 * No requieren mocks. Son los tests más baratos y de mayor confianza del proyecto.
 *
 * Cubre:
 * - platoSchema: validación correcta e incorrecta
 * - bebidaSchema
 * - vinoSchema
 * - coctelSchema (con refines custom)
 * - validateForm helper
 * - validateField helper
 */
import { describe, it, expect } from "vitest";
import {
  platoSchema,
  bebidaSchema,
  vinoSchema,
  coctelSchema,
  validateForm,
  validateField,
} from "@/schemas/carta";

// ─── platoSchema ──────────────────────────────────────────────────────────────

describe("platoSchema", () => {
  const validPlato = {
    nombre: "Chuletón de buey",
    categoria: "carnes",
    precio_eur: 38.5,
  };

  it("acepta un plato mínimo válido", () => {
    const result = platoSchema.safeParse(validPlato);
    expect(result.success).toBe(true);
  });

  it("acepta plato con todos los campos opcionales", () => {
    const result = platoSchema.safeParse({
      ...validPlato,
      descripcion: "Magnífico corte madurado 30 días",
      ingredientes: "ternera, sal, aceite",
      unidad: "por persona",
      alergenos_oficiales: ["gluten", "lacteos"],
      alergenos_notas: "Puede contener trazas",
      imagen_url: "https://example.com/chuleton.jpg",
      orden: 3,
    });
    expect(result.success).toBe(true);
  });

  it("falla si nombre está vacío", () => {
    const result = platoSchema.safeParse({ ...validPlato, nombre: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.nombre).toBeDefined();
    }
  });

  it("falla si nombre supera 200 caracteres", () => {
    const result = platoSchema.safeParse({
      ...validPlato,
      nombre: "A".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("falla si precio es 0 o negativo", () => {
    expect(platoSchema.safeParse({ ...validPlato, precio_eur: 0 }).success).toBe(false);
    expect(platoSchema.safeParse({ ...validPlato, precio_eur: -5 }).success).toBe(false);
  });

  it("falla si precio supera 9999", () => {
    const result = platoSchema.safeParse({ ...validPlato, precio_eur: 10000 });
    expect(result.success).toBe(false);
  });

  it("falla si imagen_url no es URL válida", () => {
    const result = platoSchema.safeParse({
      ...validPlato,
      imagen_url: "no-es-una-url",
    });
    expect(result.success).toBe(false);
  });

  it("acepta imagen_url vacía (campo opcional)", () => {
    const result = platoSchema.safeParse({ ...validPlato, imagen_url: "" });
    expect(result.success).toBe(true);
  });

  it("falla si orden es negativo", () => {
    const result = platoSchema.safeParse({ ...validPlato, orden: -1 });
    expect(result.success).toBe(false);
  });

  it("falla si orden no es entero", () => {
    const result = platoSchema.safeParse({ ...validPlato, orden: 1.5 });
    expect(result.success).toBe(false);
  });

  it("alergenos_oficiales tiene default [] si no se provee", () => {
    const result = platoSchema.safeParse(validPlato);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alergenos_oficiales).toEqual([]);
    }
  });

  it("falla si categoría está vacía", () => {
    const result = platoSchema.safeParse({ ...validPlato, categoria: "" });
    expect(result.success).toBe(false);
  });
});

// ─── bebidaSchema ─────────────────────────────────────────────────────────────

describe("bebidaSchema", () => {
  const validBebida = {
    nombre: "Agua mineral",
    categoria: "aguas",
    precio_eur: 2.5,
  };

  it("acepta una bebida mínima válida", () => {
    expect(bebidaSchema.safeParse(validBebida).success).toBe(true);
  });

  it("falla si precio es 0", () => {
    expect(bebidaSchema.safeParse({ ...validBebida, precio_eur: 0 }).success).toBe(false);
  });

  it("acepta campo tamaño opcional", () => {
    expect(
      bebidaSchema.safeParse({ ...validBebida, tamano: "33cl" }).success
    ).toBe(true);
  });

  it("falla si tamaño supera 50 caracteres", () => {
    expect(
      bebidaSchema.safeParse({ ...validBebida, tamano: "X".repeat(51) }).success
    ).toBe(false);
  });
});

// ─── vinoSchema ───────────────────────────────────────────────────────────────

describe("vinoSchema", () => {
  const validVino = {
    nombre: "Rioja Reserva 2018",
    categoria: "tintos",
    precio_eur: 28,
  };

  it("acepta un vino mínimo válido", () => {
    expect(vinoSchema.safeParse(validVino).success).toBe(true);
  });

  it("acepta campos de ubicación opcionales", () => {
    expect(
      vinoSchema.safeParse({
        ...validVino,
        ubicacion_pais: "España",
        ubicacion_region: "La Rioja",
        denominacion_origen: "DOCa Rioja",
      }).success
    ).toBe(true);
  });

  it("falla si nombre está vacío", () => {
    expect(vinoSchema.safeParse({ ...validVino, nombre: "" }).success).toBe(false);
  });

  it("alergenos_oficiales tiene default []", () => {
    const result = vinoSchema.safeParse(validVino);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.alergenos_oficiales).toEqual([]);
    }
  });
});

// ─── coctelSchema ─────────────────────────────────────────────────────────────

describe("coctelSchema", () => {
  const validCoctel = {
    nombre: "Negroni",
    categoria: "clasicos",
    precio_eur: 12,
    base: "ginebra",
    ingredientes: "ginebra, campari, vermut rojo",
  };

  it("acepta un cóctel válido", () => {
    expect(coctelSchema.safeParse(validCoctel).success).toBe(true);
  });

  it("acepta categorías válidas: autor, clasicos, sin-alcohol", () => {
    const categorias = ["autor", "clasicos", "sin-alcohol"] as const;
    for (const categoria of categorias) {
      expect(
        coctelSchema.safeParse({ ...validCoctel, categoria }).success
      ).toBe(true);
    }
  });

  it("rechaza categoría inválida", () => {
    expect(
      coctelSchema.safeParse({ ...validCoctel, categoria: "especiales" }).success
    ).toBe(false);
  });

  it("acepta bases válidas", () => {
    const bases = ["ginebra", "vodka", "ron", "tequila", "aperol", "sin-alcohol", "all"] as const;
    for (const base of bases) {
      expect(
        coctelSchema.safeParse({ ...validCoctel, base }).success
      ).toBe(true);
    }
  });

  it("rechaza base inválida", () => {
    expect(
      coctelSchema.safeParse({ ...validCoctel, base: "whisky" }).success
    ).toBe(false);
  });

  it("falla si ingredientes están vacíos", () => {
    expect(
      coctelSchema.safeParse({ ...validCoctel, ingredientes: "" }).success
    ).toBe(false);
  });

  it("falla si ingredientes superan 500 caracteres", () => {
    expect(
      coctelSchema.safeParse({ ...validCoctel, ingredientes: "A".repeat(501) }).success
    ).toBe(false);
  });
});

// ─── validateForm helper ──────────────────────────────────────────────────────

describe("validateForm", () => {
  it("devuelve success=true con datos válidos", () => {
    const result = validateForm(platoSchema, {
      nombre: "Ensalada",
      categoria: "entrantes",
      precio_eur: 9,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.nombre).toBe("Ensalada");
    }
  });

  it("devuelve success=false con errores formateados por campo", () => {
    const result = validateForm(platoSchema, {
      nombre: "",
      categoria: "",
      precio_eur: -1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.nombre).toBeDefined();
      expect(result.errors.categoria).toBeDefined();
      expect(result.errors.precio_eur).toBeDefined();
    }
  });

  it("las claves de errors corresponden a los nombres de campo del schema", () => {
    const result = validateForm(platoSchema, { nombre: "", categoria: "ok", precio_eur: 5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Object.keys(result.errors)).toContain("nombre");
    }
  });
});

// ─── validateField helper ─────────────────────────────────────────────────────

describe("validateField", () => {
  it("devuelve null para un campo válido", () => {
    const error = validateField(platoSchema, "nombre", "Pulpo a la gallega");
    expect(error).toBeNull();
  });

  it("devuelve mensaje de error para un campo inválido", () => {
    const error = validateField(platoSchema, "nombre", "");
    expect(typeof error).toBe("string");
    expect(error!.length).toBeGreaterThan(0);
  });

  it("devuelve null para un campo que no existe en el schema", () => {
    const error = validateField(platoSchema, "campoInexistente", "valor");
    expect(error).toBeNull();
  });

  it("detecta precio negativo", () => {
    const error = validateField(platoSchema, "precio_eur", -5);
    expect(error).not.toBeNull();
  });

  it("acepta precio válido", () => {
    const error = validateField(platoSchema, "precio_eur", 15.5);
    expect(error).toBeNull();
  });
});
