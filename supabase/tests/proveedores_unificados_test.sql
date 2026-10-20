set client_encoding = 'UTF8';
-- ===========================================================================
-- Pruebas de 20261007180000_proveedores_unificados.sql
-- SQL plano con ASSERT dentro de BEGIN … ROLLBACK: no deja nada escrito.
-- DESPUÉS de aplicar la migración, POR TERMINAL:
--   npx supabase db query --linked -f supabase/tests/proveedores_unificados_test.sql
-- Si termina sin ERROR e imprime «proveedores_unificados_test: OK», todo ha pasado.
-- (Las secuencias no se deshacen: tras la prueba, los id de proveedores y
-- facturas saltan unos números. Es normal.)
--
-- Cubre:
--   T1 carga inicial: Joselito (albarán 38 + factura 44) y Angelmar unidos;
--      normalizar_proveedor traduce alias al nombre canónico.
--   T2 CIF con/sin guion y con «ES»: un nombre nuevo con el CIF de
--      Flopeinversiones va a Flopeinversiones y su nombre pasa a alias.
--   T3 el cliente (MASIDE 2011 S.L., B54583356) nunca es proveedor; su CIF en
--      un documento no decide nada.
--   T4 documento de un proveedor desconocido: lo crea (con CIF) y los
--      siguientes, por nombre o por CIF, van al mismo; un proveedor sin CIF
--      lo completa; cambiar el texto del proveedor reasigna; un proveedor_id
--      puesto a mano se respeta.
--   T5 permisos: anon no ejecuta las RPC y normalizar_proveedor no le falla;
--      sin la sección no ve nada; con VISTA lee pero no cambia.
--   T6 con EDICIÓN: fusionar (documentos, alias, CIF extra, borra el otro) y
--      editar (renombrar arrastra los documentos; colisiones y cliente → error).
--   T7 duplicados: verificar_duplicado_factura y el UNIQUE siguen igual.
-- ===========================================================================

begin;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c601', 'test-proveedores-vista@rls.local'),
  ('00000000-0000-0000-0000-00000000c602', 'test-proveedores-edicion@rls.local'),
  ('00000000-0000-0000-0000-00000000c603', 'test-proveedores-sin-seccion@rls.local');
insert into public.user_permissions (user_id, section_key, can_view, can_edit) values
  ('00000000-0000-0000-0000-00000000c601', 'facturas', true, false),
  ('00000000-0000-0000-0000-00000000c602', 'facturas', true, true);

-- ---------------------------------------------------------------------------
-- T1 carga inicial
-- ---------------------------------------------------------------------------
do $$
declare
  v_jos bigint := (select id from public.proveedores where cif_normalizado = 'A87934337');
begin
  assert v_jos is not null, 'T1a: falta Cárnicas Joselito (A87934337)';
  assert public.normalizar_proveedor('JOSELITO (Cárnicas Joselito)') = 'carnicas joselito', 'T1b: joselito no se traduce';
  assert public.normalizar_proveedor('joselito') = 'carnicas joselito', 'T1c: «joselito» suelto no se traduce';
  assert public.normalizar_proveedor('ANGELMAR') = public.normalizar_proveedor('HEREDEROS ANGEL MARIÑO HERMO C.B. (ANGELMAR)'),
    'T1d: Angelmar no se traduce';
  assert public.normalizar_proveedor('Proveedor que no existe, S.L.') = 'proveedor que no existe', 'T1e: sin alias, lo de siempre';
  assert public.normalizar_proveedor_base('JOSELITO (Cárnicas Joselito)') = 'joselito', 'T1f: la base no traduce';
  if exists (select 1 from public.facturas where id = 38 and proveedor = 'JOSELITO (Cárnicas Joselito)') then
    assert (select proveedor_id from public.facturas where id = 38) = v_jos, 'T1g: el albarán 38 no es de Joselito';
    assert (select proveedor_normalizado from public.facturas where id = 38) = 'carnicas joselito', 'T1h: proveedor_normalizado del 38';
  end if;
  if exists (select 1 from public.facturas where id = 44 and proveedor = 'Cárnicas Joselito S.A.') then
    assert (select proveedor_id from public.facturas where id = 44) = v_jos, 'T1i: la factura 44 no es de Joselito';
  end if;
  assert not exists (select 1 from public.facturas f join public.proveedores p on p.id = f.proveedor_id
                      where f.proveedor_normalizado is distinct from p.nombre_normalizado),
    'T1j: proveedor_normalizado no cuadra con el proveedor';
  assert (select attgenerated from pg_attribute where attrelid = 'public.facturas'::regclass
             and attname = 'proveedor_normalizado') = '', 'T1k: proveedor_normalizado sigue siendo generada';
end;
$$;

