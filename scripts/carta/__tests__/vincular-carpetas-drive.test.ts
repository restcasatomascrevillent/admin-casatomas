// @vitest-environment node
/**
 * scripts/carta/vincular-carpetas-drive.mjs: lectura del CSV de estructura,
 * emparejado por plato_id y por nombre (sin tildes; categoría para desempatar;
 * ambiguas sin tocar) y que por defecto SOLO simula (sin red, sin escribir).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carpetasDeCsv, carpetasDeFuncion, emparejar, informe, normalizar, parsearCsv } from "../vincular-carpetas-drive.mjs";

const id = (n: number) => `1Carpeta${String(n).padStart(12, "0")}`;
const CSV = [
  "﻿ruta,id,tipo,plato_id,categoria",
  `MARKETING/Platos,${id(1)},seccion,,`,
  `MARKETING/Platos/09 Carnes,${id(2)},categoria,,`,
  `MARKETING/Platos/09 Carnes/Chuletón ternera,${id(3)},plato,p-chuleton,09 Carnes`,
  `MARKETING/Platos/09 Carnes/Entrecot de ternera nacional,${id(4)},plato,,09 Carnes`,
  `MARKETING/Platos/09 Carnes/Entrecot de ternera nacional/Vídeos,${id(5)},plato,,`,
  `MARKETING/Platos/01 Novedades del día/Caviar Oscietra,${id(6)},plato,,01 Novedades del día`,
  `MARKETING/Platos/03 Entrantes fríos/Caviar Oscietra,${id(7)},plato,,03 Entrantes fríos`,
  `"MARKETING/Platos/09 Carnes/Cochinillo, asado",${id(8)},plato,,`,
  `MARKETING/Vinos/Tintos/Pidio,${id(9)},vino,,`,
  `MARKETING/Platos/09 Carnes/Corta,corto,plato,,`,
].join("\r\n");

describe("CSV de estructura", () => {
  it("lee comillas y BOM y se queda con las carpetas de plato y de vino (cuatro tramos, id válido)", () => {
    expect(parsearCsv('a,"b,c","d""e"\n1,2,3')).toEqual([["a", "b,c", 'd"e'], ["1", "2", "3"]]);
    const c = carpetasDeCsv(CSV);
    expect(c.map((x) => `${x.tabla}:${x.nombre}`)).toEqual(["Platos:Chuletón ternera", "Platos:Entrecot de ternera nacional", "Platos:Caviar Oscietra", "Platos:Caviar Oscietra", "Platos:Cochinillo, asado", "Vinos:Pidio"]);
    expect(c[0]).toMatchObject({ carpetaId: id(3), categoria: "09 Carnes", fichaId: "p-chuleton" });
    expect(() => carpetasDeCsv("x,y\n1,2")).toThrow(/ruta/);
  });

  it("también de la respuesta de listar_platos", () => {
    const c = carpetasDeFuncion({ categorias: [{ nombre: "09 Carnes", platos: [{ id: id(3), nombre: "Chuletón" }, { id: "malo", nombre: "x" }] }] });
    expect(c).toEqual([{ tabla: "Platos", carpetaId: id(3), nombre: "Chuletón", categoria: "09 Carnes", ruta: "MARKETING/Platos/09 Carnes/Chuletón", fichaId: null }]);
  });
});

describe("emparejar", () => {
  const fichas = [
    { tabla: "Platos", id: "p-chuleton", nombre: "Chuletón de ternera (nombre de la carta distinto)", categoria: "CARNES", drive_folder_id: null },
    { tabla: "Platos", id: "p-entrecot", nombre: "ENTRECOT DE TERNERA NACIONAL", categoria: "CARNES", drive_folder_id: null },
    { tabla: "Platos", id: "p-cav1", nombre: "Caviar Oscietra", categoria: "NOVEDADES DEL DÍA", drive_folder_id: null },
    { tabla: "Platos", id: "p-cav3", nombre: "Caviar Oscietra", categoria: "ENTRANTES FRÍOS", drive_folder_id: id(7) },
    { tabla: "Platos", id: "p-cochi", nombre: "Cochinillo, asado", categoria: "CARNES", drive_folder_id: id(99) },
    { tabla: "Platos", id: "p-sin", nombre: "Sin carpeta", categoria: "", drive_folder_id: null },
    { tabla: "Vinos", id: "v-pidio", nombre: "Pidió", categoria: "Tintos", drive_folder_id: null },
  ];
  it("por plato_id, por nombre sin tildes ni mayúsculas, y la categoría desempata los repetidos", () => {
    const r = emparejar(fichas, carpetasDeCsv(CSV));
    const por = (x: string) => r.escribir.find((e) => e.id === x);
    expect(por("p-chuleton")).toMatchObject({ carpetaId: id(3), por: "plato_id" });
    expect(por("p-entrecot")).toMatchObject({ carpetaId: id(4), por: "nombre" });
    // «Caviar Oscietra» está en dos categorías: «NOVEDADES DEL DÍA» ≈ «01 Novedades del día».
    expect(por("p-cav1")).toMatchObject({ carpetaId: id(6), por: "nombre" });
    expect(por("p-cochi")).toBeUndefined(); // ya tenía otra carpeta: no se toca
    expect(r.distintas.map((x) => x.id)).toEqual(["p-cochi"]);
    expect(por("v-pidio")).toMatchObject({ carpetaId: id(9) });
    expect(r.yaVinculadas.map((x) => x.id)).toEqual(["p-cav3"]);
    expect(r.sinCarpeta.map((x) => x.id)).toEqual(["p-sin"]);
    expect(r.carpetasSinFicha).toEqual([]);
  });

  it("--sobrescribir escribe también las que tenían otra carpeta", () => {
    const r = emparejar(fichas, carpetasDeCsv(CSV), { sobrescribir: true });
    expect(r.escribir.find((e) => e.id === "p-cochi")).toMatchObject({ carpetaId: id(8), antes: id(99) });
  });

  it("dos carpetas con el mismo nombre y misma categoría, o dos fichas para una carpeta: ambiguo, no se empareja", () => {
    const dos = carpetasDeCsv([`ruta,id`, `MARKETING/Platos/09 Carnes/Flan,${id(1)}`, `MARKETING/Platos/09 Carnes/Flan,${id(2)}`].join("\n"));
    const a = emparejar([{ tabla: "Platos", id: "f", nombre: "Flan", categoria: "Carnes" }], dos);
    expect(a.escribir).toEqual([]);
    expect(a.ambiguas[0]).toMatchObject({ id: "f" });
    const una = carpetasDeCsv([`ruta,id`, `MARKETING/Platos/09 Carnes/Flan,${id(1)}`].join("\n"));
    const b = emparejar([{ tabla: "Platos", id: "f1", nombre: "Flan", categoria: "Carnes" }, { tabla: "Platos", id: "f2", nombre: "flan", categoria: "CARNES" }], una);
    expect(b.escribir).toEqual([]);
    expect(b.ambiguas).toHaveLength(2);
  });

  it("normaliza y el informe cuenta", () => {
    expect(normalizar(" Ñandú  ÁÉ ")).toBe("nandu ae");
    const t = informe(emparejar(fichas, carpetasDeCsv(CSV)));
    expect(t).toMatch(/Se guardaría la carpeta en 4 fichas/);
  });
});

describe("por defecto solo simula", () => {
  it("con --fichas y --csv no toca la red ni escribe (sin --aplicar)", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vincular-"));
    writeFileSync(path.join(dir, "e.csv"), CSV);
    writeFileSync(path.join(dir, "f.json"), JSON.stringify([{ tabla: "Platos", id: "p-entrecot", nombre: "Entrecot de ternera nacional", categoria: "Carnes" }]));
    const salida = execFileSync(process.execPath, ["scripts/carta/vincular-carpetas-drive.mjs", "--csv", path.join(dir, "e.csv"), "--fichas", path.join(dir, "f.json")], {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(salida).toMatch(/SIMULACIÓN/);
    expect(salida).toMatch(/Se guardaría la carpeta en 1 fichas/);
  });
});
