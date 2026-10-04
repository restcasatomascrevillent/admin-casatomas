# Smoke post-despliegue: condiciones de reserva + newsletter en la reserva web

Comprobación MANUAL en producción, para hacer **una vez** justo después de
desplegar. Nadie la ejecuta automáticamente. Crea 2 reservas de prueba (y 1
suscriptor) con TU email y al final las borra. Tarda unos 15 minutos.

> Qué demuestra: que la función `reservas-web` desplegada exige
> `acepta_condiciones`, guarda `consentimiento_newsletter` y
> `condiciones_aceptadas_at`, y que el alta en `newsletter_suscriptores` es de
> **doble opt-in** (migración 20261003184500): al reservar NO se da de alta a
> nadie; el alta llega cuando el cliente pulsa «Confirmo» en el correo de su
> reserva (`reservas.email_verificado_at`), y solo si marcó la casilla.

## 0. Antes de empezar

Orden de despliegue (si algo de esto falta, para aquí):

1. Migraciones aplicadas, en el orden de
   `docs/funcionalidades/newsletter-resend-marketing.md` (sección 9):
   20261003143000 (ya aplicada) → 20261003171500 → 20261003184500.
2. Test SQL en verde (no deja datos, todo va en `BEGIN … ROLLBACK`):
   `npx supabase db query --linked -f supabase/tests/consentimiento_newsletter.test.sql`
   → si termina **sin `ERROR`**, ha pasado (exige 184500: A0 lo comprueba).
3. Funciones desplegadas: `npx supabase functions deploy reservas-web emails-reserva`
   (`emails-reserva` es la que marca el email como verificado cuando el cliente
   pulsa «Confirmo»).
4. El interruptor de transición **NO** está puesto (si no, la casilla no se exige):
   `npx supabase secrets list` → no debe aparecer `RESERVAS_WEB_CONDICIONES_OBLIGATORIAS`.
   (Si aparece y la web ya manda la casilla: `npx supabase secrets unset RESERVAS_WEB_CONDICIONES_OBLIGATORIAS`.)
5. Orden obligatorio: las funciones se despliegan DESPUÉS de 171500 y 184500
   (antes, el trigger antiguo de 20261003143000 suscribiría en el INSERT sin
   verificar; `reservas-web` trae una salvaguarda, pero no se cuenta con ella).
   Y la web publicada tiene que mandar `acepta_condiciones` (casa-tomas-story
   con las casillas): si no, todas las reservas web dan 400.

Hazlo en un momento tranquilo: las reservas de prueba aparecen unos minutos
como «pendiente» en el panel (con la campana). El canal web NO manda correo
al cliente en el alta; el único correo que recibirás es el «Confirma tu
reserva» del paso 6, cuando la verifiques tú desde el panel.

## 1. Variables

Abre **Git Bash** (los comandos son `bash`) en la raíz de `adminpanelct`:

```bash
# URL del proyecto y clave PÚBLICA (la misma que usa la web: VITE_SUPABASE_URL y
# VITE_SUPABASE_PUBLISHABLE_KEY del .env de casa-tomas-story). Nunca la service role.
export SUPABASE_URL="https://<ref-del-proyecto>.supabase.co"
export ANON_KEY="<publishable key>"

# TU email, con +alias para poder filtrarlo y borrarlo luego (Gmail lo admite).
export EMAIL_SMOKE_1="tuemail+smoke-consent-1@gmail.com"   # marcará la newsletter
export EMAIL_SMOKE_2="tuemail+smoke-consent-2@gmail.com"   # NO la marcará

# Un día ABIERTO dentro de la antelación permitida (ni hoy ni mañana) y una hora
# libre de comida. Compruébalo con el paso 2.
export FECHA_SMOKE="2026-10-20"
export HORA_SMOKE="13:00"
export URL_RW="$SUPABASE_URL/functions/v1/reservas-web"
```

## 2. ¿Hay hueco ese día? (solo lectura)

```bash
curl -sS -X POST "$URL_RW/disponibilidad" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -d "{\"fecha\":\"$FECHA_SMOKE\",\"numero_comensales\":2}" | head -c 1500; echo
```

Busca un objeto `"kind":"hueco"` con `"hora":"$HORA_SMOKE"` y `"estado":"libre"`.
Si no lo hay, cambia `FECHA_SMOKE`/`HORA_SMOKE`.

## 3. Sin la casilla obligatoria → 400 y no se guarda NADA