-- ---------------------------------------------------------------------------
-- T2 CIF con y sin guion
-- ---------------------------------------------------------------------------
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total) values
  ('factura', 'FLOPE INVERSIONES TEST', 'b-32455032',  'TEST-PROV-T2A', date '2099-02-01', 10, 12.1),
  ('albaran', 'Flope Distribución TEST', 'ESB32455032', 'TEST-PROV-T2B', date '2099-02-02', 10, 12.1);
do $$
declare
  v_flo bigint := (select id from public.proveedores where cif_normalizado = 'B32455032');
begin
  assert v_flo is not null, 'T2a: falta Flopeinversiones';
  assert (select count(distinct proveedor_id) from public.facturas where numero_documento in ('TEST-PROV-T2A', 'TEST-PROV-T2B')) = 1
     and (select min(proveedor_id) from public.facturas where numero_documento in ('TEST-PROV-T2A', 'TEST-PROV-T2B')) = v_flo,
    'T2b: los documentos con B-32455032 / ESB32455032 no van a Flopeinversiones';
  assert exists (select 1 from public.proveedores_alias where alias_normalizado = 'flope inversiones test' and proveedor_id = v_flo),
    'T2c: el nombre nuevo no ha pasado a alias';
  assert public.normalizar_proveedor('Flope Inversiones Test') = 'flopeinversiones', 'T2d: el alias aprendido no traduce';
  assert (select proveedor_normalizado from public.facturas where numero_documento = 'TEST-PROV-T2A') = 'flopeinversiones',
    'T2e: proveedor_normalizado no es el canónico';
end;
$$;

-- ---------------------------------------------------------------------------
-- T3 el cliente nunca es proveedor
-- ---------------------------------------------------------------------------
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total) values
  ('factura', 'MASIDE 2011 S.L.', 'B54583356', 'TEST-PROV-T3A', date '2099-03-01', 10, 12.1),
  ('factura', 'Osborne',          'B-54583356', 'TEST-PROV-T3B', date '2099-03-02', 10, 12.1);
do $$
begin
  assert (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T3A') is null,
    'T3a: el cliente ha quedado como proveedor de un documento';
  assert not exists (select 1 from public.proveedores where public.proveedor_es_cliente(nombre_normalizado, cif_normalizado)),
    'T3b: el cliente está en proveedores';
  assert (select p.nombre from public.facturas f join public.proveedores p on p.id = f.proveedor_id
           where f.numero_documento = 'TEST-PROV-T3B') = 'Osborne',
    'T3c: con el CIF del cliente, el documento de Osborne no ha ido a Osborne por nombre';
  assert (select cif from public.proveedores where nombre = 'Osborne') is null, 'T3d: a Osborne se le ha puesto el CIF del cliente';
  begin
    insert into public.proveedores (nombre, cif) values ('Maside 2011, S.L.', null);
    assert false, 'T3e: se ha podido crear el cliente como proveedor';
  exception when check_violation then null;
  end;
  begin
    insert into public.proveedores (nombre, cif) values ('Otro Nombre Test', 'B-54583356');
    assert false, 'T3f: se ha podido crear un proveedor con el CIF del cliente';
  exception when check_violation then null;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- T4 proveedor nuevo: se crea solo y los siguientes van a él
-- ---------------------------------------------------------------------------
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total)
values ('factura', 'TEST PROVEEDOR NUEVO, S.L.', 'B-1234567-4', 'TEST-PROV-T4A', date '2099-04-01', 100, 121);
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total) values
  ('albaran', 'Test Proveedor Nuevo',         null,        'TEST-PROV-T4B', date '2099-04-02', 10, 12.1),
  ('albaran', 'TPN Distribución TEST',        'B12345674', 'TEST-PROV-T4C', date '2099-04-03', 10, 12.1),
  ('factura', 'Equipalia Suministros Hosteleros', 'B-12121212', 'TEST-PROV-T4D', date '2099-04-04', 10, 12.1),
  ('factura', 'Proveedor Raro Sin Cif TEST',  '372107159', 'TEST-PROV-T4E', date '2099-04-05', 10, 12.1);
do $$
declare
  v_nuevo bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T4A');
