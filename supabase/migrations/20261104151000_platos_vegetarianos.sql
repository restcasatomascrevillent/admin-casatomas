set client_encoding = 'UTF8';
-- ===========================================================================
-- 20261104151000_platos_vegetarianos — Platos vegetarianos de la carta (04/11/2026)
-- ===========================================================================
-- Dueño (04/11/2026): «analiza la carta porque sí que tienen que haber
-- productos vegetarianos». El filtro «Vegetariano» de la web no enseñaba
-- ninguno: solo muestra los platos que el restaurante confirma como
-- vegetarianos (web-casatomas, src/lib/filtros-carta.ts, `cumpleDieta`), y la
-- web lee esa confirmación de Platos.etiquetas_dieteticas, una columna que el
-- build ya pedía (scripts/carta-ssg.mjs) pero que nunca se llegó a crear.
--
-- QUÉ HACE
--   1. Platos.etiquetas_dieteticas jsonb NULL: array de textos, solo
--      'vegetariano' y/o 'vegano' (CHECK platos_etiquetas_dieteticas_validas).
--      NULL = sin confirmar: la web no lo cuenta como vegetariano. Se cambia en
--      el panel (Gestor Web › Carta › Platos, casilla «Vegetariano»).
--   2. Marca los 19 platos de Casa Tomás que, por nombre, descripción y
--      alérgenos (análisis de la carta de la demo, copia de producción, del
--      04/11/2026), no llevan carne, pescado ni marisco. Los cuatro marcados
--      también 'vegano' (pan, ajo y tomate, fruta, espárragos) no llevan nada
--      de origen animal. Solo si el plato aún no tiene etiquetas (no pisa lo
--      que se haya puesto en el panel) y solo si el id existe.
--
-- NO SE MARCAN (que el dueño lo confirme en el panel si lo son):
--   · Helado (2 und.): los sabores cambian cada día.
--   · Caña gallega y Milhoja de hojaldre: el hojaldre puede llevar manteca de
--     cerdo.
--   · Ensaladilla rusa: lleva atún (lo dice su descripción).
--   · Alcachofa a la parrilla: lleva oreja y guanciale.
-- AVISO: los quesos curados (parmesano, oveja, trufa) suelen hacerse con cuajo
-- animal; se cuentan como vegetarianos, que es lo habitual en un restaurante.
--
-- APLICAR (una a una, nunca `db push`): demo primero (sfonaclosuafvlhutkon),
-- producción (haqmmdfdzzatdnrrcgez) solo tras aceptar el PR y con el «sí» del
-- dueño. Idempotente. Tiene que terminar en
-- «platos_vegetarianos: N platos vegetarianos».
-- Deshacer: supabase/rollbacks/20261104151000_platos_vegetarianos_ROLLBACK.sql
-- Pruebas: npm run test:vinos-copeo-encuesta:db (PGlite).
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public."Platos"') is null then
    raise exception 'platos_vegetarianos: falta public."Platos". No se ha cambiado nada.';
  end if;
end
$$;

alter table public."Platos" add column if not exists etiquetas_dieteticas jsonb;

comment on column public."Platos".etiquetas_dieteticas is
  'Dietas confirmadas por el restaurante: array con ''vegetariano'' y/o ''vegano''. NULL = sin confirmar (la web no lo filtra como vegetariano). 20261104151000.';

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public."Platos"'::regclass and conname = 'platos_etiquetas_dieteticas_validas') then
    alter table public."Platos" add constraint platos_etiquetas_dieteticas_validas check (
      etiquetas_dieteticas is null
      or (jsonb_typeof(etiquetas_dieteticas) = 'array'
          and etiquetas_dieteticas <@ '["vegetariano", "vegano"]'::jsonb)
    );
  end if;
end
$$;

update public."Platos" p
   set etiquetas_dieteticas = d.etiquetas
  from (values
    ('215b89c6-7696-412f-a0bb-c01c5ce613f0', '["vegetariano"]'::jsonb),            -- Ensalada parmesano
    ('a98d37d3-44e2-4064-8cc7-32aaa2e8a51f', '["vegetariano"]'::jsonb),            -- Revuelto de alcachofas crujientes con queso parmesano
    ('177e78a7-4c1d-4e43-85db-8a6d94dc6623', '["vegetariano", "vegano"]'::jsonb),  -- Pan de cristal
    ('5af47fc0-d403-4c7e-9483-755fce9df0f4', '["vegetariano", "vegano"]'::jsonb),  -- Ajo y tomate
    ('9142cb1f-7e0e-4be5-a8b2-9b59579cf931', '["vegetariano"]'::jsonb),            -- Queso curado de oveja
    ('16d2c678-b259-470c-939a-c5eb0a707f33', '["vegetariano"]'::jsonb),            -- Queso trufa
    ('5f4574e6-4206-4c12-b360-71c9979db036', '["vegetariano", "vegano"]'::jsonb),  -- Pan gallego
    ('1c359c37-3dec-431a-9602-d98201f1669c', '["vegetariano", "vegano"]'::jsonb),  -- Fruta
    ('35745424-2b7a-41a2-b9c0-a31fc68b0770', '["vegetariano"]'::jsonb),            -- Tarta de chocolate con galletas
    ('19106abc-e451-4584-b59e-8b5155e03b25', '["vegetariano"]'::jsonb),            -- Torrija de brioche de mantequilla con crema de turrón y helado de vainilla
    ('4f4ddfd5-4934-40c5-92e7-8d18970e9d7c', '["vegetariano"]'::jsonb),            -- Crème brûlée con helado de yema tostada
    ('4c3bbc06-8682-40c7-addb-40f098d9e131', '["vegetariano"]'::jsonb),            -- Coulant de chocolate
    ('a93f4553-eddf-4832-820e-49d9b0e21493', '["vegetariano"]'::jsonb),            -- Arroz con leche
    ('3af7b684-09f4-4a5e-b3f4-157bfc7046a8', '["vegetariano"]'::jsonb),            -- Tarta Santiago
    ('6bf74726-3043-4f67-ae55-ee6544cb4d93', '["vegetariano"]'::jsonb),            -- Flan
    ('6d7bc7f9-0b65-4fad-b8e9-b0b4dd929895', '["vegetariano"]'::jsonb),            -- Tarta de queso de cabra con helado de frambuesa
    ('0bab868e-60a9-4922-90db-995cc047182f', '["vegetariano"]'::jsonb),            -- Sorbete limón, frambuesa
    ('746f38fd-fb51-4305-afa4-88805d54f41c', '["vegetariano"]'::jsonb),            -- Coulant de pistacho con helado de yogur
    ('13d77126-2a33-48c2-b08f-0d84ed5d600b', '["vegetariano", "vegano"]'::jsonb)   -- El Navarrico Espárragos Extra
  ) as d(id, etiquetas)
 where p.id = d.id
   and p.etiquetas_dieteticas is null;

notify pgrst, 'reload schema';

do $$
declare n integer;
begin
  select count(*) into n from public."Platos" where etiquetas_dieteticas ? 'vegetariano' or etiquetas_dieteticas ? 'vegano';
  raise notice 'platos_vegetarianos: % platos vegetarianos', n;
end
$$;

commit;
