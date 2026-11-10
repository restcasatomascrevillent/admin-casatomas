// @vitest-environment node
/**
 * Los colores de las plantillas de Instagram (src/lib/instagram/tokens.ts) no
 * pueden separarse del sistema de marca oficial (instagram-studio:
 * propuesta/marca-base/tokens/colors.css, copiado en
 * src/lib/instagram/marca-base/colors.css). Así no vuelve a pasar lo del oro
 * #8e6725, que no era el de la web ni el de los reels.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARCAS, ORO_CASA_TOMAS } from "../tokens";

const css = readFileSync(path.resolve(__dirname, "../marca-base/colors.css"), "utf8");

/** Variables --x:#hex del bloque :root de la copia oficial. */
function variables(): Map<string, string> {
  const raiz = /:root\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  const m = new Map<string, string>();
  for (const [, nombre, hex] of raiz.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\b/g)) m.set(nombre, hex.toLowerCase());
  return m;
}

/** Color del panel → variable oficial de marca-base. */
const EQUIVALENCIAS: Array<[keyof typeof MARCAS, string, string]> = [
  ["casa-tomas", "pizarra", "ct-slate"],
  ["casa-tomas", "oro", "ct-gold"],
  ["casa-tomas", "gris-medio", "ct-mid-gray"],
  ["casa-tomas", "piedra", "ct-stone"],
  ["casa-tomas", "piedra-clara", "ct-sand-200"],
  ["casa-tomas", "blanco", "ct-white"],
  ["casa-tomas", "pizarra-oscura", "ct-slate-900"],
  ["casa-tomas", "arena", "ct-sand-50"],
  ["touza", "negro", "tz-black"],
  ["touza", "crema", "tz-cream"],
  ["touza", "oro", "tz-gold"],
  ["touza", "oro-claro", "tz-gold-light"],
  ["touza", "oro-oscuro", "tz-gold-dark"],
];

describe("tokens del panel = tokens oficiales de marca-base", () => {
  const oficiales = variables();

  it("la copia oficial se lee (si cambia de formato, el test lo dice)", () => {
    expect(oficiales.size).toBeGreaterThan(10);
  });

  it.each(EQUIVALENCIAS)("%s · %s = --%s", (marca, color, variable) => {
    const oficial = oficiales.get(variable);
    expect(oficial, `falta --${variable} en marca-base/colors.css`).toBeDefined();
    const panel = (MARCAS[marca].colores as Record<string, string>)[color].toLowerCase();
    expect(panel, `${marca} «${color}» es ${panel} y el oficial (--${variable}) es ${oficial}: cambia src/lib/instagram/tokens.ts`).toBe(oficial);
  });

  it("oro de Casa Tomás: el oficial para acentos y #845f1f solo para texto pequeño", () => {
    expect(ORO_CASA_TOMAS.acento).toBe(oficiales.get("ct-gold"));
    expect(MARCAS["casa-tomas"].roles.acento).toBe("oro");
    expect(MARCAS["casa-tomas"].roles["boton-fondo"]).toBe("oro");
    expect(MARCAS["casa-tomas"].roles["acento-texto"]).toBe("oro-texto");
    expect(MARCAS["casa-tomas"].colores["oro-texto"]).toBe("#845f1f");
  });
});
