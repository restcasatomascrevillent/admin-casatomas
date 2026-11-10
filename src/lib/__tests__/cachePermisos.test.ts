/**
 * Rol, permisos y «super admin» recordados en el dispositivo (09/11/2026, «Hoy» con mala cobertura):
 * por usuario, 24 h como mucho, mezclando lo que guarda cada proveedor, y fuera al borrar.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  CADUCIDAD_PERMISOS_MS,
  CLAVE_PERMISOS,
  borrarPermisosRecordados,
  guardarPermisosRecordados,
  leerPermisosRecordados,
} from "../cachePermisos";

const PERMISOS = [{ section_key: "reservas", can_view: true, can_edit: false }];
const T0 = Date.UTC(2026, 10, 9, 12, 0, 0);

beforeEach(() => localStorage.clear());

describe("cachePermisos", () => {
  it("devuelve lo guardado para el MISMO usuario", () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: PERMISOS }, T0);
    expect(leerPermisosRecordados("ana", T0 + 1000)).toEqual({ role: "staff", permissions: PERMISOS, superAdmin: undefined });
  });

  it("otro usuario no lo ve, y la copia del anterior se borra", () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: PERMISOS }, T0);
    expect(leerPermisosRecordados("bea", T0)).toBeNull();
    expect(localStorage.getItem(CLAVE_PERMISOS)).toBeNull();
  });

  it("sin usuario, nada", () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: PERMISOS }, T0);
    expect(leerPermisosRecordados(null, T0)).toBeNull();
  });

  it("caduca a las 24 h", () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: PERMISOS }, T0);
    expect(leerPermisosRecordados("ana", T0 + CADUCIDAD_PERMISOS_MS)).not.toBeNull();
    expect(leerPermisosRecordados("ana", T0 + CADUCIDAD_PERMISOS_MS + 1)).toBeNull();
  });

  it("mezcla la parte de cada proveedor (permisos y super admin) sin pisarse", () => {
    guardarPermisosRecordados("ana", { superAdmin: false }, T0);
    // Solo «super admin»: los permisos siguen sin saberse (undefined, no una lista vacía).
    expect(leerPermisosRecordados("ana", T0)?.permissions).toBeUndefined();
    guardarPermisosRecordados("ana", { role: "manager", permissions: PERMISOS }, T0 + 10);
    expect(leerPermisosRecordados("ana", T0 + 20)).toEqual({ role: "manager", permissions: PERMISOS, superAdmin: false });
    guardarPermisosRecordados("ana", { superAdmin: true }, T0 + 30);
    expect(leerPermisosRecordados("ana", T0 + 40)).toEqual({ role: "manager", permissions: PERMISOS, superAdmin: true });
  });

  it("al guardar para otro usuario no hereda nada del anterior", () => {
    guardarPermisosRecordados("ana", { role: "admin", permissions: PERMISOS, superAdmin: true }, T0);
    guardarPermisosRecordados("bea", { superAdmin: false }, T0);
    expect(leerPermisosRecordados("bea", T0)).toEqual({ role: null, permissions: undefined, superAdmin: false });
  });

  it("borrar lo quita", () => {
    guardarPermisosRecordados("ana", { role: "staff", permissions: PERMISOS }, T0);
    borrarPermisosRecordados();
    expect(leerPermisosRecordados("ana", T0)).toBeNull();
  });

  it("JSON roto o de otra versión: se ignora", () => {
    localStorage.setItem(CLAVE_PERMISOS, "{roto");
    expect(leerPermisosRecordados("ana", T0)).toBeNull();
    localStorage.setItem(CLAVE_PERMISOS, JSON.stringify({ v: 99, usuario: "ana", guardado: T0, permissions: PERMISOS }));
    expect(leerPermisosRecordados("ana", T0)).toBeNull();
  });
});