begin
  assert v_nuevo is not null, 'T4a: no se ha creado el proveedor nuevo';
  assert (select cif_normalizado from public.proveedores where id = v_nuevo) = 'B12345674', 'T4b: el nuevo no lleva su CIF normalizado';
  assert (select origen from public.proveedores where id = v_nuevo) = 'automatico', 'T4c: origen del nuevo';
  assert (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T4B') = v_nuevo, 'T4d: por nombre no va al nuevo';
  assert (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T4C') = v_nuevo, 'T4e: por CIF no va al nuevo';
  assert (select cif_normalizado from public.proveedores where nombre = 'Equipalia Suministros Hosteleros') = 'B12121212',
    'T4f: Equipalia (sin CIF) no ha completado su CIF';
  assert (select p.cif from public.facturas f join public.proveedores p on p.id = f.proveedor_id
           where f.numero_documento = 'TEST-PROV-T4E') is null, 'T4g: un «CIF» sin forma de CIF se ha guardado';
end;
$$;
-- Cambiar el texto del proveedor reasigna; un proveedor_id puesto a mano se respeta.
update public.facturas set proveedor = 'Osborne' where numero_documento = 'TEST-PROV-T4B';
do $$
begin
  assert (select p.nombre from public.facturas f join public.proveedores p on p.id = f.proveedor_id
           where f.numero_documento = 'TEST-PROV-T4B') = 'Osborne', 'T4h: al corregir el texto no se reasigna';
end;
$$;
update public.facturas set proveedor_id = (select id from public.proveedores where nombre = 'Salazones Garre')
 where numero_documento = 'TEST-PROV-T4B';
do $$
begin
  assert (select proveedor_normalizado from public.facturas where numero_documento = 'TEST-PROV-T4B') = 'salazones garre',
    'T4i: el proveedor_id puesto a mano no se respeta';
end;
$$;

-- ---------------------------------------------------------------------------
-- T5 permisos
-- ---------------------------------------------------------------------------
do $$
begin
  assert not has_function_privilege('anon', 'public.proveedores_listado()', 'execute'), 'T5a: anon ejecuta proveedores_listado';
  assert not has_function_privilege('anon', 'public.proveedores_fusionar(bigint[], bigint)', 'execute'), 'T5b: anon fusiona';
  assert not has_function_privilege('anon', 'public.proveedores_editar(bigint, text, text, text)', 'execute'), 'T5c: anon edita';
  assert not has_function_privilege('authenticated', 'public.proveedor_resolver(text, text, boolean)', 'execute'), 'T5d: resolver abierto';
  assert not has_table_privilege('anon', 'public.proveedores_alias', 'select'), 'T5e: anon lee alias';
end;
$$;

set local role anon;
do $$
begin
  assert public.normalizar_proveedor('JOSELITO (Cárnicas Joselito)') = 'joselito', 'T5f: anon no recibe lo de siempre';
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c603';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c603","role":"authenticated"}';
do $$
begin
  assert auth.uid() = '00000000-0000-0000-0000-00000000c603'::uuid, 'T5g: auth.uid() no es el usuario de prueba';
  assert (select count(*) from public.proveedores_listado()) = 0, 'T5h: sin la sección ve proveedores';
  assert public.normalizar_proveedor('joselito') = 'joselito', 'T5i: sin la sección ve alias';
  begin
    perform public.proveedores_fusionar(array[1::bigint], 2);
    assert false, 'T5j: sin la sección ha podido fusionar';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c601';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c601","role":"authenticated"}';
do $$
declare
  v_jos bigint;
begin
  select id into v_jos from public.proveedores_listado() where cif = 'A87934337';
  assert v_jos is not null, 'T5k: con vista no ve Joselito';
  assert (select documentos from public.proveedores_listado() where id = v_jos) >= 1, 'T5l: listado sin documentos';
  assert (select 'joselito' = any(l.alias) from public.proveedores_listado() l where l.id = v_jos), 'T5m: listado sin alias';
  assert public.normalizar_proveedor('joselito') = 'carnicas joselito', 'T5n: con vista no traduce alias';
  begin
    perform public.proveedores_editar(v_jos, 'Otro nombre', null, null);
    assert false, 'T5o: con vista ha podido editar';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T6 edición: fusionar y editar
-- ---------------------------------------------------------------------------
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total) values
  ('factura', 'TEST FUSION UNO S.L.', 'B11111111', 'TEST-PROV-T6A', date '2099-06-01', 10, 12.1),
  ('albaran', 'TEST FUSION DOS',      null,        'TEST-PROV-T6B', date '2099-06-02', 10, 12.1),
  ('factura', 'TEST FUSION TRES S.A.', 'A22222222', 'TEST-PROV-T6C', date '2099-06-03', 10, 12.1);

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c602';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c602","role":"authenticated"}';
do $$
declare
  v_uno  bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6A');
  v_dos  bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6B');
  v_tres bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6C');
  v_r    jsonb;
begin
  assert v_uno is not null and v_dos is not null and v_tres is not null and v_uno <> v_dos and v_dos <> v_tres,
    'T6a: los tres proveedores de prueba no se han creado separados';
  v_r := public.proveedores_fusionar(array[v_dos, v_tres], v_uno);
  assert (v_r->>'proveedores_borrados')::int = 2 and (v_r->>'documentos_movidos')::int = 2, 'T6b: fusión: ' || v_r::text;
  assert not exists (select 1 from public.proveedores where id in (v_dos, v_tres)), 'T6c: los fusionados siguen';
  assert (select count(*) from public.facturas where numero_documento like 'TEST-PROV-T6_' and proveedor_id = v_uno) = 3,
    'T6d: no todos los documentos están en el que queda';
  assert (select count(distinct proveedor_normalizado) from public.facturas where numero_documento like 'TEST-PROV-T6_') = 1,
    'T6e: las sumas por proveedor seguirían partidas';
  assert public.normalizar_proveedor('Test Fusion Dos') = 'test fusion uno', 'T6f: el nombre del fusionado no traduce';
  assert exists (select 1 from public.proveedores_alias where proveedor_id = v_uno and cif_normalizado = 'A22222222'),
    'T6g: el CIF del fusionado no ha quedado como CIF extra';
end;
$$;
reset role;

-- Documentos posteriores con el nombre o el CIF del fusionado van al que queda.
insert into public.facturas (tipo, proveedor, cif, numero_documento, fecha, subtotal, total) values
  ('albaran', 'Test Fusion Dos',      null,          'TEST-PROV-T6D', date '2099-06-04', 10, 12.1),
  ('factura', 'Nombre Distinto TEST', 'A-22222222', 'TEST-PROV-T6E', date '2099-06-05', 10, 12.1);
do $$
declare
  v_uno bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6A');
begin
  assert (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6D') = v_uno, 'T6h: por nombre del fusionado';
  assert (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6E') = v_uno, 'T6i: por CIF del fusionado';
end;
$$;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000c602';
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000c602","role":"authenticated"}';
do $$
declare
  v_uno bigint := (select proveedor_id from public.facturas where numero_documento = 'TEST-PROV-T6A');
  v_r   jsonb;
begin
  v_r := public.proveedores_editar(v_uno, 'Test Fusión Renombrado, S.L.', 'Tefure', 'b-11111111');
  assert v_r->>'nombre_normalizado' = 'test fusion renombrado', 'T6j: renombrar: ' || v_r::text;
  assert (select count(*) from public.facturas where proveedor_id = v_uno and proveedor_normalizado <> 'test fusion renombrado') = 0,
    'T6k: los documentos no han tomado el nombre nuevo';
  assert public.normalizar_proveedor('TEST FUSION UNO S.L.') = 'test fusion renombrado', 'T6l: el nombre viejo no traduce';
  assert public.normalizar_proveedor('TEFURE') = 'test fusion renombrado', 'T6m: el nombre comercial no traduce';
  begin
    perform public.proveedores_editar(v_uno, 'Joselito', null, null);
    assert false, 'T6n: se ha podido renombrar con el alias de otro proveedor';
  exception when unique_violation then null;
  end;
  begin
    perform public.proveedores_editar(v_uno, 'Test Fusión Renombrado, S.L.', null, 'A-87934337');
    assert false, 'T6o: se ha podido poner el CIF de otro proveedor';
  exception when unique_violation then null;
  end;
  begin
    perform public.proveedores_editar(v_uno, 'Test Fusión Renombrado, S.L.', null, 'B54583356');
    assert false, 'T6p: se ha podido poner el CIF del cliente';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.proveedores_fusionar(array[v_uno], v_uno);
    assert false, 'T6q: fusionar consigo mismo';
  exception when invalid_parameter_value then null;
  end;
end;
$$;
reset role;

-- ---------------------------------------------------------------------------
-- T7 duplicados: igual que antes
-- ---------------------------------------------------------------------------
do $$
declare
  v_r json;
begin
  v_r := public.verificar_duplicado_factura('TEST-PROV-T4A', 'TEST PROVEEDOR NUEVO, S.L.', date '2099-04-01', 121);
  assert (v_r->>'es_duplicado')::boolean and v_r->>'motivo' = 'numero_documento', 'T7a: por número: ' || v_r::text;
  v_r := public.verificar_duplicado_factura('OTRO-NUMERO-T7', 'TEST PROVEEDOR NUEVO', date '2099-04-01', 121);
  assert (v_r->>'es_duplicado')::boolean and v_r->>'motivo' = 'datos_coincidentes', 'T7b: por datos: ' || v_r::text;
  v_r := public.verificar_duplicado_factura('OTRO-NUMERO-T7', 'TEST PROVEEDOR NUEVO', date '2099-04-09', 121);
  assert not (v_r->>'es_duplicado')::boolean, 'T7c: falso duplicado: ' || v_r::text;
  begin
    insert into public.facturas (tipo, proveedor, numero_documento, fecha, subtotal, total)
    values ('factura', 'TEST PROVEEDOR NUEVO, S.L.', 'TEST-PROV-T4A', date '2099-04-01', 100, 121);
    assert false, 'T7d: el UNIQUE (numero_documento, proveedor) ya no salta';
  exception when unique_violation then null;
  end;
end;
$$;

select 'proveedores_unificados_test: OK' as resultado;

rollback;
