// @vitest-environment node
/** Piezas compartidas de las Edge Functions de Instagram: saneado, caption y errores de Meta. */
import { beforeEach, describe, expect, it } from "vitest";
import { clasificarError, mapearErrorGraph } from "../errores.ts";
import { olvidarSecretos, registrarSecreto, sanear, sanearUrl } from "../secretos.ts";
import { contarHashtags, validarCaption } from "../validacion.ts";
import { cuentasDistintas, entornoInstagram, leerConfigMetaMarca, problemasDeMarca, problemasVariables, REF_DEMO, REF_PRODUCCION } from "../entorno.ts";
import { validarAltText } from "../validacion.ts";
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
    const p = problemasVariables({ SUPABASE_URL: "https://sfonaclosuafvlhutkon.supabase.co", IG_ACCESS_TOKEN: "corto" });
    expect(p.map((x) => x.variable)).toEqual(["IG_ACCESS_TOKEN", "IG_USER_ID", "META_APP_ID"]);
    expect(p[0].comoArreglarlo).toMatch(/--project-ref sfonaclosuafvlhutkon/);
    expect(p[0].comoArreglarlo).not.toContain("corto");
    // Sin SUPABASE_URL reconocible: da los dos refs.
    expect(problemasVariables({})[0].comoArreglarlo).toMatch(/sfonaclosuafvlhutkon.*haqmmdfdzzatdnrrcgez/);
  });
});

describe("cuenta por marca (secretos opcionales)", () => {
  const BASE = { INSTAGRAM_ENTORNO: "demo", IG_ACCESS_TOKEN: TOKEN_META, IG_USER_ID: "17841400000000001", META_APP_ID: "1234567890" };
  it("sin secretos de marca, las dos marcas caen en la cuenta general (como hasta ahora)", () => {
    for (const marca of ["casa-tomas", "touza"] as const) {
      const r = leerConfigMetaMarca(BASE, marca);
      expect(r.ok && r.config).toMatchObject({ igUserId: "17841400000000001", token: TOKEN_META, origen: { propia: false, variableIgUserId: "IG_USER_ID", variableToken: "IG_ACCESS_TOKEN" } });
    }
    expect(cuentasDistintas(BASE)).toHaveLength(1);
    expect(cuentasDistintas(BASE)[0].marcas).toEqual(["casa-tomas", "touza"]);
  });

  it("con IG_USER_ID_TOUZA (y su token opcional) Touza usa su cuenta; Casa Tomás sigue en la general", () => {
    const env = { ...BASE, IG_USER_ID_TOUZA: "17841400000000077", IG_ACCESS_TOKEN_TOUZA: "EAAGtokenPropioDeTouza0000000000001" };
    const t = leerConfigMetaMarca(env, "touza");
    expect(t.ok && t.config).toMatchObject({ igUserId: "17841400000000077", token: "EAAGtokenPropioDeTouza0000000000001", origen: { propia: true } });
    const c = leerConfigMetaMarca(env, "casa-tomas");
    expect(c.ok && c.config.igUserId).toBe("17841400000000001");
    expect(cuentasDistintas(env)).toHaveLength(2);
  });

  it("un secreto de marca mal escrito solo afecta a esa marca", () => {
    const env = { ...BASE, IG_USER_ID_TOUZA: "@touza" };
    expect(problemasVariables(env).map((p) => p.variable)).toEqual(["IG_USER_ID_TOUZA"]);
    expect(problemasDeMarca(env, "touza").map((p) => p.variable)).toEqual(["IG_USER_ID_TOUZA"]);
    expect(problemasDeMarca(env, "casa-tomas")).toEqual([]);
    expect(leerConfigMetaMarca(env, "touza").ok).toBe(false);
  });

  it("si la marca tiene su ID y su token, no necesita los generales", () => {
    const env = { INSTAGRAM_ENTORNO: "demo", META_APP_ID: "1234567890", IG_USER_ID_TOUZA: "17841400000000077", IG_ACCESS_TOKEN_TOUZA: "EAAGtokenPropioDeTouza0000000000001" };
    expect(leerConfigMetaMarca(env, "touza").ok).toBe(true);
    expect(leerConfigMetaMarca(env, "casa-tomas").ok).toBe(false);
  });
});

