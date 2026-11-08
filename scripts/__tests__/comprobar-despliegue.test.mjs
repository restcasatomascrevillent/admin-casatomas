import { describe, expect, it } from "vitest";
import { diferencias } from "../comprobar-despliegue.mjs";

describe("comprobar que el despliegue es el esperado", () => {
  it("cuadra con la versión y el commit (corto o largo)", () => {
    expect(diferencias({ version: "1.2.0", commit: "abc1234" }, { version: "1.2.0", commit: "abc1234def5678" })).toEqual([]);
  });
  it("dice qué no cuadra", () => {
    expect(diferencias({ version: "1.1.0+abc1234", commit: "abc1234" }, { version: "1.1.0" })).toEqual(["versión 1.1.0+abc1234 (se esperaba 1.1.0)"]);
    expect(diferencias({ version: "1.1.0", commit: "fff0000" }, { commit: "abc1234def" })).toEqual(["commit fff0000 (se esperaba abc1234)"]);
    expect(diferencias(null, {})).toEqual(["/version.json no es un JSON válido"]);
  });
});
