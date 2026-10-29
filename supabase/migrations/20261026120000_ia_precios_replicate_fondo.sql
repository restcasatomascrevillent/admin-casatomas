-- Tarifa de Replicate para recortar-fondo-vino (quitar el fondo de la foto de la botella).
--
-- PASOS (NO APLICADA; la aplica el orquestador/dueño):
--   1. Probar: supabase db query --linked -f supabase/tests/ia_precios_replicate_fondo_test.sql
--      (BEGIN … ROLLBACK: no deja nada).
--   2. Aplicar: supabase db query --linked -f supabase/migrations/20261026120000_ia_precios_replicate_fondo.sql
--   3. Deshacer: supabase/rollbacks/20261026120000_ia_precios_replicate_fondo_ROLLBACK.sql
--
-- ia_uso solo guarda tokens: cada foto se registra como 1.000 "tokens" ficticios
-- de input del pseudo-modelo «replicate:men1scus/birefnet»; a 3,30 $/1M →
-- 0,0033 $/foto (precio medio por ejecución que publica Replicate para ese
-- modelo en A100; varía con la imagen). Sin verificar contra factura.
-- Sin esta fila la función funciona igual: solo sale el coste en NULL.
begin;
set local lock_timeout = '5s';

insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  ('replicate:men1scus/birefnet', 3.300000, null, null, 0.000000,
   'Pseudo-modelo: 1 foto = 1.000 tokens de input → 0,0033 $/foto. Lo usa recortar-fondo-vino (respaldo opcional; el camino gratis es el script local scripts/fotos-vino).',
   'Precio medio por ejecución en la ficha de Replicate (oct. 2026)', null)
on conflict (modelo) do nothing;

commit;
