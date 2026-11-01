set client_encoding = 'UTF8';
-- ===========================================================================
-- Orden inicial de Platos y Vinos = el que se ve hoy (2026-11-01)
-- ===========================================================================
--
-- Va justo DESPUÉS de 20261101090000_carta_orden_entero.sql (orden ya integer).
--
-- PROBLEMA: todos los platos (153) y vinos (238 '0' + 6 NULL) tenían orden 0.
-- Con 0 en todos, cada sitio desempataba a su manera: la web de producción
-- salía en el orden en que Postgres devolvía las filas y el panel por id
-- (UUID, a la vista un barajado). Al añadir id como desempate en la web (para
-- que la paginación sea estable) la carta pública se habría reordenado sola.
--
-- DECISIÓN: numerar 1..n dentro de cada categoría con el orden que ve hoy el
-- cliente, para que nada cambie hasta que el dueño reordene en
-- Gestor web › Carta › Ordenar, y panel y web enseñen lo mismo desde ya.
--   · Platos: posición de cada plato en las páginas de categoría de la web de
--     producción (https://web-casatomas.vercel.app/carta/<categoria>, leídas
--     el 2026-11-01). Los que no salen en la web (ocultos o nuevos) van detrás,
--     por id.
--   · Vinos: la web ya los pedía por orden, id → se numeran por id.
--   · Bebidas (1..30) y Cocteles (1..13) ya tenían orden: no se tocan.
-- Solo se numeran las categorías que siguen sin ordenar (todo 0 o NULL):
-- nunca pisa un orden puesto desde el panel. Se puede repetir sin efecto.
--
-- Rollback: supabase/rollbacks/20261101090100_carta_orden_sembrar_ROLLBACK.sql
-- ===========================================================================

begin;

set local lock_timeout = '5s';

do $$
begin
  if (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'Platos' and column_name = 'orden') <> 'integer'
     or (select data_type from information_schema.columns
       where table_schema = 'public' and table_name = 'Vinos' and column_name = 'orden') <> 'integer' then
    raise exception 'Abortado sin tocar nada: aplica antes 20261101090000_carta_orden_entero.sql';
  end if;
end
$$;

