/**
 * stripe-estado-cuenta (pestaña Cheques › Stripe): desde el 10/11/2026 solo con «Editar» en
 * Cheques (o super admin, que can_edit_section ya deja pasar). La función es un Deno.serve sin
 * piezas sueltas, así que se comprueba el código fuente: pregunta can_edit_section('cheques') y
 * nunca can_read_section, y sin permiso responde 403 antes de tocar la clave de Stripe.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const fuente = readFileSync("supabase/functions/stripe-estado-cuenta/index.ts", "utf8");

describe("stripe-estado-cuenta · permiso", () => {
  it("pide «Editar» en Cheques (can_edit_section), no «Ver»", () => {
    expect(fuente).toMatch(/rpc\("can_edit_section", \{ _section: "cheques" \}\)/);
    expect(fuente).not.toMatch(/can_read_section/);
  });

  it("sin permiso corta con 403 antes de leer STRIPE_SECRET_KEY", () => {
    const corte = fuente.indexOf("403");
    expect(corte).toBeGreaterThan(-1);
    expect(corte).toBeLessThan(fuente.indexOf('Deno.env.get("STRIPE_SECRET_KEY")'));
  });
});
