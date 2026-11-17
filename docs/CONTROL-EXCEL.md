# Control (Excel) — Super Admin › Gestor Gasto

Subpestaña para ver y cambiar, **sin abrir el Excel**, lo que el Excel de control
de OficiosOsIA (`Control_OFICIOSOSIA.xlsm`, en Google Drive) dice del cliente de
este panel. El mismo Excel sirve para todos los proyectos; cada panel solo ve y
toca lo de **su** cliente (aquí «Casa Tomás»).

## Qué hace

- **Estado del cliente**: instalación (pactada, cobrada, pendiente), cuota mensual
  y día de cobro, cobrado en total, pendiente de cobro y gastos por recuperar
  (repercutibles − reembolsados).
- **Ficha** (su fila de la hoja `CLIENTES`): estado, desde, instalación pactada,
  cuota pactada, día de cobro y notas. El nombre del cliente no se cambia desde aquí.
- **Cobros** (sus filas de `COBROS`): alta, edición, borrado y «Marcar cobrado»
  (cobrado = pactado, fecha de hoy, pide quién lo recibe).
- **Gastos del cliente** (sus filas de `GASTOS CLIENTES`): alta, edición y borrado.

No se ve ni se toca nada de `GASTOS NEGOCIO`, `SOCIOS`, `AJUSTES` ni de otros
clientes. Los desplegables (tipo de cobro, método, «recibido por»…) son los del
propio Excel: si se cambian allí, cambian aquí.

## Cómo funciona

`src/components/control-excel/ControlExcel.tsx` → `src/hooks/useControlExcel.ts` →
Edge Function `control-excel` (`supabase/functions/control-excel/control.ts`, solo
super admin). La función descarga el fichero de Drive, cambia **solo las celdas
necesarias dentro del XML** (`supabase/functions/_shared/xlsx-celdas.ts`) y lo sube
encima con el mismo id. No regenera el libro: fórmulas, validaciones, formato
condicional, gráficos y estilos quedan como estaban, y nunca escribe sobre una
celda con fórmula.

Lo calculado (pendiente, estado automático, «Comprobar», resumen) se calcula en la
función con las mismas reglas que las fórmulas del Excel; no se leen los valores
que el Excel tiene guardados, porque quedan viejos al escribir.

## Configuración (secretos de la función en Supabase)

| Secreto | Para qué | Por defecto |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Cuenta de Google del panel (los mismos de las facturas) | — (sin ellos: «este entorno no está conectado a Google Drive») |
| `CONTROL_EXCEL_FILE_ID` | Id del Excel en Drive | `1N-V65dStG5umn0j3gKRZzT1REzlIaciL` |
| `CONTROL_EXCEL_CLIENTE` | Nombre del cliente tal cual está en la columna A de `CLIENTES` | `Casa Tomás` |

En la **demo** no hay secretos de Google a propósito: la pestaña dice que no está
conectada. Se prueba de verdad en producción.

Despliegue (primero demo, producción solo con la release aceptada):

```bash
SUPABASE_ACCESS_TOKEN="$SUPABASE_ACCESS_TOKEN_DEMO" npx supabase functions deploy control-excel --project-ref sfonaclosuafvlhutkon
```

## Dar acceso al Excel a la cuenta del panel

1. Abre la pestaña: si el panel no puede abrir el Excel, el aviso dice **con qué
   cuenta de Google** entra el panel.
2. En Drive, comparte `Control_OFICIOSOSIA.xlsm` con esa cuenta como **Editor**
   (como «Lector» se ve todo, pero no se puede guardar: sale «Solo lectura»).
3. Ojo con el permiso del refresh token (ver «TRAMPA: el alcance drive.file» en
   [instagram-fotos.md](instagram-fotos.md)): con `drive.file` la cuenta solo ve
   los ficheros que crea el propio panel y **no** verá el Excel aunque esté
   compartido. Hace falta un token con el alcance `drive` completo. El aviso de la
   pestaña lo dice cuando es ese el caso.

## Límites que hay que conocer

- **Gana el último que guarda.** Antes de escribir se comprueba que el Excel no ha
  cambiado en Drive desde que se cargó (si cambió: «recarga y repite»). Pero si
  alguien lo tiene **abierto** en Excel o en Google Sheets y guarda después, pisa
  lo que se haya escrito desde el panel. Mejor no tenerlo abierto mientras se usa
  la pestaña.
- **Los totales del Excel se recalculan al abrirlo.** Tras escribir, el libro
  queda marcado para recalcular (`fullCalcOnLoad`): Excel y Google Sheets lo hacen
  solos. La vista previa de Drive (sin abrir) puede enseñar cifras viejas en
  `INICIO` y `MES A MES`; las de las filas del cliente sí se dejan al día.
- **Borrar deja la fila vacía** (con sus fórmulas); el siguiente alta la reutiliza.
  Las filas son las de la plantilla (7 a 506): si se llenan, hay que ampliar el
  Excel a mano.
- **Si alguien cambia las columnas** (cabeceras de la fila 6) la pestaña se niega
  a leer o escribir y lo dice, en vez de escribir en la columna equivocada.
- Añadir un **cliente nuevo** se sigue haciendo en el Excel (fila en `CLIENTES`,
  nombre en los desplegables de `COBROS` y `GASTOS CLIENTES`, cartera de `INICIO`).
- No es contabilidad fiscal: son los importes reales del control interno, como el
  propio Excel.

## Usarlo en otro proyecto

Copiar `supabase/functions/control-excel/`, `supabase/functions/_shared/xlsx-celdas.ts`,
`src/hooks/useControlExcel.ts` y `src/components/control-excel/`, y poner en ese
proyecto el secreto `CONTROL_EXCEL_CLIENTE` con el nombre de su cliente (por
ejemplo `Nexo`). El Excel es el mismo; la cuenta de Google de ese panel también
necesita ser editora.

## Pruebas

```bash
npx vitest run supabase/functions/control-excel supabase/functions/_shared/__tests__/xlsx-celdas.test.ts src/components/control-excel src/hooks/__tests__/useControlExcel.test.ts
```

La fixture `supabase/functions/control-excel/__tests__/fixtures/control-minimo.xlsx`
es una copia reducida y con importes ficticios del Excel real (ver su README).
