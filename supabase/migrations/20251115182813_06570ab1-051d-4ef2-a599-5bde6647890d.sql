-- Habilitar RLS en la tabla Bebidas
ALTER TABLE public."Bebidas" ENABLE ROW LEVEL SECURITY;

-- Políticas para Bebidas
CREATE POLICY "Público puede ver bebidas activas"
ON public."Bebidas"
FOR SELECT
USING (activado = true);

CREATE POLICY "Usuarios autenticados pueden ver todas las bebidas"
ON public."Bebidas"
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear bebidas"
ON public."Bebidas"
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar bebidas"
ON public."Bebidas"
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar bebidas"
ON public."Bebidas"
FOR DELETE
USING (auth.uid() IS NOT NULL);

-- Habilitar RLS en la tabla Vinos
ALTER TABLE public."Vinos" ENABLE ROW LEVEL SECURITY;

-- Políticas para Vinos
CREATE POLICY "Público puede ver vinos activos"
ON public."Vinos"
FOR SELECT
USING (activado = true);

CREATE POLICY "Usuarios autenticados pueden ver todos los vinos"
ON public."Vinos"
FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear vinos"
ON public."Vinos"
FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar vinos"
ON public."Vinos"
FOR UPDATE
USING (auth.uid() IS NOT NULL)
WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar vinos"
ON public."Vinos"
FOR DELETE
USING (auth.uid() IS NOT NULL);