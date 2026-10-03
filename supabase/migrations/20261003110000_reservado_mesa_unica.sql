set client_encoding = 'UTF8';
-- (Primera línea a propósito: comentarios con tilde; psql en una consola de
-- Windows puede arrancar en WIN1252.)
-- ===========================================================================
-- ##                                                                       ##
-- ##          NO APLICADA: la aplica el dueño a mano (ver pasos)           ##
-- ##                                                                       ##
-- ##   Da al espacio «Reservado» de Casa Tomás UNA SOLA MESA que es la     ##
-- ##   sala entera (20 plazas) y un plano mínimo para que el editor y el   ##
-- ##   mapa de asignación puedan abrirlo. Solo INSERT: una fila en        ##
-- ##   `mesas` y una en `planos_espacio`. No toca reservas, aforo,         ##
-- ##   asignaciones ni ningún otro espacio.                                ##
-- ##                                                                       ##
-- ===========================================================================
--
-- POR QUÉ
--   El dueño (03/10/2026): el Reservado es una sala privada con UNA mesa.
--   Reservarlo = quedarse la sala entera en ese turno; no hay reparto de
--   mesas. Hoy el espacio no tiene mesas ni plano, y el sistema lo trata
--   como una sala «sin mapa»:
--     · el diálogo del kanban (ElegirMesaDialog) se cierra solo sin abrir
--       nada (sala sin mesas), así que una reserva movida al Reservado se
--       queda «pendiente de mesa» para siempre y no hay nada que asignarle;
--     · `vista_capacidad_espacios` lo marca descuadrado (0 plazas de mesa
--       frente a 20 declaradas, cuadra = false, estado `sin_mesas`).
--   El flag `caracteristicas.privada` es solo descriptivo: ningún código ni
--   función SQL lo lee (verificado con grep en src/ y supabase/).
--
-- POR QUÉ UNA MESA RESUELVE LA EXCLUSIVIDAD (no hace falta código nuevo)
--   `asignaciones_mesa` tiene el índice único
--   `uq_asignaciones_mesa_mesa_fecha_turno (mesa_id, fecha, turno)`
--   (20260926140000, aplicado en producción). Con UNA sola mesa de 20 plazas,
--   solo UNA reserva por día y turno (comida < 17:00 / cena) puede
--   «quedarse» el Reservado: la segunda recibe `MESA_OCUPADA` del RPC
--   `asignar_mesas_reserva` y el plano enseña la mesa como ocupada. No hay
--   nada que combinar (no existen otras mesas) y «Repartir» (calcular-
--   DistribucionMesas) le da la mesa a la reserva con más comensales y deja
--   el resto «pendientes de mesa».
--   LÍMITE: eso garantiza una reserva con MESA por turno. Dos reservas pueden
--   seguir teniendo `espacio_id = Reservado` en el mismo turno (la
--   sala se reparte arrastrando tarjetas y eso nunca falla), pero solo una
--   puede tener la mesa. Bloquear también la sala, el mínimo de comensales
--   y cómo cuenta para el aforo son decisiones del dueño (ver informe): NO
--   se han inventado aquí.
--
-- QUÉ CAMBIA (estado previo verificado en producción el 03/10/2026, solo SELECT)
--   espacios_reserva 78448cb5-29d2-43a2-9c39-d499d4cb2ef3: «Reservado»,
--     activa, capacidad_maxima 20, caracteristicas {"marca":"casa_tomas",
--     "privada":true}. 0 filas en `mesas` y 0 en `planos_espacio`.
--   Se inserta:
--     · mesa «Reservado» (nombre no numérico a propósito: es la sala, y los
--       avisos del panel dicen «Reservado · 20 plazas», no «1 · 20 plazas»;
--       `uq_mesas_espacio_nombre_real` solo exige que sea única en el
--       espacio y `nombresMesa.ts` no obliga a que sea un número), 20 plazas
--       (= capacidad_maxima), rectangular de 600×100 cm en la esquina
--       (1,00 m ; 1,50 m) de un plano de 8×4 m. Medidas ESTIMADAS (una mesa
--       corrida de 20 sitios): no se conocen las reales; se ajustan luego en
--       el editor.
--     · plano 8×4 m (400×200 px a 50 px/m, 32 m²) sin paredes.
--   Efecto en `vista_capacidad_espacios`: Reservado pasa a plazas_mesas 20,
--   diferencia 0, cuadra = true. El AFORO no cambia: sigue siendo la suma
--   de `capacidad_maxima` de los espacios activos por marca (el trigger
--   `validar_capacidad_reserva` no mira mesas).
--
-- PASOS (desde adminpanelct/)
--   1. npx supabase db query --linked -f supabase/migrations/20261003110000_reservado_mesa_unica.sql
--   2. npx supabase db query --linked -f supabase/tests/reservado_mesa_unica_test.sql
--   3. Abrir Super Admin → Espacios → Reservado → «Configurar Plano y Mesas»
--      para ajustar las medidas si hace falta.
--   Deshacer: supabase/rollbacks/20261003110000_reservado_mesa_unica_ROLLBACK.sql
-- ===========================================================================

