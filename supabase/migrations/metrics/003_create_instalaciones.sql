-- Crear tabla de instalaciones
CREATE TABLE IF NOT EXISTS public.instalaciones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nombre TEXT NOT NULL,
    tipo TEXT NOT NULL,
    ubicacion TEXT,
    estado TEXT NOT NULL DEFAULT 'planificada' CHECK (estado IN ('planificada', 'en_progreso', 'completada', 'cancelada')),
    fecha_planificada TIMESTAMPTZ NOT NULL,
    fecha_instalacion TIMESTAMPTZ,
    tecnico_id UUID,
    cliente_id UUID,
    equipos JSONB,
    notas TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para mejorar el rendimiento de consultas
CREATE INDEX IF NOT EXISTS idx_instalaciones_tipo ON public.instalaciones(tipo);
CREATE INDEX IF NOT EXISTS idx_instalaciones_estado ON public.instalaciones(estado);
CREATE INDEX IF NOT EXISTS idx_instalaciones_fecha_planificada ON public.instalaciones(fecha_planificada);
CREATE INDEX IF NOT EXISTS idx_instalaciones_fecha_instalacion ON public.instalaciones(fecha_instalacion);
CREATE INDEX IF NOT EXISTS idx_instalaciones_tecnico_id ON public.instalaciones(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_instalaciones_cliente_id ON public.instalaciones(cliente_id);
CREATE INDEX IF NOT EXISTS idx_instalaciones_ubicacion ON public.instalaciones(ubicacion);

-- Trigger para actualizar updated_at automáticamente
CREATE TRIGGER update_instalaciones_updated_at
    BEFORE UPDATE ON public.instalaciones
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para establecer fecha_instalacion cuando se completa
CREATE OR REPLACE FUNCTION set_fecha_instalacion()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.estado = 'completada' AND OLD.estado != 'completada' AND NEW.fecha_instalacion IS NULL) THEN
        NEW.fecha_instalacion = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_instalaciones_fecha_instalacion
    BEFORE UPDATE ON public.instalaciones
    FOR EACH ROW
    EXECUTE FUNCTION set_fecha_instalacion();

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.instalaciones ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura a usuarios autenticados
CREATE POLICY "Permitir lectura a usuarios autenticados"
    ON public.instalaciones
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Política para permitir inserción a usuarios autenticados
CREATE POLICY "Permitir inserción a usuarios autenticados"
    ON public.instalaciones
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Política para permitir actualización a usuarios autenticados
CREATE POLICY "Permitir actualización a usuarios autenticados"
    ON public.instalaciones
    FOR UPDATE
    USING (auth.role() = 'authenticated');

-- Comentarios de documentación
COMMENT ON TABLE public.instalaciones IS 'Tabla para gestionar instalaciones de hardware, software e infraestructura';
COMMENT ON COLUMN public.instalaciones.nombre IS 'Nombre descriptivo de la instalación';
COMMENT ON COLUMN public.instalaciones.tipo IS 'Tipo de instalación: hardware, software, infraestructura, etc.';
COMMENT ON COLUMN public.instalaciones.ubicacion IS 'Ubicación física o lógica de la instalación';
COMMENT ON COLUMN public.instalaciones.estado IS 'Estado actual: planificada, en_progreso, completada, cancelada';
COMMENT ON COLUMN public.instalaciones.fecha_planificada IS 'Fecha planificada para la instalación';
COMMENT ON COLUMN public.instalaciones.fecha_instalacion IS 'Fecha real de instalación (se establece automáticamente al completar)';
COMMENT ON COLUMN public.instalaciones.tecnico_id IS 'ID del técnico responsable';
COMMENT ON COLUMN public.instalaciones.cliente_id IS 'ID del cliente';
COMMENT ON COLUMN public.instalaciones.equipos IS 'Lista de equipos instalados en formato JSON';
COMMENT ON COLUMN public.instalaciones.notas IS 'Notas adicionales sobre la instalación';
COMMENT ON COLUMN public.instalaciones.metadata IS 'Datos adicionales en formato JSON';
