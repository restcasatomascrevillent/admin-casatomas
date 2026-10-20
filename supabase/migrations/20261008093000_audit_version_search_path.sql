-- Fijar el contexto de la RPC de disponibilidad, como las demás RPC de auditoría.
ALTER FUNCTION public.version_auditoria_panel() SET search_path = pg_catalog;
