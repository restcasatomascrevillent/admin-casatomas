# Flujo CI/CD · Casa Tomás

## Ramas y entornos

- `feature/*` / `fix/*`: implementar cambios; abrir PR a `staging`.
- `staging`: integración y aceptación. El CI se ejecuta en cada push y PR. Conectar esta rama a **Vercel Preview** y asignarle un dominio fijo de staging.
- `main`: código aprobado para producción. Abrir PR **staging → main**; revisar, validar checks y fusionar solo tras aprobar las pruebas.
- No desarrollar directamente en `main`. No hacer merges inversos automáticos ni forzar pushes.

**Limitación importante:** la comprobación de promoción en Actions falla para PR a main que no vengan de staging, pero no impide que alguien con permisos pulse «merge» ni que haga un push directo si no hay reglas de protección activas. Activar Branch Protection/Rulesets en GitHub cuando el plan lo permita; exigir PR, aprobación y los checks CI.

## Vercel

1. Comprobar cuál es el proyecto Vercel conectado y que la *Production Branch* sea `main`.
2. Verificar que los pushes de `staging` generan previews y asociar un alias/dominio estable a staging. **No intercambiar los dominios de producción**.
3. Configurar variables de entorno separadas para Preview/Staging y Production (Supabase y cualquier servicio con efectos reales).
4. Nunca ejecutar pruebas de pago, facturación, reservas o envíos reales sobre datos de producción desde staging.
5. Probar completamente la versión de staging antes de fusionar el PR a main. La versión de producción se construye en su propio entorno.
6. Revisar el estado de despliegue y disponer de rollback en Vercel para incidencias.

## CI

- El workflow `.github/workflows/ci.yml` se ejecuta en PR, push a staging y push a main.
- Los jobs de tests/build son bloqueantes a nivel de workflow; las deudas heredadas de ESLint/typecheck siguen siendo no bloqueantes.
- Se incluye la comprobación de origen de promoción a main.
- En GitHub configurar los checks como **required** y exigir al menos una aprobación cuando el plan permita protección de ramas.

## Versionado semántico

Las versiones se identifican por etiquetas Git y GitHub Releases independientes para la web y el panel:

- `vMAJOR.MINOR.PATCH`; **MAJOR** rompe compatibilidad, **MINOR** añade funcionalidades compatibles, **PATCH** corrige errores.
- Primer hito sugerido: `v0.1.0` (no presuponer que hay una versión 1.0 estable).
- Una vez fusionado `staging → main` y verificado el despliegue, ejecutar en GitHub Actions el workflow «Publicar versión de producción», desde `main`, indicando `v0.1.0` o la siguiente versión.
- El workflow crea **tag y GitHub Release** en el commit de main; no despliega por sí mismo ni modifica package.json.
- Para mantener `package.json` sincronizado con la versión comercial, cambiar `version` y su lockfile en el PR a staging antes de promocionar.
- El workflow release debe existir primero en la rama predeterminada para que GitHub permita ejecutarlo manualmente. No activar una release si Vercel aún no está configurado.

## Seguridad y datos

- `adminpanelct` tenía `Reinicio` como rama predeterminada aunque `main` contiene muchos más cambios. No sustituir main por Reinicio.
- Existe un archivo `.env` versionado en la rama `Reinicio` del panel: revisar su contenido localmente, eliminar secretos del historial si procede y rotar credenciales afectadas. No imprimir ni copiar secretos.
- Para un staging auténticamente aislado, crear un proyecto Supabase de pruebas y credenciales de pasarela de pago sandbox; no basta con una URL distinta.
- Migrations de Supabase: pasar por staging con datos ficticios, respaldar antes de producción y validar compatibilidad entre versiones de ambas apps.

## Orden recomendado

1. Configurar y verificar Vercel, alias staging y variables.
2. Ejecutar CI en staging, reparar fallos bloqueantes.
3. Revisar PR staging → main.
4. Fusionar tras aprobación, comprobar deployment prod.
5. Crear tag + GitHub Release y registrar cambios.