describe("producción: cada marca con su cuenta, sin caer en la general (A3)", () => {
  const TOKEN_TOUZA = "EAAGtokenPropioDeTouza0000000000001";
  const GENERAL = { IG_ACCESS_TOKEN: TOKEN_META, IG_USER_ID: "17841400000000001", META_APP_ID: "1234567890" };
  const PROD = { ...GENERAL, SUPABASE_URL: `https://${REF_PRODUCCION}.supabase.co` };

  it("qué es producción: el proyecto de producción siempre; la demo, no; cualquier otro, sí (falla cerrado)", () => {
    expect(entornoInstagram(PROD).entorno).toBe("produccion");
    expect(entornoInstagram({ ...PROD, INSTAGRAM_ENTORNO: "demo" }).entorno).toBe("produccion");
    expect(entornoInstagram({ SUPABASE_URL: `https://${REF_DEMO}.supabase.co` }).entorno).toBe("demo");
    expect(entornoInstagram({ SUPABASE_URL: `https://${REF_DEMO}.supabase.co`, INSTAGRAM_ENTORNO: "produccion" }).entorno).toBe("produccion");
    expect(entornoInstagram({ SUPABASE_URL: "https://otro.supabase.co" }).entorno).toBe("produccion");
    expect(entornoInstagram({}).entorno).toBe("produccion");
    expect(entornoInstagram({ SUPABASE_URL: "https://otro.supabase.co", INSTAGRAM_ENTORNO: "demo" }).entorno).toBe("demo");
  });

  it("sin IG_USER_ID_TOUZA, Touza NO publica en la cuenta general (ni en la de Casa Tomás)", () => {
    const env = { ...PROD, IG_USER_ID_CASA_TOMAS: "17841400000000001", IG_ACCESS_TOKEN_CASA_TOMAS: TOKEN_META, IG_ACCESS_TOKEN_TOUZA: TOKEN_TOUZA };
    const t = leerConfigMetaMarca(env, "touza");
    expect(t.ok).toBe(false);
    expect(!t.ok && t.problemas.map((p) => p.variable)).toEqual(["IG_USER_ID_TOUZA"]);
    expect(leerConfigMetaMarca(env, "casa-tomas").ok).toBe(true);
    expect(cuentasDistintas(env).map((c) => c.marcas)).toEqual([["casa-tomas"]]);
  });

  it("con su ID pero sin su token tampoco (no usa IG_ACCESS_TOKEN)", () => {
    const env = { ...PROD, IG_USER_ID_TOUZA: "17841400000000077" };
    const t = leerConfigMetaMarca(env, "touza");
    expect(!t.ok && t.problemas.map((p) => p.variable)).toEqual(["IG_ACCESS_TOKEN_TOUZA"]);
  });

  it("con los dos secretos de cada marca publica sin los generales", () => {
    const env = {
      SUPABASE_URL: PROD.SUPABASE_URL, META_APP_ID: "1234567890",
      IG_USER_ID_CASA_TOMAS: "17841400000000001", IG_ACCESS_TOKEN_CASA_TOMAS: TOKEN_META,
      IG_USER_ID_TOUZA: "17841400000000077", IG_ACCESS_TOKEN_TOUZA: TOKEN_TOUZA,
    };
    expect(problemasVariables(env)).toEqual([]);
    const t = leerConfigMetaMarca(env, "touza");
    expect(t.ok && t.config).toMatchObject({ igUserId: "17841400000000077", token: TOKEN_TOUZA });
  });

  it("en la demo sigue cayendo en los generales", () => {
    const env = { ...GENERAL, SUPABASE_URL: `https://${REF_DEMO}.supabase.co` };
    const t = leerConfigMetaMarca(env, "touza");
    expect(t.ok && t.config.origen).toMatchObject({ propia: false, variableIgUserId: "IG_USER_ID" });
  });
});

describe("texto alternativo", () => {
  it("≤ 1000 caracteres; en stories se avisa de que se ignora", () => {
    expect(validarAltText("a".repeat(1000)).ok).toBe(true);
    expect(validarAltText("a".repeat(1001)).errores[0]).toMatch(/1001 caracteres/);
    expect(validarAltText("x", "story").avisos[0]).toMatch(/stories/);
  });
});
