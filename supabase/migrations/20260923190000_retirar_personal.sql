-- ============================================================================
-- PENDIENTE DE APROBACIÓN DEL DUEÑO — NO APLICAR SIN CONFIRMACIÓN EXPLÍCITA
-- ============================================================================
--
-- Contexto: la sección "Personal" del admin panel (adminpanelct) se retiró
-- del código el 2026-09-23 por decisión del dueño del restaurante (ver
-- docs/funcionalidades/10-retirada-seccion-personal.md en la raíz del repo
-- `codigo-restaurante`).
--
-- Este fichero es un CANDIDATO de limpieza de base de datos, escrito para
-- documentar qué objetos quedaron sin ningún consumidor en el frontend tras
-- esa retirada. NO ha sido ejecutado ni aplicado contra Supabase. Esta sesión
-- no tiene ni debe usar credenciales de Supabase.
--
-- Antes de aplicar cualquier cosa de este fichero, alguien con acceso a la
-- base de datos y contexto de negocio debe:
--   1. Confirmar que el dueño quiere borrar estos datos (nóminas, turnos,
--      horarios trabajados) y no solo archivarlos.
--   2. Comprobar que ningún otro proyecto/servicio (p. ej. `restaurante-phone`,
--      un futuro sistema de nóminas, o exports para gestoría) sigue usando
--      estas tablas antes de un DROP.
--   3. Hacer un dump/backup de estas tablas si hay valor histórico (turnos ya
--      trabajados, horas registradas) — recordar que, según
--      docs/funcionalidades/07-infraestructura-despliegue.md, el proyecto
--      Supabase se llama internamente `gestor_trabajadores` y nació como un
--      gestor de personal reciclado para el restaurante: puede haber más
--      acoplamiento del que este análisis (solo desde adminpanelct) alcanza
--      a ver.
--
-- Objetos identificados como exclusivos de la sección Personal (uso
-- verificado por grep en src/ de adminpanelct antes de retirar el código:
-- solo aparecían en src/hooks/useTrabajadores.ts, src/hooks/useDashboardStats.ts
-- —ya limpiado— y src/components/trabajadores/**, todos eliminados):
--
--   Tablas:
--     - public.trabajadores
--     - public.turnos
--     - public.registro_horas
--     - public.asignaciones_area
--     - public.asignaciones_sala
--
--   Vistas:
--     - public.vista_turnos_con_areas
--     - public.vista_turnos_completa   (declarada en migraciones antiguas;
--       docs/funcionalidades/07-infraestructura-despliegue.md la marca como
--       posiblemente inexistente ya en producción — verificar antes de tocar)
--
-- Objetos NO incluidos aquí por precaución / ambigüedad (conservadores,
-- el dueño podría querer archivarlos primero, o su alcance real no se pudo
-- verificar sin acceso a la BD):
--     - Cualquier función o trigger SECURITY DEFINER que referencie estas
--       tablas (no verificado desde el frontend).
--     - public.espacios_reserva / asignaciones_sala si en algún momento se
--       reutiliza para otra cosa que no sea turnos de personal — antes de
--       borrar `asignaciones_sala` confirmar que no se solapa con la
--       asignación de mesas de reservas.
--
-- ============================================================================

-- 1) Vistas dependientes primero (si existen)
DROP VIEW IF EXISTS public.vista_turnos_completa;
DROP VIEW IF EXISTS public.vista_turnos_con_areas;

-- 2) Tablas de asignación (dependen de turnos)
DROP TABLE IF EXISTS public.asignaciones_area;
DROP TABLE IF EXISTS public.asignaciones_sala;

-- 3) Registro de horas y turnos (dependen de trabajadores)
DROP TABLE IF EXISTS public.registro_horas;
DROP TABLE IF EXISTS public.turnos;

-- 4) Tabla de trabajadores
DROP TABLE IF EXISTS public.trabajadores;

-- ============================================================================
-- FIN — recordatorio: este fichero NO se ha ejecutado. Requiere revisión y
-- aprobación explícita del dueño antes de aplicarse contra la base de datos
-- real (proyecto Supabase `jeamoczmbfsnwkfjxcyo` / nombre interno
-- `gestor_trabajadores`).
-- ============================================================================
