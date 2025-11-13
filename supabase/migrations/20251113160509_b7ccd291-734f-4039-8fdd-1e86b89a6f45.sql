-- Eliminar foreign key constraint problemática de salas
ALTER TABLE public.salas
DROP CONSTRAINT IF EXISTS salas_user_id_fkey CASCADE;

-- Eliminar foreign key constraint problemática de posiciones_sala si existe
ALTER TABLE public.posiciones_sala
DROP CONSTRAINT IF EXISTS posiciones_sala_sala_id_fkey CASCADE;

-- Eliminar foreign key constraint problemática de reservas si existe
ALTER TABLE public.reservas
DROP CONSTRAINT IF EXISTS reservas_sala_id_fkey CASCADE,
DROP CONSTRAINT IF EXISTS reservas_user_id_fkey CASCADE;