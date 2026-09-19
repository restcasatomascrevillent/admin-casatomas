-- Reconstruida desde supabase_migrations.schema_migrations (version 20260208164215).
-- Se aplico directamente sobre el proyecto (dashboard / MCP) y nunca se exporto a
-- este repositorio, lo que dejaba a `supabase db push` con una fila de historial sin
-- fichero local ('Remote migration versions not found in local migrations directory').
-- YA ESTA APLICADA: db push no la ejecuta. Existe para que `db reset` / una branch
-- nueva reproduzcan el esquema real. No editar a mano.

-- =====================================================
-- ACCESO COMPLETO ADMIN PANEL - TABLAS FALTANTES
-- =====================================================

-- 1. PLATOS (con mayúscula)
CREATE POLICY "Authenticated users can read Platos"
ON public."Platos" FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert Platos"
ON public."Platos" FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update Platos"
ON public."Platos" FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete Platos"
ON public."Platos" FOR DELETE TO authenticated USING (true);

-- 2. VINOS
CREATE POLICY "Authenticated users can read Vinos"
ON public."Vinos" FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert Vinos"
ON public."Vinos" FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update Vinos"
ON public."Vinos" FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete Vinos"
ON public."Vinos" FOR DELETE TO authenticated USING (true);

-- 3. BEBIDAS
CREATE POLICY "Authenticated users can read Bebidas"
ON public."Bebidas" FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert Bebidas"
ON public."Bebidas" FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update Bebidas"
ON public."Bebidas" FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete Bebidas"
ON public."Bebidas" FOR DELETE TO authenticated USING (true);

-- 4. ESPACIOS_RESERVA
CREATE POLICY "Authenticated users can read espacios_reserva"
ON public.espacios_reserva FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert espacios_reserva"
ON public.espacios_reserva FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update espacios_reserva"
ON public.espacios_reserva FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete espacios_reserva"
ON public.espacios_reserva FOR DELETE TO authenticated USING (true);

-- 5. MESAS
CREATE POLICY "Authenticated users can read mesas"
ON public.mesas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert mesas"
ON public.mesas FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update mesas"
ON public.mesas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete mesas"
ON public.mesas FOR DELETE TO authenticated USING (true);

-- 6. AREAS_TRABAJO
CREATE POLICY "Authenticated users can read areas_trabajo"
ON public.areas_trabajo FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert areas_trabajo"
ON public.areas_trabajo FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update areas_trabajo"
ON public.areas_trabajo FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete areas_trabajo"
ON public.areas_trabajo FOR DELETE TO authenticated USING (true);

-- 7. NOVEDADES
CREATE POLICY "Authenticated users can read novedades"
ON public.novedades FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert novedades"
ON public.novedades FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update novedades"
ON public.novedades FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete novedades"
ON public.novedades FOR DELETE TO authenticated USING (true);

-- 8. FACTURAS
CREATE POLICY "Authenticated users can read facturas"
ON public.facturas FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert facturas"
ON public.facturas FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update facturas"
ON public.facturas FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete facturas"
ON public.facturas FOR DELETE TO authenticated USING (true);

-- 9. PRODUCTOS_FACTURA
CREATE POLICY "Authenticated users can read productos_factura"
ON public.productos_factura FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert productos_factura"
ON public.productos_factura FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update productos_factura"
ON public.productos_factura FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete productos_factura"
ON public.productos_factura FOR DELETE TO authenticated USING (true);

-- 10. PROVEEDORES
CREATE POLICY "Authenticated users can read proveedores"
ON public.proveedores FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert proveedores"
ON public.proveedores FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated users can update proveedores"
ON public.proveedores FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete proveedores"
ON public.proveedores FOR DELETE TO authenticated USING (true);
