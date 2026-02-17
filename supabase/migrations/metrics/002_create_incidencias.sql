-- Crear tabla de incidencias
CREATE TABLE IF NOT EXISTS public.incidencias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    titulo TEXT NOT NULL,
    descripcion TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'en_progreso', 'resuelta', 'cerrada')),
    prioridad TEXT NOT NULL DEFAULT 'media' CHECK (prioridad IN ('baja', 'media', 'alta', 'critica')),
    tipo TEXT,
    reportado_por UUID,
    asignado_a UUID,
    entidad_tipo TEXT,
    entidad_id TEXT,
    fecha_reporte TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    fecha_resolucion TIMESTAMPTZ,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para mejorar el rendimiento de consultas
CREATE INDEX IF NOT EXISTS idx_incidencias_estado ON public.incidencias(estado);
CREATE INDEX IF NOT EXISTS idx_incidencias_prioridad ON public.incidencias(prioridad);
CREATE INDEX IF NOT EXISTS idx_incidencias_tipo ON public.incidencias(tipo);
CREATE INDEX IF NOT EXISTS idx_incidencias_reportado_por ON public.incidencias(reportado_por);
CREATE INDEX IF NOT EXISTS idx_incidencias_asignado_a ON public.incidencias(asignado_a);
CREATE INDEX IF NOT EXISTS idx_incidencias_fecha_reporte ON public.incidencias(fecha_reporte);
CREATE INDEX IF NOT EXISTS idx_incidencias_entidad ON public.incidencias(entidad_tipo, entidad_id);

-- Trigger para actualizar updated_at automáticamente
CREATE TRIGGER update_incidencias_updated_at
    BEFORE UPDATE ON public.incidencias
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Trigger para establecer fecha_resolucion cuando se resuelve o cierra
CREATE OR REPLACE FUNCTION set_fecha_resolucion()
RETURNS TRIGGER AS $$
BEGIN
    IF (NEW.estado IN ('resuelta', 'cerrada') AND OLD.estado NOT IN ('resuelta', 'cerrada')) THEN
        NEW.fecha_resolucion = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_incidencias_fecha_resolucion
    BEFORE UPDATE ON public.incidencias
    FOR EACH ROW
    EXECUTE FUNCTION set_fecha_resolucion();

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.incidencias ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura a usuarios autenticados
CREATE POLICY "Permitir lectura a usuarios autenticados"
    ON public.incidencias
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Política para permitir inserción a usuarios autenticados
CREATE POLICY "Permitir inserción a usuarios autenticados"
    ON public.incidencias
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Política para permitir actualización a usuarios autenticados
CREATE POLICY "Permitir actualización a usuarios autenticados"
    ON public.incidencias
    FOR UPDATE
    USING (auth.role() = 'authenticated');

-- Comentarios de documentación
COMMENT ON TABLE public.incidencias IS 'Tabla para gestionar incidencias y problemas del sistema';
COMMENT ON COLUMN public.incidencias.titulo IS 'Título breve de la incidencia';
COMMENT ON COLUMN public.incidencias.descripcion IS 'Descripción detallada de la incidencia';
COMMENT ON COLUMN public.incidencias.estado IS 'Estado actual: abierta, en_progreso, resuelta, cerrada';
COMMENT ON COLUMN public.incidencias.prioridad IS 'Nivel de prioridad: baja, media, alta, critica';
COMMENT ON COLUMN public.incidencias.tipo IS 'Tipo de incidencia: tecnica, operativa, cliente, etc.';
COMMENT ON COLUMN public.incidencias.reportado_por IS 'ID del usuario que reportó la incidencia';
COMMENT ON COLUMN public.incidencias.asignado_a IS 'ID del usuario asignado para resolver';
COMMENT ON COLUMN public.incidencias.entidad_tipo IS 'Tipo de entidad relacionada';
COMMENT ON COLUMN public.incidencias.entidad_id IS 'ID de la entidad relacionada';
COMMENT ON COLUMN public.incidencias.fecha_resolucion IS 'Fecha en que se resolvió o cerró la incidencia';
COMMENT ON COLUMN public.incidencias.metadata IS 'Datos adicionales en formato JSON';