-- Posición de cada plato en su página de la web de producción (2026-11-01).
-- (Platos.id es text en la base de datos: se compara como texto.)
create temporary table _orden_web (id uuid primary key, pos integer not null) on commit drop;
insert into _orden_web (id, pos) values
    ('7b153dce-517e-4f31-821b-9e7d4e575549'::uuid, 1),
    ('e4ffd7d0-6234-45f2-b319-d88bf8a867fb'::uuid, 2),
    ('158ccf9e-58e1-4879-befd-9341b7ed77c4'::uuid, 3),
    ('d6f84390-f079-4a6e-80af-2e6154c632e0'::uuid, 4),
    ('742f9276-de2f-44e7-accd-e7557220ea65'::uuid, 1),
    ('7a2f049a-8502-4cd3-a311-366651e851c2'::uuid, 2),
    ('cfddefb1-b6e4-4cf2-bf8c-a2b9a5a43262'::uuid, 3),
    ('849e82ef-b94d-4945-b6b3-bbf455cc0a2c'::uuid, 4),
    ('9e8a3c23-bfe1-425a-b093-6366c7d09dd5'::uuid, 5),
    ('19a05c55-ad76-4ae7-a6f9-a4e5c71e7fc0'::uuid, 6),
    ('2fb43dcc-0ab4-4a44-934d-afdc7511c2a7'::uuid, 7),
    ('111e2e2d-5357-47c2-baf2-3e7a72ea4579'::uuid, 8),
    ('708c1a43-a1da-423b-9728-d09a7773379c'::uuid, 9),
    ('79a25c7b-360e-4e5e-be58-527942c6d389'::uuid, 1),
    ('1894380f-9d05-49e0-b5e2-944c53ae9f17'::uuid, 2),
    ('215b89c6-7696-412f-a0bb-c01c5ce613f0'::uuid, 3),
    ('5b8ae58c-2b26-4108-8c52-01b6e24dfd81'::uuid, 4),
    ('7ab4452d-bc43-4a24-a7fb-46f5478f0a04'::uuid, 5),
    ('67910e37-68fc-4534-ae03-60858c00fffd'::uuid, 6),
    ('382c28b0-f7bc-4376-b515-9a758544ef98'::uuid, 7),
    ('70196c77-9129-46a4-a51e-5f8b66ff08ec'::uuid, 8),
    ('34f555a4-1742-47df-ad91-7bc16c44e6a0'::uuid, 1),
    ('a98d37d3-44e2-4064-8cc7-32aaa2e8a51f'::uuid, 2),
    ('48d49c00-3c9f-45a3-b925-5591c9568819'::uuid, 3),
    ('1d4efe10-da06-4e17-a7c7-9f0b179352ea'::uuid, 4),
    ('9824015f-7d42-4b9f-bb0d-fd0867e5517f'::uuid, 5),
    ('172e21c0-1c80-44ce-be82-d9fb81808bd9'::uuid, 6),
    ('3bc24b89-c7d7-40fd-a126-86fe704563e3'::uuid, 7),
    ('4df7640b-5d9d-4a3e-9e8b-d11b580479ea'::uuid, 8),
    ('0d715ac6-9968-44bd-8ec1-d18a30ecd922'::uuid, 9),
    ('5255a9bd-623b-4584-b209-61c8ec3bab64'::uuid, 10),
    ('67ab87c4-6a82-4e7b-9fe8-500ad4536d68'::uuid, 11),
    ('1784dde4-2534-4bd7-83f6-8eb1371963c9'::uuid, 12),
    ('0cc31817-e8d9-45e4-bd53-41f5f1772b25'::uuid, 13),
    ('d248b77f-0b0a-4df1-813e-f0403f7d2cb6'::uuid, 14),
    ('7bc22707-a7c7-4720-ab03-0d5ce55ccf38'::uuid, 1),
    ('d100ee2d-d277-4edb-b1cb-06b67fa339bd'::uuid, 2),
    ('3cb5a13f-a1ca-4f83-8d5b-cc9675a6ff32'::uuid, 3),
    ('336ddc2f-be24-4894-9790-40cfc68afa48'::uuid, 4),
    ('01cb6bf9-14f8-4d81-aa3d-1213634790ea'::uuid, 5),
    ('177e78a7-4c1d-4e43-85db-8a6d94dc6623'::uuid, 6),
    ('59ca1afc-6a55-472a-b705-75dd69691a18'::uuid, 7),
    ('29afe945-4fae-4355-943c-7826c3077c94'::uuid, 8),
    ('ec2c9777-eaae-4df1-ba28-b22afa3e4518'::uuid, 9),
    ('9142cb1f-7e0e-4be5-a8b2-9b59579cf931'::uuid, 10),
    ('59c42ffa-4531-462b-8da3-81c431d2644e'::uuid, 11),
    ('5af47fc0-d403-4c7e-9483-755fce9df0f4'::uuid, 12),
    ('16d2c678-b259-470c-939a-c5eb0a707f33'::uuid, 13),
    ('8e7c958a-6d58-4a90-96eb-415078f6b182'::uuid, 14),
    ('066775a9-0273-4e68-8875-9ab2119a6d15'::uuid, 15),
    ('5f4574e6-4206-4c12-b360-71c9979db036'::uuid, 16),
    ('e95f6966-dfc1-4e1b-bc82-516a1fac4cb0'::uuid, 17),
    ('8dd4664d-6c42-4e73-a1a1-6366320f31d9'::uuid, 1),
    ('0621b106-3b12-4d0c-96e0-8a5f06ef444f'::uuid, 2),
    ('20dbb506-0b68-4275-b9bc-3bdfe170127d'::uuid, 3),
    ('383babb0-e229-44b8-93b8-c9a784c4f139'::uuid, 4),
    ('64526fb2-9917-482b-aa46-70056614794e'::uuid, 5),
    ('10673b54-c56a-48fa-868d-fa328fdf00ed'::uuid, 6),
    ('58b0ca85-97c3-4f0b-91ce-5281aed0dd29'::uuid, 7),
    ('6696b2c2-a7de-4cd2-af4c-320dd86a7c03'::uuid, 8),
    ('5a7024f7-7e5e-4deb-86a9-9ca60059859d'::uuid, 9),
    ('631b0f00-bf2f-4ddf-bc0d-509323a0826f'::uuid, 10),
    ('210e8fe2-a514-45e5-acda-28c23143f775'::uuid, 11),
    ('22cefa5c-772d-49b7-9c37-fbbfef356404'::uuid, 12),
    ('76123154-416a-4de8-a9da-41e2a1b8255f'::uuid, 13),
    ('8be5a8f4-3665-4840-97ad-29f53a84351d'::uuid, 14),
    ('a13b6025-ac9e-4cc2-9c34-9cb3f77900e9'::uuid, 15),
    ('8f18b98f-0865-404a-a390-9e219a067d50'::uuid, 16),
    ('97fa2f61-25b9-4ce6-b0ca-0aac33ed8ded'::uuid, 17),
    ('a586c8a4-3ee8-4295-96e0-b80ea9b50e43'::uuid, 18),
    ('a759896c-b7d3-4f33-93a2-fe5c625dfcb9'::uuid, 19),
    ('b63bb33d-bb36-437a-bb17-0a385000eae6'::uuid, 20),
    ('c72e537b-dc82-47b9-8dc6-262514fba076'::uuid, 21),
    ('1f9c653e-b296-4b03-b17b-169ce23e753d'::uuid, 1),
    ('72697bea-33f9-4a8e-8830-fa5a79bccf72'::uuid, 2),
    ('658aa082-ff42-4895-8f36-e215b0e5342f'::uuid, 3),
    ('5ca6acc1-dbc4-4b96-89e9-3d2b4cc745cd'::uuid, 4),
    ('d37fe187-1ae0-4791-9cf9-f4adcdb2489f'::uuid, 5),
    ('d69eaeb6-0e18-42be-a91c-76060a820d7b'::uuid, 6),
    ('5ca46e91-c2f1-41bc-8cb0-38863c66013e'::uuid, 7),
    ('9ffa3f5b-c7d5-42df-96b3-b05ebcb06925'::uuid, 8),
    ('a13db37e-de05-4067-9e97-ea60798b0bde'::uuid, 9),
    ('a4a35062-8c27-4ef5-9044-73bd76e0130f'::uuid, 10),
    ('e684ea45-aa88-4e56-a8d7-60b3b18e67c6'::uuid, 11),
    ('e7b520a8-ea2d-42bc-85fb-cc54c1307e3e'::uuid, 12),
    ('bc1d0f7a-9b47-4e52-919f-80e2abf7819e'::uuid, 13),
    ('11946b9c-75ab-4060-b9dc-e263e56b2789'::uuid, 14),
    ('ce85ae86-1839-4466-aedf-8a04a14f1b91'::uuid, 15),
    ('07503983-ccfa-4aa4-9dbc-3671929186e8'::uuid, 16),
    ('9ce1c0e7-cafc-4334-9b7c-a7db34f86824'::uuid, 1),
    ('1d9f94f5-b212-4f07-a550-a9d1d9af7564'::uuid, 2),
    ('5bc6dc3f-2e1f-4250-ad59-369fa4f97601'::uuid, 3),
    ('9193c979-d515-4ff4-a17a-d2a0c6d21e02'::uuid, 4),
    ('774adfc8-03e9-4a94-9e51-0e5244de7ef2'::uuid, 5),
    ('1ec95e48-25a3-4b97-bf00-9a04094ea591'::uuid, 6),
    ('75661ca0-d968-4d7a-a196-c89f5e533cda'::uuid, 7),
    ('6c5841cd-8d3f-4259-a2ad-5189b1d61480'::uuid, 8),
    ('060a66f6-ec96-4aa4-8cd2-8b57a7f625c4'::uuid, 9),
    ('024c5057-f0c2-4a45-a05c-6e93e0e409fc'::uuid, 10),
    ('1c359c37-3dec-431a-9602-d98201f1669c'::uuid, 1),
    ('35745424-2b7a-41a2-b9c0-a31fc68b0770'::uuid, 2),
    ('4453c053-35d9-4d3d-b727-299072d45722'::uuid, 3),
    ('551c0d88-7450-4933-8053-f3cf4017932f'::uuid, 4),
    ('93d222f9-9fec-4515-bedf-7231394599f8'::uuid, 5),
    ('19106abc-e451-4584-b59e-8b5155e03b25'::uuid, 6),
    ('4f4ddfd5-4934-40c5-92e7-8d18970e9d7c'::uuid, 7),
    ('4c3bbc06-8682-40c7-addb-40f098d9e131'::uuid, 8),
    ('a93f4553-eddf-4832-820e-49d9b0e21493'::uuid, 9),
    ('3af7b684-09f4-4a5e-b3f4-157bfc7046a8'::uuid, 10),
    ('6bf74726-3043-4f67-ae55-ee6544cb4d93'::uuid, 11),
    ('6d7bc7f9-0b65-4fad-b8e9-b0b4dd929895'::uuid, 12),
    ('0bab868e-60a9-4922-90db-995cc047182f'::uuid, 13),
    ('746f38fd-fb51-4305-afa4-88805d54f41c'::uuid, 14),
    ('660c36c8-510e-42e3-949a-04b44a30192b'::uuid, 1),
    ('3000489b-9a7c-4ca6-a22a-8616935bf93b'::uuid, 2),
    ('097677b4-7c34-4dab-a354-d07d04e98334'::uuid, 3),
    ('0ecfacd7-7464-46b2-a2b2-418aa5b0621a'::uuid, 4),
    ('1d8bc103-184c-4569-bd73-9664e331e53b'::uuid, 5),
    ('36b271b4-7030-4e63-a31c-52101a89f551'::uuid, 1),
    ('0142d88c-ed9d-4531-88cd-ff08d7945cf9'::uuid, 2),
    ('721030e7-c765-4f27-ab21-01802bbb5c2b'::uuid, 3),
    ('8ee9e4e9-b54e-4146-8d2b-fc33067e69b0'::uuid, 4),
    ('01d32756-b522-42f6-8f73-0c2b58d3ea5b'::uuid, 5),
    ('68af1276-c1d9-4356-8c21-bd210f4c82c7'::uuid, 6),
    ('69adc1df-2d45-4377-9af2-28c166008114'::uuid, 7),
    ('3b6a0761-e99a-4355-b762-e56133b3a891'::uuid, 8),
    ('34f6e040-5b51-4f2c-b10f-03b2160a333a'::uuid, 9),
    ('6a673794-69b7-4c76-8dd3-52ff784547fe'::uuid, 10),
    ('306d65b7-b73f-4fbb-8338-7562125c2b5c'::uuid, 11),
    ('13d77126-2a33-48c2-b08f-0d84ed5d600b'::uuid, 12);

with sin_ordenar as (
  select categoria
    from public."Platos"
   group by categoria
  having coalesce(max(orden), 0) = 0 and coalesce(min(orden), 0) = 0
), numerados as (
  select p.id,
         row_number() over (
           partition by p.categoria
           order by (w.pos is null), w.pos, p.id
         ) as n
    from public."Platos" p
    left join _orden_web w on w.id::text = p.id::text
   where exists (select 1 from sin_ordenar s where s.categoria is not distinct from p.categoria)
)
update public."Platos" p
   set orden = n.n
  from numerados n
 where n.id = p.id
   and p.orden is distinct from n.n;

with sin_ordenar as (
  select categoria
    from public."Vinos"
   group by categoria
  having coalesce(max(orden), 0) = 0 and coalesce(min(orden), 0) = 0
), numerados as (
  select v.id,
         row_number() over (partition by v.categoria order by v.orden nulls last, v.id) as n
    from public."Vinos" v
   where exists (select 1 from sin_ordenar s where s.categoria is not distinct from v.categoria)
)
update public."Vinos" v
   set orden = n.n
  from numerados n
 where n.id = v.id
   and v.orden is distinct from n.n;

commit;