begin;
set local lock_timeout = '5s';

do $$
declare
  c_espacio constant uuid := '78448cb5-29d2-43a2-9c39-d499d4cb2ef3';
  e record;
  n integer;
begin
  -- 0. El estado de partida es el verificado: si no, no seguimos a ciegas.
  select id, nombre, activa, capacidad_maxima, caracteristicas into e
    from public.espacios_reserva where id = c_espacio;
  if not found then
    raise exception 'No existe el espacio Reservado de Casa Tomás (%).', c_espacio;
  end if;
  if e.nombre <> 'Reservado'
     or e.activa is distinct from true
     or e.capacidad_maxima is distinct from 20
     or e.caracteristicas->>'marca' is distinct from 'casa_tomas'
     or e.caracteristicas->'privada' is distinct from 'true'::jsonb then
    raise exception 'El espacio Reservado ya no es el esperado (nombre %, activa %, capacidad %, caracteristicas %). Revisar antes de aplicar.',
      e.nombre, e.activa, e.capacidad_maxima, e.caracteristicas;
  end if;

  select count(*) into n from public.mesas where espacio_id = c_espacio;
  if n <> 0 then
    raise exception 'El Reservado ya tiene % mesa(s) (se esperaban 0). No se crea otra: revisar a mano.', n;
  end if;

  select count(*) into n from public.planos_espacio where espacio_id = c_espacio;
  if n <> 0 then
    raise exception 'El Reservado ya tiene plano (se esperaba ninguno). Revisar antes de aplicar.';
  end if;

  -- 1. La mesa única: la sala entera. Posición en METROS (esquina sup.
  --    izquierda sin rotar), tamaño en CM, como lee el editor (CanvasPlano).
  insert into public.mesas
    (espacio_id, nombre, capacidad, forma, ancho, alto, pos_x, pos_y, rotacion, activa, is_merged)
  values
    (c_espacio, 'Reservado', e.capacidad_maxima, 'rectangular', 600, 100, 1.00, 1.50, 0, true, false);

  -- 2. El plano mínimo: 8×4 m a 50 px/m, sin paredes.
  insert into public.planos_espacio
    (espacio_id, ancho, alto, ancho_metros, alto_metros, pixels_per_meter, metros_cuadrados, configuracion)
  values
    (c_espacio, 400.0, 200.0, 8.0, 4.0, 50, 32.0,
     '{"elementos":[],"realDimensions":{"width":8,"height":4}}'::jsonb);

  -- 3. Resultado: una mesa, 20 plazas, el espacio cuadra.
  select count(*) into n from public.mesas
   where espacio_id = c_espacio and capacidad = 20 and coalesce(activa, true) and not coalesce(is_merged, false);
  if n <> 1 then raise exception 'Tras la inserción hay % mesas activas en el Reservado (esperaba 1).', n; end if;
  if not (select cuadra from public.vista_capacidad_espacios where espacio_id = c_espacio) then
    raise exception 'vista_capacidad_espacios sigue sin cuadrar para el Reservado.';
  end if;
end;
$$;

commit;