```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST "$URL_RW/crear" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -d "{\"nombre\":\"SMOKE consentimiento 0\",\"telefono\":\"+34 600000000\",\"email\":\"$EMAIL_SMOKE_1\",\"fecha\":\"$FECHA_SMOKE\",\"hora\":\"$HORA_SMOKE\",\"numero_comensales\":2,\"notas_cliente\":\"SMOKE-CONSENTIMIENTO\",\"estado\":\"pendiente\",\"consentimiento_newsletter\":true}"
```

Esperado: `HTTP 400` y `"error":"condiciones_no_aceptadas"`.

> Si sale **201**, el interruptor está puesto (paso 0.4) o la función
> desplegada es la antigua. Para, y borra esa reserva con el paso 8.

## 4. Las dos casillas marcadas → 201 (y todavía SIN alta: falta confirmar el email)

```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST "$URL_RW/crear" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -d "{\"nombre\":\"SMOKE consentimiento 1\",\"telefono\":\"+34 600000001\",\"email\":\"$EMAIL_SMOKE_1\",\"fecha\":\"$FECHA_SMOKE\",\"hora\":\"$HORA_SMOKE\",\"numero_comensales\":2,\"notas_cliente\":\"SMOKE-CONSENTIMIENTO\",\"estado\":\"pendiente\",\"acepta_condiciones\":true,\"consentimiento_newsletter\":true}"
```

Esperado: `HTTP 201` y `{"ok":true,"reserva_id":"…","estado":"pendiente"}`.

## 5. Solo la obligatoria → 201 y SIN alta en la newsletter

```bash
curl -sS -w "\nHTTP %{http_code}\n" -X POST "$URL_RW/crear" \
  -H "Content-Type: application/json" -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY" \
  -d "{\"nombre\":\"SMOKE consentimiento 2\",\"telefono\":\"+34 600000002\",\"email\":\"$EMAIL_SMOKE_2\",\"fecha\":\"$FECHA_SMOKE\",\"hora\":\"$HORA_SMOKE\",\"numero_comensales\":2,\"notas_cliente\":\"SMOKE-CONSENTIMIENTO\",\"estado\":\"pendiente\",\"acepta_condiciones\":true,\"consentimiento_newsletter\":false}"
```

Esperado: `HTTP 201`.

## 6. Confirmar el email (doble opt-in)

1. Comprueba primero con el SQL del paso 7 que **todavía no hay ningún
   suscriptor** de los dos emails (la casilla sola no da de alta).
2. En el panel, Reservas → «SMOKE consentimiento 1» → **Verificar/Aceptar**.
   Llega a `EMAIL_SMOKE_1` el correo «Confirma tu reserva»: pulsa **«Confirmo»**.
3. Haz lo mismo con «SMOKE consentimiento 2» (pulsa «Confirmo» en el correo de
   `EMAIL_SMOKE_2`): verifica el email, pero como no marcó la casilla, no se le
   da de alta.
4. Ojo: si pasas una reserva a «Confirmada» a mano desde el panel, NO cuenta
   como email verificado y no hay alta (es lo esperado).

## 7. Comprobación en la base de datos

Guarda esto como `smoke-check.sql` (cambia los dos emails) y ejecútalo con
`npx supabase db query --linked -f smoke-check.sql` (o pégalo en el SQL editor):

```sql
-- Reservas de prueba: deben salir 2 (la del paso 3 NO existe).
select id, nombre, email, canal, estado, consentimiento_newsletter, condiciones_aceptadas_at,
       email_verificado_at, created_at
from public.reservas
where notas_cliente = 'SMOKE-CONSENTIMIENTO'
order by created_at;

-- Suscriptores: antes del paso 6.2, NINGUNO. Después, SOLO el email 1, activo,
-- origen_alta = 'reserva_web', fecha_consentimiento = created_at de su reserva,
-- reserva_consentimiento_id = id de su reserva y fecha_verificacion_email = email_verificado_at.
select s.email, s.activo, s.origen_alta, s.fecha_consentimiento, s.reserva_consentimiento_id,
       s.fecha_verificacion_email, r.id as reserva_id, r.created_at as reserva_created_at,
       (s.reserva_consentimiento_id = r.id and s.fecha_consentimiento = r.created_at
        and s.fecha_verificacion_email = r.email_verificado_at) as prueba_ok
from public.newsletter_suscriptores s
left join public.reservas r on r.id = s.reserva_consentimiento_id
where s.email in ('tuemail+smoke-consent-1@gmail.com', 'tuemail+smoke-consent-2@gmail.com');
```

