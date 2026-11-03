-- ROLLBACK de migrations/20261103170000_cambio_contrasena_propia.sql («Mi cuenta» › Cambiar contraseña).
-- A mano. Efecto: la Edge Function cambiar-mi-contrasena deja de poder empezar
-- intentos (responde 503 y no cambia nada). Las filas de audit_log ya escritas
-- se conservan. No toca iniciar_intento_panel ni el login. Idempotente.
begin;

drop function if exists public.finalizar_cambio_contrasena(uuid, uuid, text);
drop function if exists public.iniciar_cambio_contrasena(uuid);
drop index if exists public.idx_audit_log_cambio_contrasena;

commit;
