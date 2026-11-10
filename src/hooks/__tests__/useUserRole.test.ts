/**
 * Tests para src/hooks/useUserRole.tsx
 *
 * Estrategia:
 * - Se mockea @/integrations/supabase/client con el archivo __mocks__/client.ts
 * - Se mockea useAuth para controlar el usuario activo en cada test
 * - Se mockea useSuperAdmin (useCanAccessSection lo consume directamente) para
 *   controlar si el usuario es super admin sin depender de un
 *   <SuperAdminProvider> real
 * - Se testan useUserRole y useCanAccessSection de forma unitaria
 *
 * useUserRole()/useCanAccessSection() pasaron a leer un contexto
 * (UserRoleProvider) en vez de tener su propio estado (2026-09-25): cada
 * renderHook necesita el `wrapper: UserRoleProvider` para que haya contexto
 * que leer.
 *
 * Ser "admin" ya no da acceso automático a todas las secciones (2026-09-26):
 * useCanAccessSection ahora solo concede ese bypass a un super admin real
 * (useSuperAdmin), igual que has_section_permission() en la base de datos.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// --- Mocks de módulos ---
vi.mock("@/integrations/supabase/client");
vi.mock("sonner");

// useAuth se mockea a nivel de módulo para poder cambiar el usuario por test
vi.mock("@/hooks/useAuth", () => ({
  useAuth: vi.fn(),
}));

// useSuperAdmin se mockea igual que useAuth: useCanAccessSection lo llama
// directamente, así que no hace falta envolver con un <SuperAdminProvider>.
vi.mock("@/hooks/useSuperAdmin", () => ({
  useSuperAdmin: vi.fn(),
}));

import * as clienteMock from "@/integrations/supabase/client";
// `resetSupabaseMocks` solo existe en el mock (__mocks__/client.ts), no en el
// cliente real: se saca con un cast para no sumar un error de tipos.
const { supabase } = clienteMock;
const { resetSupabaseMocks } = clienteMock as unknown as { resetSupabaseMocks: () => void };
import { useAuth } from "@/hooks/useAuth";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { useUserRole, useCanAccessSection, UserRoleProvider } from "@/hooks/useUserRole";

// Tipos auxiliares
const mockUser = (email: string, id = "user-123") => ({
  id,
  email,
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
});

// Helper para que supabase.from().select().eq().single() resuelva con datos
function mockRoleQuery(role: string | null, permissions: unknown[] = []) {
  const singleMock = vi.fn().mockResolvedValue({
    data: role ? { role } : null,
    error: null,
  });

  // El segundo .from() call devuelve permisos (lista)
  let callCount = 0;
  (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
    callCount++;
    const builder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: singleMock,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        // Primera llamada = roles, segunda = permissions
        Promise.resolve({
          data: callCount === 1 ? (role ? [{ role }] : []) : permissions,
          error: null,
        }).then(onfulfilled),
    };
    return builder;
  });
}

describe("useUserRole", () => {
  beforeEach(() => {
    resetSupabaseMocks();
    // Rol y permisos recordados en el dispositivo (09/11/2026, `lib/cachePermisos.ts`): cada test parte de cero.
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("devuelve loading=true inicialmente cuando hay usuario no-superadmin", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("staff@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    // Supabase tarda en resolver — devolvemos una promesa que nunca resuelve
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(new Promise(() => {})), // nunca resuelve
      then: () => new Promise(() => {}),
    });

    const { result } = renderHook(() => useUserRole(), { wrapper: UserRoleProvider });
    // En el primer render, loading debe ser true
    expect(result.current.loading).toBe(true);
  });

  it("devuelve rol admin y loading=false para super admin sin esperar a Supabase", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("miguelsantiagores@gmail.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    mockRoleQuery("admin", []);

    const { result } = renderHook(() => useUserRole(), { wrapper: UserRoleProvider });

    // Super admin se resuelve síncronamente sin esperar a Supabase
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe("admin");
    expect(result.current.isAdmin).toBe(true);
  });

  it("devuelve role=null y permisos vacíos cuando no hay usuario", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    const { result } = renderHook(() => useUserRole(), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBeNull();
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.permissions).toEqual([]);
  });

  it("asigna rol manager devuelto por Supabase", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("manager@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    // Primera llamada = user_roles, segunda = user_permissions
    let callCount = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      callCount++;
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: table === "user_roles" ? { role: "manager" } : null,
          error: null,
        }),
        then: (onfulfilled: (v: unknown) => unknown) =>
          Promise.resolve({
            data: table === "user_permissions"
              ? [{ section_key: "reservas", can_view: true, can_edit: false }]
              : [],
            error: null,
          }).then(onfulfilled),
      };
    });

    const { result } = renderHook(() => useUserRole(), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.role).toBe("manager");
    expect(result.current.isAdmin).toBe(false);
  });

  it("isAdmin=true cuando el rol es admin aunque no sea superadmin", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("adminlocal@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: table === "user_roles" ? { role: "admin" } : null,
        error: null,
      }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useUserRole(), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.isAdmin).toBe(true);
  });
});

describe("useCanAccessSection", () => {
  beforeEach(() => {
    resetSupabaseMocks();
    // Rol y permisos recordados en el dispositivo (09/11/2026, `lib/cachePermisos.ts`): cada test parte de cero.
    localStorage.clear();
    // Por defecto, nadie es super admin; los tests que lo necesiten lo sobrescriben.
    vi.mocked(useSuperAdmin).mockReturnValue({ isSuperAdmin: false, loading: false });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("un admin normal SIN permisos explícitos ya no tiene acceso automático", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("admin@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useCanAccessSection("reservas"), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.canAccess).toBe(false);
  });

  it("un super admin puede acceder a cualquier sección aunque no tenga permisos explícitos", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("superadmin@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });
    vi.mocked(useSuperAdmin).mockReturnValue({ isSuperAdmin: true, loading: false });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { role: "admin" }, error: null }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useCanAccessSection("reservas"), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.canAccess).toBe(true);
  });

  it("usuario sin permisos explícitos no puede acceder", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("staff@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: table === "user_roles" ? { role: "staff" } : null,
        error: null,
      }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        // user_permissions vacío → sin permisos
        Promise.resolve({ data: [], error: null }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useCanAccessSection("usuarios"), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.canAccess).toBe(false);
  });

  it("usuario con permiso can_view=true puede ver la sección", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("staff@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: table === "user_roles" ? { role: "staff" } : null,
        error: null,
      }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === "user_permissions"
            ? [{ section_key: "reservas", can_view: true, can_edit: false }]
            : [],
          error: null,
        }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useCanAccessSection("reservas", "view"), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.canAccess).toBe(true);
  });

  it("usuario con can_view=true pero can_edit=false no puede editar", async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("staff@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: table === "user_roles" ? { role: "staff" } : null,
        error: null,
      }),
      then: (onfulfilled: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === "user_permissions"
            ? [{ section_key: "reservas", can_view: true, can_edit: false }]
            : [],
          error: null,
        }).then(onfulfilled),
    }));

    const { result } = renderHook(() => useCanAccessSection("reservas", "edit"), { wrapper: UserRoleProvider });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.canAccess).toBe(false);
  });

  it("devuelve loading=true mientras el hook interno está cargando", () => {
    vi.mocked(useAuth).mockReturnValue({
      user: mockUser("staff@restaurante.com") as any,
      session: null,
      loading: false,
      signUp: vi.fn(),
      signIn: vi.fn(),
      signOut: vi.fn(),
    });

    // Promesa que nunca resuelve → mantiene loading
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnValue(new Promise(() => {})),
      then: () => new Promise(() => {}),
    });

    const { result } = renderHook(() => useCanAccessSection("reservas"), { wrapper: UserRoleProvider });
    expect(result.current.loading).toBe(true);
    expect(result.current.canAccess).toBe(false);
  });
});
