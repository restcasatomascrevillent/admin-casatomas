# Plan de Testing — adminpanelct

> Fecha: 2026-03-21
> Framework: Vitest + React Testing Library + jsdom

---

## Estado actual de cobertura

| Área | Archivo(s) | Estado | Prioridad | Tests existentes |
|---|---|---|---|---|
| Permisos puros | `src/config/permissions.ts` | ✅ Tiene tests | 🔴 Alta | `config/__tests__/permissions.test.ts` |
| Rol de usuario | `src/hooks/useUserRole.ts` | ✅ Tiene tests | 🔴 Alta | `hooks/__tests__/useUserRole.test.ts` |
| Solicitudes pendientes | `src/hooks/useSolicitudesPendientes.ts` | ✅ Tiene tests | 🔴 Alta | `hooks/__tests__/useSolicitudesPendientes.test.ts` |
| Notificaciones dashboard | `src/hooks/useNotificacionesDashboard.ts` | ✅ Tiene tests | 🔴 Alta | `hooks/__tests__/useNotificacionesDashboard.test.ts` |
| Schemas de carta (Zod) | `src/schemas/carta.ts` | ✅ Tiene tests | 🔴 Alta | `schemas/__tests__/carta.test.ts` |
| Componente GestionSolicitudes | `src/components/reservas/GestionSolicitudes.tsx` | ✅ Tiene tests | 🔴 Alta | `components/reservas/__tests__/GestionSolicitudes.test.tsx` |
| Auth hook | `src/hooks/useAuth.ts` | ❌ Sin tests | 🔴 Alta | — |
| Disponibilidad | `src/hooks/useDisponibilidad.ts` | ❌ Sin tests | 🔴 Alta | — |
| Config reservas | `src/hooks/useConfiguracionReservas.ts` | ❌ Sin tests | 🔴 Alta | — |
| Blacklist | `src/hooks/useBlacklist.ts` | ❌ Sin tests | 🔴 Alta | — |
| App routing | `src/App.tsx` | ❌ Sin tests | 🟡 Media | — |
| Dashboard layout | `src/components/DashboardLayout.tsx` | ❌ Sin tests | 🟡 Media | — |
| Sidebar | `src/components/AppSidebar.tsx` | ❌ Sin tests | 🟡 Media | — |
| Formulario reserva | `src/components/reservas/FormularioReserva.tsx` | ❌ Sin tests | 🔴 Alta | — |
| Vista hoy | `src/components/reservas/VistaHoy.tsx` | ❌ Sin tests | 🟡 Media | — |
| Resto de hooks (stats, TPV, etc.) | `src/hooks/use*.ts` (los demás) | ❌ Sin tests | 🟢 Baja | — |

---

## Instalación del framework

```bash
npm install -D vitest @vitest/ui @vitest/coverage-v8 \
  @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event \
  jsdom
```

---

## Cómo ejecutar los tests

```bash
# Una sola vez (CI)
npm test

# Modo watch (desarrollo)
npm run test:watch

# Con cobertura
npm run test:coverage

# UI interactiva en el browser
npm run test:ui
```

---

## Estrategia de mocking

### Supabase
Todos los tests mockean `@/integrations/supabase/client` usando el archivo
`src/integrations/supabase/__mocks__/client.ts`. Este mock:
- Expone un builder encadenable que imita la API de Supabase (`.from().select().eq()...`)
- Provee helpers: `mockSupabaseFrom(data, error)` y `resetSupabaseMocks()`
- Mockea `supabase.channel` para suscripciones realtime

### useAuth
Se mockea con `vi.mock("@/hooks/useAuth")` y se inyecta el usuario deseado por test.

### sonner (toast)
Se mockea para verificar qué mensajes se muestran sin efectos secundarios visuales.

---

## Tests pendientes de alta prioridad

### `useAuth` — `src/hooks/__tests__/useAuth.test.ts`
- signIn con credenciales válidas → devuelve data sin error
- signIn con credenciales inválidas → muestra toast y devuelve error
- signUp con email ya registrado → muestra toast apropiado
- signUp con schema inválido (Zod) → muestra error de validación
- signOut con token expirado (403) → limpia sesión local
- onAuthStateChange maneja sesión null correctamente

### `useDisponibilidad` — funciones puras extraíbles
El fichero tiene lógica de negocio testeable de forma unitaria:
- `generarTurnosDinamicos`: given una config de turnos con umbral de ocupación,
  añade turnos secundarios cuando la ocupación supera el umbral
- `verificarCapacidadDisponible`: dado capacidad=40 y comensales=35, disponible=5
- Turnos por defecto cuando no hay config: `["13:00", "15:00", "20:30", "22:00"]`
- Deduplicación de turnos al final del algoritmo

### `useConfiguracionReservas` — `src/hooks/__tests__/useConfiguracionReservas.test.ts`
- Devuelve DEFAULTS cuando Supabase retorna PGRST116 (no hay fila)
- Devuelve los datos reales cuando existen en BD
- `useActualizarConfiguracionReservas`: llama update con los campos correctos

### `useBlacklist` — `src/hooks/__tests__/useBlacklist.test.ts`
- `useVerificarBlacklist`: retorna null si no está en blacklist
- `useVerificarBlacklist`: retorna la entrada si email coincide
- `useVerificarBlacklist`: retorna la entrada si teléfono coincide
- `useCrearBlacklist`: invalida query "blacklist" al hacer onSuccess
- `useEliminarBlacklist`: llama delete con el id correcto

---

## Tests de componentes pendientes

### `FormularioReserva` (alta prioridad)
Este componente tiene lógica de validación de fechas, horarios y comensales
crítica para el negocio. Requiere wrapper con `QueryClientProvider`.

Tests recomendados:
- Renderiza campos nombre, teléfono, fecha, hora, comensales
- No permite fecha pasada
- No permite más comensales que `max_comensales_por_reserva`
- Muestra error de validación si teléfono está vacío y `telefono_obligatorio=true`
- Al enviar, llama a la mutación de Supabase con los datos correctos

### `GestionBlacklist`
- Renderiza lista de entradas
- Botón "Eliminar" llama a `useEliminarBlacklist` con el id correcto
- Formulario de nueva entrada valida tipo (email/telefono) y valor

---

## Cobertura objetivo por sprint

| Sprint | Objetivo |
|---|---|
| Sprint 1 (actual) | Funciones puras + hooks de lectura: 60% líneas |
| Sprint 2 | Hooks de mutación + formularios críticos: 75% líneas |
| Sprint 3 | E2E flows principales con Playwright: reserva completa, blacklist |
