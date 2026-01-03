-- Add column to control if primary slot should be hidden when secondary opens
ALTER TABLE public.configuracion_turnos 
ADD COLUMN ocultar_primario_si_secundario boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.configuracion_turnos.ocultar_primario_si_secundario IS 
  'Si es true, cuando un turno secundario se abre por alta demanda, el turno primario correspondiente se oculta de la lista de horarios disponibles';