/**
 * _shared/whatsapp-tarifas.ts: coste del mes de los WhatsApp registrados con la
 * tarifa de Meta para España (por mensaje entregado).
 */
import { describe, expect, it } from "vitest";
import { TARIFA_WHATSAPP_ESPANA, costeWhatsAppMes, precioTexto, type MensajeWhatsAppRegistrado } from "../whatsapp-tarifas";

const fila = (m: Partial<MensajeWhatsAppRegistrado>): MensajeWhatsAppRegistrado => ({ categoria: "utility", estado: "entregado", ...m });

describe("costeWhatsAppMes", () => {
  it("sin mensajes, 0 €", () => {
    expect(costeWhatsAppMes([])).toMatchObject({ mensajes: 0, importe: 0, todoConfirmadoPorMeta: true });
  });

  it("cada plantilla de utilidad entregada cuesta la tarifa de utility; las fallidas no se cobran", () => {
    const r = costeWhatsAppMes([
      fila({ tipo: "confirmada" }),
      fila({ tipo: "resena", estado: "leido" }),
      fila({ tipo: "resena", estado: "fallido" }),
      fila({ tipo: "propuesta", estado: "error" }),
      fila({ tipo: "propuesta", estado: "enviando" }),
    ]);
    expect(r.mensajes).toBe(2);
    expect(r.fallidos).toBe(2);
    expect(r.resenas).toBe(1);
    expect(r.cobrados.utility).toBe(2);
    expect(r.importe).toBeCloseTo(2 * TARIFA_WHATSAPP_ESPANA.precios.utility, 6);
    expect(r.todoConfirmadoPorMeta).toBe(false); // sin dato del webhook: estimado
  });

  it("manda lo que dice Meta: una plantilla cobrada como marketing va a precio de marketing; la gratuita, a 0", () => {
    const r = costeWhatsAppMes([
      fila({ facturable: true, categoria_cobrada: "marketing" }),
      fila({ facturable: true, categoria_cobrada: "utility" }),
      fila({ facturable: false, categoria_cobrada: "utility" }),
    ]);
    expect(r.porCategoria).toMatchObject({ marketing: 1, utility: 2 });
    expect(r.cobrados).toMatchObject({ marketing: 1, utility: 1 });
    expect(r.importe).toBeCloseTo(0.0585 + 0.0166, 6);
    expect(r.todoConfirmadoPorMeta).toBe(true);
  });

  it("los mensajes de servicio: 1.000 gratis al mes, después a tarifa", () => {
    const servicio = (n: number, extra: Partial<MensajeWhatsAppRegistrado> = {}) =>
      Array.from({ length: n }, () => fila({ categoria: "service", estado: "enviado", ...extra }));
    expect(costeWhatsAppMes(servicio(1000)).importe).toBe(0);
    const r = costeWhatsAppMes(servicio(1003));
    expect(r.cobrados.service).toBe(3);
    expect(r.importe).toBeCloseTo(3 * TARIFA_WHATSAPP_ESPANA.precios.service, 6);
    // Con el dato de Meta, el gratuito no cuenta como cobrado.
    expect(costeWhatsAppMes(servicio(5, { facturable: false })).importe).toBe(0);
  });

  it("una 'enviado' sin confirmación de entrega se cuenta (si no hay webhook, no llegaría nunca)", () => {
    expect(costeWhatsAppMes([fila({ estado: "enviado" })]).cobrados.utility).toBe(1);
  });

  it("precioTexto", () => {
    expect(precioTexto(0.0166)).toBe("0,0166 €");
  });
});
