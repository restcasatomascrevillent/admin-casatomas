-- Tarifas para extraer-vino-foto (búsqueda web de precio + ficha técnica).
--
-- * gpt-4.1: la lectura de la etiqueta (visión) y el precio de carta. No
--   tenía fila en ia_precios, así que su coste salía NULL.
-- * openai-web-search-call: ia_uso solo guarda tokens, así que cada llamada a
--   la herramienta web_search se registra como 1.000 "tokens" ficticios de
--   input de este pseudo-modelo; a 10 $/1M → 0,01 $ por búsqueda (tarifa
--   pública de la herramienta web_search: 10 $/1.000 llamadas). Los tokens de
--   contenido de búsqueda van en la fila de gpt-4.1-mini, a su tarifa.
-- Tarifas públicas sin verificar contra factura (verificado_en NULL).
insert into public.ia_precios
  (modelo, usd_por_m_input, usd_por_m_cached, usd_por_m_cache_write,
   usd_por_m_output, notas, fuente, verificado_en)
values
  ('gpt-4.1', 2.000000, 0.500000, null, 8.000000,
   'La usa extraer-vino-foto (visión + precio de carta).',
   'Tarifa pública de catálogo', null),
  ('openai-web-search-call', 10.000000, null, null, 0.000000,
   'Pseudo-modelo: 1 llamada a web_search = 1.000 tokens de input → 0,01 $/llamada. Lo usa extraer-vino-foto.',
   'Tarifa pública de la herramienta web_search (10 $/1.000 llamadas)', null)
on conflict (modelo) do nothing;
