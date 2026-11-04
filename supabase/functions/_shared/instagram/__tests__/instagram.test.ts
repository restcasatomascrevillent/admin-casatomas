// @vitest-environment node
/** Piezas compartidas de las Edge Functions de Instagram: saneado, caption y errores de Meta. */
import { beforeEach, describe, expect, it } from "vitest";
import { clasificarError, mapearErrorGraph } from "../errores.ts";
import { olvidarSecretos, registrarSecreto, sanear, sanearUrl } from "../secretos.ts";
import { contarHashtags, validarCaption } from "../validacion.ts";
import { problemasVariables } from "../entorno.ts";
import { GRAPH, JWT, SECRETO_APP, TOKEN_META } from "./simulacion.ts";

beforeEach(() => olvidarSecretos());

describe("saneado de secretos", () => {
  it("tapa secretos registrados, Bearer, access_token= y JWT/EAA sueltos", () => {
    registrarSecreto(SECRETO_APP);
    const t = sanear(`fallo ${SECRETO_APP} Authorization: Bearer abc.def.ghi ${JWT} ?access_token=XYZ123 ${TOKEN_META}`);
    expect(t).not.toContain(SECRETO_APP);
    expect(t).not.toContain(JWT);
    expect(t).not.toContain("XYZ123");
    expect(t).not.toContain(TOKEN_META);
    expect(t).toContain("[OCULTO]");
    expect(sanearUrl(`${GRAPH}/debug_token?input_token=${TOKEN_META}&access_token=1|${SECRETO_APP}`)).not.toMatch(/EAAG|secretoDeLaApp/);
  });

  it("cuenta hashtags y valida el caption (2200 / 30 # / 20 @)", () => {
    expect(contarHashtags("#a #b c#d")).toBe(2);
    expect(validarCaption("x".repeat(2201)).ok).toBe(false);
    expect(validarCaption(Array.from({ length: 31 }, (_, i) => `#h${i}`).join(" ")).errores[0]).toMatch(/31 hashtags/);
    expect(validarCaption(Array.from({ length: 21 }, (_, i) => `@u${i}`).join(" ")).errores[0]).toMatch(/21 menciones/);
    expect(validarCaption("Hola #casatomas @amigo").ok).toBe(true);
  });
});

describe("mapeo de errores de Meta", () => {
  it("190 → token, 2207042 → límite de publicación, 9004 → URL no descargable", () => {
    expect(clasificarError(190, 463, "", 400)).toBe("token");
    expect(clasificarError(4, 2207042, "", 400)).toBe("limite_publicacion");
    expect(clasificarError(9004, null, "", 400)).toBe("url_no_descargable");
    const e = mapearErrorGraph({ estadoHttp: 400, cuerpo: { error: { code: 190, error_subcode: 463, message: `Token ${TOKEN_META} expired`, fbtrace_id: "Abc" } } });
    expect(e.tipo).toBe("token");
    expect(e.message).toMatch(/caducado/);
    expect(e.comoArreglarlo).toMatch(/supabase secrets set IG_ACCESS_TOKEN/);
    expect(e.comoArreglarlo).not.toMatch(/Vercel/);
    expect(e.message).not.toContain(TOKEN_META);
  });
});

describe("secretos que faltan", () => {
  it("el «cómo arreglarlo» nombra el secreto (nunca su valor) y el proyecto de Supabase", () => {
    const p = problemasVariables({ SUPABASE_URL: "https://haqmmdfdzzatdnrrcgez.supabase.co", IG_ACCESS_TOKEN: "corto" });
    expect(p.map((x) => x.variable)).toEqual(["IG_ACCESS_TOKEN", "IG_USER_ID", "META_APP_ID"]);
    expect(p[0].comoArreglarlo).toMatch(/--project-ref haqmmdfdzzatdnrrcgez/);
    expect(p[0].comoArreglarlo).not.toContain("corto");
    // Sin SUPABASE_URL reconocible: da los dos refs.
    expect(problemasVariables({})[0].comoArreglarlo).toMatch(/sfonaclosuafvlhutkon.*haqmmdfdzzatdnrrcgez/);
  });
});
