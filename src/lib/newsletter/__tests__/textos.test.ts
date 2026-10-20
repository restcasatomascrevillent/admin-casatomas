import { describe, it, expect } from "vitest";
import { MENSAJE_NO_DISPONIBLE, formatoNumero, textoErrorCliente, textoSuscriptores } from "../textos";

describe("formatoNumero / textoSuscriptores", () => {
  it("agrupa los miles y respeta el singular", () => {
    expect(formatoNumero(1000)).toBe("1.000");
    expect(textoSuscriptores(1)).toBe("1 suscriptor");
    expect(textoSuscriptores(0)).toBe("0 suscriptores");
    expect(textoSuscriptores(415)).toBe("415 suscriptores");
  });
});

describe("textoErrorCliente", () => {
  it("traduce los errores técnicos a frases para el personal", () => {
    expect(textoErrorCliente("Falta configurar RESEND_MARKETING_API_KEY (clave de Resend con Full access) para enviar como Broadcast")).toBe(
      MENSAJE_NO_DISPONIBLE,
    );
    expect(textoErrorCliente("Edge Function returned a non-2xx status code")).toBe(MENSAJE_NO_DISPONIBLE);
    expect(textoErrorCliente("Failed to send a request to the Edge Function")).toBe(MENSAJE_NO_DISPONIBLE);
    expect(textoErrorCliente("No tienes permiso para esta sección")).toMatch(/No tienes permiso/);
    expect(textoErrorCliente("Hay 1200 contactos en Resend y el plan admite 1000: Resend no deja enviar Broadcasts")).toMatch(/máximo de contactos del plan \(1\.000\)/);
    expect(textoErrorCliente("Ahora mismo se está sincronizando con Resend (o enviando otro newsletter). Espera un minuto y vuelve a intentarlo.")).toMatch(/Espera un minuto/);
    expect(textoErrorCliente("No se ha enviado: x y el newsletter podría llegar a quien se ha dado de baja. Pulsa «Sincronizar con Resend»")).toMatch(/Actualizar lista de envío/);
  });

  it("deja tal cual los avisos que ya están en llano", () => {
    expect(textoErrorCliente("El título no puede superar 120 caracteres")).toBe("El título no puede superar 120 caracteres");
  });

  it("sin texto, mensaje genérico; nunca deja pasar nombres de servicios", () => {
    expect(textoErrorCliente("")).toBe(MENSAJE_NO_DISPONIBLE);
    expect(textoErrorCliente(null)).toBe(MENSAJE_NO_DISPONIBLE);
    expect(textoErrorCliente("Resend respondió 422 (validation_error): from inválido")).not.toMatch(/Resend|422/);
  });
});
