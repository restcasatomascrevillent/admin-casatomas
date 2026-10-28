# Reglas para Claude en este repo (panel de Casa Tomás)

Proceso completo: [docs/PROCESO-DE-CAMBIOS.md](docs/PROCESO-DE-CAMBIOS.md). Obligatorio:

- **Rama `staging`.** Nunca hagas push a `main`, nunca fusiones un PR, nunca `push --force`. Producción solo cambia cuando el dueño acepta en GitHub el PR `staging → main`, que se abre solo al subir a `staging`.
- **Autor de los commits:** `git -c user.name=Claude -c user.email=noreply@anthropic.com commit …`. El plan Hobby de Vercel bloquea los commits de autores con cuenta de Vercel que no son del equipo.
- **Antes de subir:** `npm test`, `npm run test:cheques:db` y `npm run build` en verde; si tocas SQL, también las pruebas PGlite que correspondan (ver `.github/workflows/ci.yml`).
- **Supabase:** demo `sfonaclosuafvlhutkon` primero. Producción `haqmmdfdzzatdnrrcgez` **solo** después de que el dueño acepte el PR y lo pida explícitamente. El proyecto viejo `jeamoczmbfsnwkfjxcyo` no se toca. Migraciones en `supabase/migrations/`.
- **Después de subir a `staging`:** comprueba que Vercel publica la demo (estado READY) y dile al dueño qué probar en ella y en qué versión está.
- **Versión:** la calcula `scripts/version.mjs`. No edites `versionado.json` salvo que el dueño pida cambiar de mayor.
