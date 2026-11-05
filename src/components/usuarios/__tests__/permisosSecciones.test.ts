/**
 * Lógica pura de los permisos por sección de la pantalla Usuarios
 * (`src/components/usuarios/permisosSecciones.ts`), compartida por el diálogo
 * «Permisos» (ListaUsuarios), el alta (InvitarUsuario) y los roles
 * preconfigurados (ConfigurarRolesModal).
 *
 * Contexto (2026-10-01): hasta hoy las tres pantallas forzaban `can_edit: false`
 * en cada cambio y al cargar, así que el permiso de EDICIÓN no se podía dar desde
 * el panel y cualquier guardado borraba el que se hubiera puesto por SQL.
 */
import { describe, it, expect } from "vitest";
import {
  AYUDA_EDICION,
  SECCIONES_CONFIGURABLES,
  cambiarEditar,
  cambiarVer,
  mismosPermisos,
  permisosParaEditar,
  sinEdicion,
  type PermisoSeccion,
} from "@/components/usuarios/permisosSecciones";

const permiso = (section_key: string, can_view: boolean, can_edit: boolean): PermisoSeccion => ({
  section_key,
  can_view,
  can_edit,
});

const de = (permisos: PermisoSeccion[], clave: string) => permisos.find((p) => p.section_key === clave);

describe("SECCIONES_CONFIGURABLES", () => {
  // Tienda incluida en todos los entornos, también en producción: ya no es maqueta (dueño, 04/11/2026).
  it("son las secciones del panel salvo «usuarios» (que va por rol admin, no por permisos)", () => {
    const claves = SECCIONES_CONFIGURABLES.map((s) => s.key);
    expect(claves).toEqual([
      "dashboard", "reservas", "reservas_configuracion", "gestor_carta", "gestion_web", "marketing", "instagram_agencia", "instagram_render", "cheques", "tienda", "facturas",
    ]);
  });

  it("«Reservas · Configuración» va justo después de Reservas, como las pestañas del Gestor Web (04/11/2026)", () => {
    const seccion = SECCIONES_CONFIGURABLES.find((s) => s.key === "reservas_configuracion");
    expect(seccion?.label).toBe("Reservas · Configuración");
  });
});

describe("AYUDA_EDICION", () => {
  it("tiene un texto para cada sección configurable", () => {
    for (const seccion of SECCIONES_CONFIGURABLES) {
      expect(AYUDA_EDICION[seccion.key], seccion.key).toEqual(expect.any(String));
      expect(AYUDA_EDICION[seccion.key].length, seccion.key).toBeGreaterThan(10);
    }
  });

  it("en Reservas · Configuración dice qué se edita (reglas, turnos, plantillas) y que hace falta ver Reservas", () => {
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/reglas/);
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/turnos/);
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/plantillas de correo/);
    expect(AYUDA_EDICION.reservas_configuracion).toMatch(/«Ver» en Reservas/);
  });

  it("en Reservas explica lo que de verdad desbloquea: crear/modificar, llegadas y mover de sala", () => {
    expect(AYUDA_EDICION.reservas).toMatch(/crear/i);
    expect(AYUDA_EDICION.reservas).toMatch(/llegada/i);
    expect(AYUDA_EDICION.reservas).toMatch(/sala/i);
  });
});

describe("permisosParaEditar", () => {
  it("conserva el can_edit real guardado (no lo fuerza a false)", () => {
    const permisos = permisosParaEditar([permiso("reservas", true, true), permiso("facturas", true, false)]);

    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, true));
    expect(de(permisos, "facturas")).toEqual(permiso("facturas", true, false));
  });

  it("devuelve todas las secciones configurables; las que faltan, sin ver ni editar", () => {
    const permisos = permisosParaEditar([permiso("reservas", true, true)]);

    expect(permisos.map((p) => p.section_key)).toEqual(SECCIONES_CONFIGURABLES.map((s) => s.key));
    expect(de(permisos, "marketing")).toEqual(permiso("marketing", false, false));
  });

  it("editar implica ver (una fila con solo can_edit se muestra con las dos)", () => {
    const permisos = permisosParaEditar([permiso("reservas", false, true)]);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, true));
  });

  it("ignora secciones que ya no se configuran desde aquí (usuarios, retiradas)", () => {
    const permisos = permisosParaEditar([permiso("usuarios", true, true), permiso("trabajadores", true, true)]);
    expect(de(permisos, "usuarios")).toBeUndefined();
    expect(de(permisos, "trabajadores")).toBeUndefined();
  });
});

describe("cambiarVer", () => {
  it("al quitar «Ver» se quita también «Puede editar»", () => {
    const permisos = cambiarVer(permisosParaEditar([permiso("reservas", true, true)]), "reservas", false);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", false, false));
  });

  it("al dar «Ver» no se concede la edición", () => {
    const permisos = cambiarVer(permisosParaEditar([]), "reservas", true);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, false));
  });

  it("no toca el resto de secciones", () => {
    const antes = permisosParaEditar([permiso("reservas", true, true), permiso("facturas", true, true)]);
    const despues = cambiarVer(antes, "reservas", false);
    expect(de(despues, "facturas")).toEqual(permiso("facturas", true, true));
  });
});

describe("cambiarEditar", () => {
  it("concede la edición si la sección tiene «Ver»", () => {
    const permisos = cambiarEditar(permisosParaEditar([permiso("reservas", true, false)]), "reservas", true);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, true));
  });

  it("retira la edición y deja «Ver» como estaba", () => {
    const permisos = cambiarEditar(permisosParaEditar([permiso("reservas", true, true)]), "reservas", false);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, false));
  });

  it("no se puede activar sin «Ver»", () => {
    const permisos = cambiarEditar(permisosParaEditar([]), "reservas", true);
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", false, false));
  });
});

describe("sinEdicion", () => {
  it("quita la edición de todas las secciones sin tocar «Ver»", () => {
    const permisos = sinEdicion(permisosParaEditar([permiso("reservas", true, true), permiso("facturas", true, false)]));
    expect(de(permisos, "reservas")).toEqual(permiso("reservas", true, false));
    expect(de(permisos, "facturas")).toEqual(permiso("facturas", true, false));
  });
});

describe("mismosPermisos", () => {
  it("compara ver Y editar de cada sección configurable", () => {
    const a = permisosParaEditar([permiso("reservas", true, true)]);
    expect(mismosPermisos(a, permisosParaEditar([permiso("reservas", true, true)]))).toBe(true);
    expect(mismosPermisos(a, permisosParaEditar([permiso("reservas", true, false)]))).toBe(false);
    expect(mismosPermisos(a, permisosParaEditar([]))).toBe(false);
  });
});

