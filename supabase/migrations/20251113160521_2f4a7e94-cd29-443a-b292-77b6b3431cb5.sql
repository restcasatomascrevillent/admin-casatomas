-- Recrear foreign key constraint entre reservas y salas
ALTER TABLE public.reservas
ADD CONSTRAINT reservas_sala_id_fkey 
FOREIGN KEY (sala_id) 
REFERENCES public.salas(id) 
ON DELETE CASCADE;

-- Recrear foreign key constraint entre posiciones_sala y salas
ALTER TABLE public.posiciones_sala
ADD CONSTRAINT posiciones_sala_sala_id_fkey 
FOREIGN KEY (sala_id) 
REFERENCES public.salas(id) 
ON DELETE CASCADE;