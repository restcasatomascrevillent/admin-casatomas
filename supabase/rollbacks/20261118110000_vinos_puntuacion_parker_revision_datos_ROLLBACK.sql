set client_encoding = 'UTF8';
-- ROLLBACK de 20261118110000_vinos_puntuacion_parker_revision_datos.sql
-- (GENERADO por scripts/parker/generar-migracion-revision.mjs). Aplicar a mano
-- SOLO si hay que deshacerlo.
--
-- Borra las filas de la revisión (origen = 'revision') y quita la añada que se
-- sirve / «sin añada» a los vinos donde la puso la revisión, si siguen con ese
-- valor. Las filas que se hayan añadido después desde el panel (foto, búsqueda,
-- a mano) se quedan. El trigger recalcula lo que ve la web. Se puede aplicar
-- dos veces.
begin;
set local lock_timeout = '5s';

do $$
begin
  if to_regclass('public.vinos_puntuacion_parker') is null then
    raise notice 'vinos_puntuacion_parker_revision_datos: no hay tabla, nada que deshacer';
    return;
  end if;
  delete from public.vinos_puntuacion_parker where origen = 'revision';
  update public."Vinos" v
     set anada = null
    from (values
      ('5b8e3bb3-ba9d-4369-8381-c9a49b60fd44', 2021),
      ('e4ee83fb-9dda-4bb6-8a17-6787cb74d995', 2025),
      ('88f8aa7d-c413-4778-81d9-e171d33e85cb', 2025),
      ('40219f07-8a38-440e-af10-407630f8bfc4', 2023),
      ('d387d56d-f121-412b-90ef-61ec98ca68da', 2022),
      ('4c13d509-7ef6-4be0-a021-784ccda48561', 2020),
      ('d0e8cab8-6537-4fc3-84fe-77504a76054f', 2023),
      ('7fecf6c0-c005-4c11-896e-34dbc5f39f1a', 2019),
      ('c9d7c2f5-35a1-4d1e-a6b7-80c926b94569', 2023),
      ('3c4e1770-4dc1-4514-8321-5973351b8960', 2018),
      ('5feb592f-8306-41de-83ed-4fc8d2b7a1b2', 2020),
      ('30df5532-9a6e-4f04-b495-4c5a80a6e22a', 2025),
      ('82498517-d35e-408d-8817-a1ea8817849e', 2015),
      ('ce1cd5f9-1f18-46ae-85e0-bcf0307706cb', 2022),
      ('4b111dd2-a09c-458a-9885-23638c072dcb', 2024),
      ('f09fc7a2-9b1b-46d1-99f0-d9231be1c0fb', 2017),
      ('3b39fa20-7f2a-41f1-ade5-5d01e34c3092', 2003),
      ('585b9e1b-c823-47df-91d8-f5af61a59929', 2022),
      ('f8153e46-ed43-4cad-8408-86e35af479e5', 2014),
      ('b40a02b0-25d1-4d18-8198-410efa87412d', 2010),
      ('5f91a87f-f237-4a43-bba8-95629564b719', 2018),
      ('9504466d-1850-4005-89ae-2d4f4f182e73', 2024),
      ('e4f95b3e-ee28-4dec-9feb-a61c0d706394', 2022),
      ('2253d847-91c6-4c74-98ba-fb5286989600', 2024),
      ('17d35c3a-ef4c-45ea-93b1-ed4a249a08d4', 2022),
      ('918a0b90-e4e5-438a-b165-31fcaea74def', 2015),
      ('1d2c19d4-9d36-4531-ad0a-4824109b43de', 2002),
      ('5f98d412-135b-4f0d-979e-ba7c41162781', 2005),
      ('246cd25d-cf75-4eca-b2cb-72d5b5f6fb06', 2013),
      ('dda98445-1106-466c-8020-6f9ca1c49cf5', 2012),
      ('abe8371f-60c9-45ca-8218-de51d04074ff', 2015),
      ('be82c492-d6c8-409d-8be7-89346ce31f41', 2016),
      ('2dbb8e85-03cf-43a3-a815-370a4a82a982', 2018),
      ('bfc151ad-bc69-458f-a137-bd76e131cb3e', 2013),
      ('50e42c0f-8105-47f6-b94b-e2cfdb01ecfd', 2012),
      ('86aeaa2e-ecac-4910-becd-16a1f307a9d5', 2023),
      ('6658d43a-1e9f-45da-b907-2218462b7347', 2012),
      ('3d4b2c14-d41a-499b-bc6e-33b016f7dec9', 2022),
      ('52eefbc4-b1e4-490a-872d-80647b067f6a', 2017),
      ('5bcf2f8f-f152-41f7-b583-45614728e928', 2021),
      ('44fec55b-0d2a-4fcd-92a2-faf51c1e68f2', 2022),
      ('55c0d225-bb5a-424f-a3cb-a7ca81face5f', 2010),
      ('64a0b92a-2903-406c-bee5-4ee40a0333f3', 2018),
      ('de338bf4-f6e9-47b0-b933-fd3ab0e33e92', 2018),
      ('bee12e20-f39c-4941-bf06-3d41802d06c2', 2019),
      ('83ae3d93-3bcd-484c-8a1f-fe180b02c26d', 2022),
      ('6890926d-575c-4919-a807-61ae2698b208', 2015),
      ('7bc144b1-15f5-4140-b5cd-4b0bc2501ea8', 2004),
      ('f281132c-898d-4ddd-ab40-f94cd3883db6', 2005),
      ('068f7c8f-4402-45db-9423-cc60884f153c', 2021),
      ('6a8430a1-9bdc-4809-9cb9-f294ff768fa6', 2016),
      ('b92c7303-2518-49d3-9d5c-c4a8c3035d0d', 2020),
      ('db3a2a1c-861e-4ca2-aaf6-4dba66d3cdb6', 2020),
      ('c0f6c61c-e255-405d-b5a6-650b08d1e3eb', 2021),
      ('e544d689-ec89-48d2-a831-0dc916bd30af', 2024),
      ('f6a51933-16bb-4056-bfe6-71ac2f6b92e7', 2022),
      ('5e0d6555-004e-43e0-945e-16e6cbc8b0ea', 2023),
      ('d9739ae1-244c-44d1-98e4-8c80fde44a5d', 2023),
      ('04d8f2cc-6d4b-4d1a-926c-1078cd1649df', 2022),
      ('140d6263-e88b-4616-a237-92ac403c0c2c', 2021),
      ('b0d505fe-4988-4e5d-a0df-cf6c061842cc', 2023),
      ('b84ec812-c14f-4028-831e-5e50991865f3', 2024),
      ('da4630d5-8e2d-4ab7-a241-94da44d445aa', 2023),
      ('f3a262c3-0c98-469c-b71f-3d2a78644689', 2023)
    ) as d(id, anada)
   where v.id = d.id
     and v.anada = d.anada;
  update public."Vinos" set sin_anada = false where id in ('43b2eb7f-9dd5-4270-9259-d66b0f2a651a', 'd2663b49-8a8b-478b-b55a-da292c026df0', '649ee78a-0e9e-4721-9868-01ac6ce89927', '7868ec03-9e7e-4d32-8e54-92d55964824a', 'bbe44e79-bab7-4050-8fd8-55d721ee782a', 'b4536fd4-befe-4eb7-abba-4c56431d5da2', '17783f91-d738-4c0c-8a41-c804691f37d8', 'c4774b34-0897-415c-b2c5-4b3cc2cf7e3e', '0bc74b8b-a40b-42ca-b892-976b5bfd5dc8', '10be6613-ada0-4f56-9040-397322dab14e', 'a8b39469-df9b-41bd-89a5-4b9c56c95775') and sin_anada;
  raise notice 'vinos_puntuacion_parker_revision_datos: rollback aplicado';
end
$$;

commit;
