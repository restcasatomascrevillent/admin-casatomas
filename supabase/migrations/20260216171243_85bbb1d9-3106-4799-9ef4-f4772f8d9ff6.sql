
ALTER TABLE public.reservas ADD COLUMN espacio_id uuid REFERENCES public.espacios_reserva(id) ON DELETE SET NULL;

CREATE INDEX idx_reservas_espacio_id ON public.reservas(espacio_id);
