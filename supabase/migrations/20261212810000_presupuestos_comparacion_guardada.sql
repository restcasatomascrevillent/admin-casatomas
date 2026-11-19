set client_encoding = 'UTF8';
-- ===========================================================================
-- chat-facturas · presupuestos: la comparación se guarda para los seguimientos (19/11/2026)
-- ---------------------------------------------------------------------------
-- Prueba del dueño en la demo (19/11/2026, 08:22): a «dime los cinco mejores artículos para comprarle
-- a este nuevo proveedor» el chat contestó «No puedo consultar ahora los cinco mejores artículos de la
-- tarifa». comparar_presupuesto_agente se cortó dos veces por «statement timeout» (8 s del rol
-- authenticator). Con la tarifa real tarda 1,3-1,5 s en SQL y 2-4 s por PostgREST, pero se repetía en
-- CADA pregunta sobre la tarifa y con la base cargada pasó de 8 s.
--
-- Ahora chat-facturas guarda aquí el resultado de la comparación (por tarifa y descuento) y los
-- seguimientos lo leen en vez de recalcularlo. Vale 6 horas y solo el mismo día (bucle.ts).
-- Como chat_presupuestos: RLS sin políticas, solo service_role. Se borra con su tarifa (cascade).
-- Vuelta atrás: supabase/rollbacks/20261212810000_presupuestos_comparacion_guardada_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

create table if not exists public.chat_presupuestos_comparaciones (
  presupuesto_id uuid not null references public.chat_presupuestos(id) on delete cascade,
  clave          text not null,
  datos          jsonb not null,
  creado_en      timestamptz not null default now(),
  primary key (presupuesto_id, clave)
);
alter table public.chat_presupuestos_comparaciones enable row level security;
revoke all on public.chat_presupuestos_comparaciones from public, anon, authenticated;
grant all on public.chat_presupuestos_comparaciones to service_role;
comment on table public.chat_presupuestos_comparaciones is
  'Resultado de comparar_presupuesto_agente por tarifa (chat_presupuestos) y descuento: los seguimientos del chat de Facturas lo reutilizan en vez de recalcularlo (6 h, mismo día). Solo service_role.';

commit;
