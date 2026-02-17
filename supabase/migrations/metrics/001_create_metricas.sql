-- Crear tabla de métricas
CREATE TABLE IF NOT EXISTS public.metricas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tipo TEXT NOT NULL,
    valor NUMERIC NOT NULL,
    unidad TEXT,
    fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    usuario_id UUID,
    entidad_tipo TEXT,
    entidad_id TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para mejorar el rendimiento de consultas
CREATE INDEX IF NOT EXISTS idx_metricas_tipo ON public.metricas(tipo);
CREATE INDEX IF NOT EXISTS idx_metricas_fecha ON public.metricas(fecha);
CREATE INDEX IF NOT EXISTS idx_metricas_usuario_id ON public.metricas(usuario_id);
CREATE INDEX IF NOT EXISTS idx_metricas_entidad ON public.metricas(entidad_tipo, entidad_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_metricas_updated_at
    BEFORE UPDATE ON public.metricas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Habilitar Row Level Security (RLS)
ALTER TABLE public.metricas ENABLE ROW LEVEL SECURITY;

-- Política para permitir lectura a usuarios autenticados
CREATE POLICY "Permitir lectura a usuarios autenticados"
    ON public.metricas
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Política para permitir inserción a usuarios autenticados
CREATE POLICY "Permitir inserción a usuarios autenticados"
    ON public.metricas
    FOR INSERT
    WITH CHECK (auth.role() = 'authenticated');

-- Política para permitir actualización a usuarios autenticados
CREATE POLICY "Permitir actualización a usuarios autenticados"
    ON public.metricas
    FOR UPDATE
    USING (auth.role() = 'authenticated');

-- Comentarios de documentación
COMMENT ON TABLE public.metricas IS 'Tabla para almacenar métricas del sistema';
COMMENT ON COLUMN public.metricas.tipo IS 'Tipo de métrica: visitas, ventas, rendimiento, etc.';
COMMENT ON COLUMN public.metricas.valor IS 'Valor numérico de la métrica';
COMMENT ON COLUMN public.metricas.unidad IS 'Unidad de medida: euros, unidades, ms, etc.';
COMMENT ON COLUMN public.metricas.entidad_tipo IS 'Tipo de entidad relacionada: espacio, reserva, producto, etc.';
COMMENT ON COLUMN public.metricas.entidad_id IS 'ID de la entidad relacionada';
COMMENT ON COLUMN public.metricas.metadata IS 'Datos adicionales en formato JSON';
