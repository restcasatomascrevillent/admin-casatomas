import { describe, expect, it } from "vitest";
import { detectaInfoContacto } from "../constantesBot";

describe("detectaInfoContacto", () => {
  it("vacío / null no detecta nada", () => {
    expect(detectaInfoContacto(null)).toEqual({ horario: false, contacto: false, direccion: false, completa: false });
    expect(detectaInfoContacto("")).toEqual({ horario: false, contacto: false, direccion: false, completa: false });
  });

  describe("positivos por idioma", () => {
    it("es: texto completo", () => {
      const r = detectaInfoContacto(
        "Horario: martes a jueves 09:30-23:00. Teléfono: 966 10 78 87. Dirección: Carrer Santa Maria de la Cabeza 2, Crevillent",
      );
      expect(r).toEqual({ horario: true, contacto: true, direccion: true, completa: true });
    });

    it("en: texto completo", () => {
      const r = detectaInfoContacto("We open at 9 am and close at 11pm. Call +34 966 107 887. We are on Main Street 4.");
      expect(r).toEqual({ horario: true, contacto: true, direccion: true, completa: true });
    });

    it("fr: texto completo", () => {
      const r = detectaInfoContacto("Ouvert de 9h à 23h. Écrivez-nous à info@casatomas.es. Adresse : 2 rue de la Paix.");
      expect(r).toEqual({ horario: true, contacto: true, direccion: true, completa: true });
    });

    it.each(["abrimos a las 9 am", "desde 9h", "a las 9:30", "à 09h30", "until 10 p.m.", "de 13 h a 16 h"])(
      "hora sin palabra clave: %s",
      (texto) => {
        expect(detectaInfoContacto(texto).horario).toBe(true);
      },
    );

    it("teléfono sin palabra clave (9 dígitos con separadores)", () => {
      expect(detectaInfoContacto("llama al 966.10.78.87").contacto).toBe(true);
      expect(detectaInfoContacto("llama al 966107887").contacto).toBe(true);
    });
  });

  describe("falsos positivos", () => {
    it('"rue" dentro de "true" no es dirección', () => {
      expect(detectaInfoContacto("It is true that we love wine").direccion).toBe(false);
    });

    it('"open" dentro de "opening" no es horario', () => {
      expect(detectaInfoContacto("The opening ceremony was great").horario).toBe(false);
    });

    it('"tel" dentro de "hotel" no es contacto', () => {
      expect(detectaInfoContacto("cerca del hotel").contacto).toBe(false);
    });

    it("un rango de años no es teléfono", () => {
      const r = detectaInfoContacto("Temporada 2025-2026");
      expect(r.contacto).toBe(false);
      expect(r.horario).toBe(false);
    });

    it("precios, duraciones y palabras con 'am' no son horas", () => {
      expect(detectaInfoContacto("menú a 9.30 €").horario).toBe(false);
      expect(detectaInfoContacto("se cocina 2 horas a fuego lento").horario).toBe(false);
      expect(detectaInfoContacto("para 9 amigos").horario).toBe(false);
    });

    it("sin dirección no está completa aunque haya horario y contacto", () => {
      const r = detectaInfoContacto("Horario 9:30-23:00. Teléfono 966 10 78 87");
      expect(r.horario && r.contacto).toBe(true);
      expect(r.direccion).toBe(false);
      expect(r.completa).toBe(false);
    });
  });
});