Debe verse:

| comprobación | esperado |
|---|---|
| reservas `SMOKE-CONSENTIMIENTO` | 2 filas, `canal = web`; `estado = pendiente` antes del paso 6 y `confirmada` después |
| «SMOKE consentimiento 1» | `consentimiento_newsletter = true`, `condiciones_aceptadas_at` con fecha, `email_verificado_at` con fecha tras pulsar «Confirmo» |
| «SMOKE consentimiento 2» | `consentimiento_newsletter = false`, `condiciones_aceptadas_at` con fecha |
| suscriptores antes del paso 6.2 | 0 filas |
| suscriptores después | 1 fila (email 1), `activo = true`, `origen_alta = reserva_web`, `prueba_ok = true` |

## 8. Limpieza (obligatoria)

Guarda como `smoke-limpieza.sql` (cambia los dos emails) y ejecútalo igual.
Va en transacción y comprueba que solo borra lo de la prueba:

```sql
begin;

do $$
declare n integer;
begin
  select count(*) into n from public.reservas where notas_cliente = 'SMOKE-CONSENTIMIENTO';
  if n > 3 then
    raise exception 'Hay % reservas SMOKE-CONSENTIMIENTO (esperaba 2-3): revisa antes de borrar', n;
  end if;
end $$;

-- Avisos de la campana que apunten a las reservas de prueba (antes de borrarlas).
delete from public.notificaciones_dashboard
where referencia_id::text in (
  select id::text from public.reservas where notas_cliente = 'SMOKE-CONSENTIMIENTO'
);

delete from public.newsletter_suscriptores
where email in ('tuemail+smoke-consent-1@gmail.com', 'tuemail+smoke-consent-2@gmail.com');

delete from public.reservas
where notas_cliente = 'SMOKE-CONSENTIMIENTO'
  and email in ('tuemail+smoke-consent-1@gmail.com', 'tuemail+smoke-consent-2@gmail.com');

-- Comprobación final: nada de la prueba debe quedar.
do $$
begin
  if exists (select 1 from public.reservas where notas_cliente = 'SMOKE-CONSENTIMIENTO')
     or exists (select 1 from public.newsletter_suscriptores where email like '%+smoke-consent-%') then
    raise exception 'Quedan datos de la prueba';
  end if;
end $$;

commit;
```

## 9. (Opcional) La web de verdad

Con casa-tomas-story desplegado, en la portada:

1. Abre DevTools → Red, filtra por `crear`.
2. Rellena el formulario SIN marcar «Acepto las condiciones…» y pulsa Reservar:
   no debe salir ninguna petición `crear` y la casilla se pinta en rojo.
3. Pulsa «condiciones de reserva» y «Ver condiciones de la newsletter»: se abren en
   pestaña nueva en `/condiciones#reservas` y `/condiciones#newsletter`, y la
   casilla NO se marca.
4. Si haces una reserva real de prueba, mira el `Payload` de `crear`:
   `acepta_condiciones: true` y `consentimiento_newsletter: true/false` (booleanos,
   no texto). Luego bórrala con el paso 8 (cambiando el filtro por su email).

## Si algo falla

| síntoma | causa probable | qué hacer |
|---|---|---|
| paso 3 da 201 | interruptor `RESERVAS_WEB_CONDICIONES_OBLIGATORIAS=false` puesto, o función antigua | `secrets list` / redeploy; borrar con el paso 8 |
| hay suscriptor justo después del paso 4 (sin confirmar) | 184500 sin aplicar (sigue el alta en el INSERT) | aplicar 171500 y 184500; volver a ejecutar el test SQL |
| tras pulsar «Confirmo» no hay suscriptor | `email_verificado_at` vacío: `emails-reserva`/`reservas-web` sin desplegar, o la reserva se confirmó a mano | redeploy de las dos funciones y repetir con una reserva nueva; si `email_verificado_at` tiene fecha, ejecutar el test SQL (A0 dice si faltan los triggers) |
| `condiciones_aceptadas_at` NULL con la casilla marcada | migración sin aplicar (la función guarda sin esa columna y lo avisa en logs: «Falta la columna reservas.condiciones_aceptadas_at») | aplicar la migración |
| paso 4/5 da 409/422 | sin hueco, día cerrado o límite por teléfono/email | otra fecha/hora (paso 2) |
| 401 | `ANON_KEY` mal copiada | revisar la clave pública |
