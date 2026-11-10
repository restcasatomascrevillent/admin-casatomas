/**
 * Tipos de usuario fijos «Reservas» y «Albaranes» (10/11/2026, petición del dueño: «Crear usuarios de
 * Reservas (solo crear y ver reservas) usuario albaranes solo subida fotos»).
 */
import { describe, expect, it } from "vitest";
import {
  cambiarVer,
  interruptorUnico,
  permisosParaEditar,
  rolSegunPermisos,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";
import { TIPOS_USUARIO, tipoDeValor, tipoQueCoincide, valorTipo } from "@/components/usuarios/tiposUsuario";

const conAcceso = (permisos: PermisoSeccion[]) =>
  permisos.filter((p) => p.can_view || p.can_edit).map((p) => `${p.section_key}:${p.can_view ? "v" : ""}${p.can_edit ? "e" : ""}`);
const tipo = (id: string) => TIPOS_USUARIO.find((t) => t.id === id)!;

describe("tipos de usuario", () => {
  it("«Reservas»: solo «Ver» en Reservas y «Reservas · Crear»; ni Editar, ni Configuración, ni otras secciones", () => {
    expect(conAcceso(tipo("reservas").permisos)).toEqual(["reservas:v", "reservas_crear:v"]);
    expect(tipo("reservas").inicio).toBe("/reservas");
  });

  it("«Albaranes»: solo «Facturas · Solo fotos»; ni Facturas, ni Subida, ni otras secciones", () => {
    expect(conAcceso(tipo("albaranes").permisos)).toEqual(["facturas_albaranes:v"]);
    expect(tipo("albaranes").inicio).toBe("/albaranes");
  });

  it("los dos son Staff (nadie edita nada)", () => {
    for (const t of TIPOS_USUARIO) expect(rolSegunPermisos(t.permisos), t.id).toBe("staff");
  });

  it("valor del desplegable ↔ tipo, sin chocar con los ids de los preconfigurados", () => {
    expect(valorTipo(tipo("reservas"))).toBe("tipo:reservas");
    expect(tipoDeValor("tipo:albaranes")?.nombre).toBe("Albaranes");
    expect(tipoDeValor("manual")).toBeNull();
    expect(tipoDeValor("5f0c8a3e-0000-4000-8000-000000000000")).toBeNull();
    expect(tipoDeValor("tipo:otro")).toBeNull();
  });

  it("reconoce a un usuario guardado con esos permisos (también con reservas_crear en can_edit, por SQL)", () => {
    expect(tipoQueCoincide([
      { section_key: "reservas", can_view: true, can_edit: false },
      { section_key: "reservas_crear", can_view: false, can_edit: true },
    ])?.id).toBe("reservas");
    expect(tipoQueCoincide([{ section_key: "facturas_albaranes", can_view: true, can_edit: false }])?.id).toBe("albaranes");
  });

  it("con algo más ya no es ese tipo", () => {
    expect(tipoQueCoincide([
      { section_key: "reservas", can_view: true, can_edit: true },
      { section_key: "reservas_crear", can_view: true, can_edit: false },
    ])).toBeNull();
    expect(tipoQueCoincide([
      { section_key: "facturas_albaranes", can_view: true, can_edit: false },
      { section_key: "dashboard", can_view: true, can_edit: false },
    ])).toBeNull();
    expect(tipoQueCoincide([])).toBeNull();
  });
});

describe("permisos nuevos de un solo interruptor", () => {
  it("«Reservas · Crear» → «Puede crear» y «Facturas · Solo fotos» → «Puede subir fotos»", () => {
    expect(interruptorUnico("reservas_crear")).toBe("Puede crear");
    expect(interruptorUnico("facturas_albaranes")).toBe("Puede subir fotos");
  });

  it("se guardan en can_view (lo de can_edit cuenta como «sí»)", () => {
    const p = permisosParaEditar([{ section_key: "facturas_albaranes", can_view: false, can_edit: true }]);
    expect(p.find((x) => x.section_key === "facturas_albaranes")).toEqual({ section_key: "facturas_albaranes", can_view: true, can_edit: false });
  });

  it("activar «Reservas · Crear» activa «Ver» en Reservas (en la BD hacen falta los dos)", () => {
    const p = cambiarVer(permisosParaEditar([]), "reservas_crear", true);
    expect(conAcceso(p)).toEqual(["reservas:v", "reservas_crear:v"]);
  });

  it("quitar «Ver» en Reservas quita también «Reservas · Crear»", () => {
    const p = cambiarVer(tipo("reservas").permisos, "reservas", false);
    expect(conAcceso(p)).toEqual([]);
  });

  it("quitar «Reservas · Crear» deja «Ver» en Reservas", () => {
    const p = cambiarVer(tipo("reservas").permisos, "reservas_crear", false);
    expect(conAcceso(p)).toEqual(["reservas:v"]);
  });
});
