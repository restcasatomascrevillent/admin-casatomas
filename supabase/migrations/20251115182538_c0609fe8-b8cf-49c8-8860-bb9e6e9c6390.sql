-- Habilitar RLS en la tabla Platos
ALTER TABLE public."Platos" ENABLE ROW LEVEL SECURITY;

-- Política para ver platos (público puede ver platos activos)
CREATE POLICY "Público puede ver platos activos"
ON public."Platos"
FOR SELECT
USING (activado = true);

-- Política para usuarios autenticados ver todos los platos
CREATE POLICY "Usuarios autenticados pueden ver todos los platos"
ON public."Platos"
FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Política para crear platos
CREATE POLICY "Usuarios autenticados pueden crear platos"
ON public."Platos"
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- Política para actualizar platos
CREATE POLICY "Usuarios autenticados pueden actualizar platos"
ON public."Platos"
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

-- Política para eliminar platos
CREATE POLICY "Usuarios autenticados pueden eliminar platos"
ON public."Platos"
FOR DELETE
USING (auth.uid() IS NOT NULL);