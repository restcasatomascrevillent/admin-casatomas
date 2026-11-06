# Prompt para el agente del compañero

Copia y pega el bloque entero en una sesión nueva de tu agente, abierta en la carpeta del repo
`admin-casatomas` (rama `staging`).

```text
Vas a continuar el trabajo de la sección Facturas del panel de Casa Tomás (repo
restcasatomascrevillent/admin-casatomas). Habla siempre en español.

CONTEXTO
- «El dueño» es el propietario del restaurante Casa Tomás (Crevillente) y del bar Touza; los dos
  son de MASIDE 2011 S.L.U. (CIF B54583356), que es SIEMPRE el cliente, nunca el proveedor. Solo
  él acepta el PR a producción y contesta las dudas de las facturas. Trabaja en tablet y quiere
  respuestas cortas y cambios rápidos.
- Facturas lee con IA las facturas y albaranes de ~170 proveedores, las guarda con sus líneas,
  clasifica los productos y muestra el gasto (pestañas Análisis · Compras · Cargar).
- La demo tiene el histórico completo (~1.900 documentos, 1,4 M€). Producción aún no: espera al PR.

LEE EN ESTE ORDEN ANTES DE TOCAR NADA
1. CLAUDE.md y docs/PROCESO-DE-CAMBIOS.md
2. docs/facturas/README.md (documento maestro: arquitectura, reglas, estado, pendientes, trampas)
3. docs/facturas/CONOCIMIENTO-OCR.md (cómo se enseña al OCR a leer cada proveedor)
4. conocimiento-facturas/FORMATO-FICHA.md y conocimiento-facturas/fichas/RESUMEN.md (por encima)
5. conocimiento-facturas/correcciones/INFORME.md y conocimiento-facturas/clasificacion/REPASO.md
6. supabase/functions/procesar-factura/{index,indicaciones,prompts}.ts y supabase/rollbacks/README.md

REGLAS (sin excepciones)
- Trabaja en la rama staging o en una rama tuya que se fusione en staging. Nunca push a main, nunca
  fusionar PR, nunca push --force, nunca rebase de lo publicado.
- Commits con: git -c user.name=Claude -c user.email=noreply@anthropic.com commit
  (también los merges; si no, Vercel Hobby bloquea el despliegue).
- Nunca git add -A ni git clean: añade solo tus ficheros.
- Supabase: primero la demo (sfonaclosuafvlhutkon). Producción (haqmmdfdzzatdnrrcgez) solo
  cuando el dueño haya aceptado el PR y diga «sí» explícitamente. El proyecto jeamoczmbfsnwkfjxcyo
  no se toca.
- Migraciones: número nuevo sin repetir, idempotentes, con rollback en supabase/rollbacks/ y su fila
  en el README; se aplican con «supabase db query --linked -f …», nunca db push ni migration repair.
- RLS siempre con (select can_read_section('facturas')). Nada en el cliente que descargue las
  ~12.500 líneas: los cálculos van en SQL.
- Originales solo en Google Drive; Supabase Storage solo temporal.
- Nunca inventes ni «arregles» un importe: lo impreso manda; si no cuadra, alerta.
- Nunca pidas, pegues ni guardes claves o tokens; los secretos los pone el dueño en Supabase.
- No metas PDF, fotos de facturas ni IBAN en el repo.

CÓMO VERIFICAR
- npm test, npm run test:cheques:db y npm run build en verde antes de subir.
- SQL: test en supabase/tests/*_test.sql dentro de BEGIN … ROLLBACK, ejecutado en la demo.
- Cifras: el tablero tiene que cuadrar con SQL directo (conocimiento-facturas/correcciones/
  verificar_tablero.sql). Cualquier cambio de lectura se comprueba contra el PDF original.
- Tras subir a staging: la demo de Vercel en READY y di al dueño qué probar y en qué versión.

EN QUÉ SEGUIR (por prioridad)
1. Que el OCR use las fichas de proveedor (CONOCIMIENTO-OCR.md §6): primero notas_ia de los
   proveedores con más errores; luego guía por proveedor en dos pasos y validación contra la ficha.
2. Rediseñar variacion_precios_agente (tarda ~50 s en la demo).
3. Preparar el paso a producción de Facturas (README §7): lista de migraciones, funciones y scripts
   de datos, con la traducción de ids de aplicar_clasificacion.sql. NO lo ejecutes sin el «sí».
4. Pendientes de datos: factura 520 de Narejos (mirar IMG_1153.png en Drive) y aviso de CIF de la 2158.
5. Volúmenes (docs/facturas/VOLUMENES.md): completar a mano las cajas sin nº de botellas que salen
   «sin convertir» y una pantalla para editar envases. Modo oscuro solo si el dueño lo pide.

Trabaja en pasos pequeños, una sola pregunta al dueño cada vez, y al acabar cada tarea resume qué
cambió, dónde está (rama y commit) y qué falta.
```
