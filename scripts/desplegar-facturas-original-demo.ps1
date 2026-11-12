# Despliega en la DEMO (sfonaclosuafvlhutkon) la Edge Function facturas-original:
# el original de Google Drive de una factura servido con la cuenta del restaurante,
# para que la ficha del panel lo enseñe sin sesión de Google en el navegador.
#
# Uso (desde cualquier carpeta):
#   powershell -ExecutionPolicy Bypass -File scripts\desplegar-facturas-original-demo.ps1
#
# Producción NO se toca: solo después de aceptar la release y con el «sí» del dueño.
# No imprime ningún secreto: de los secretos solo mira los NOMBRES.
$ErrorActionPreference = 'Continue'
$Proyecto = 'sfonaclosuafvlhutkon'
$Funcion = 'facturas-original'

Set-Location (Split-Path -Parent $PSScriptRoot)
Write-Host "Repo: $(Get-Location)"

# 1) Secretos de Google que usa la función (los mismos que procesar-factura).
Write-Host "`n1) Compruebo que la demo tiene los secretos de Google (solo nombres)..."
$lista = npx --yes supabase secrets list --project-ref $Proyecto 2>&1 | Out-String
$faltan = @('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN') | Where-Object { $lista -notmatch "\b$_\b" }
if ($lista -match 'GOOGLE_CLIENT_ID') {
  if ($faltan.Count -eq 0) { Write-Host '   OK: estan GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y GOOGLE_REFRESH_TOKEN.' -ForegroundColor Green }
  else { Write-Host "   FALTAN: $($faltan -join ', '). Ponlos en Supabase > Edge Functions > Secrets (los mismos valores que usa procesar-factura)." -ForegroundColor Yellow }
} else {
  Write-Host '   No se pudo leer la lista de secretos (¿sesion de la CLI de Supabase?). Sigo con el despliegue.' -ForegroundColor Yellow
}

# 2) Desplegar la función (verify_jwt = true, en supabase/config.toml).
Write-Host "`n2) Despliego $Funcion en la demo..."
npx --yes supabase functions deploy $Funcion --project-ref $Proyecto
if ($LASTEXITCODE -ne 0) { Write-Host "   El despliegue fallo (codigo $LASTEXITCODE). Copia el error de arriba." -ForegroundColor Red }
else { Write-Host '   Desplegada.' -ForegroundColor Green }

# 3) Prueba rápida: sin sesión tiene que responder 401 (nunca el archivo).
Write-Host "`n3) Prueba sin sesion (debe dar 401)..."
try {
  $r = Invoke-WebRequest -Uri "https://$Proyecto.supabase.co/functions/v1/$Funcion`?id=1" -Method Get -UseBasicParsing
  Write-Host "   Respondio $($r.StatusCode): NO deberia servir nada sin sesion." -ForegroundColor Red
} catch {
  $estado = $_.Exception.Response.StatusCode.value__
  if ($estado -eq 401) { Write-Host '   OK: 401 sin sesion.' -ForegroundColor Green }
  else { Write-Host "   Respondio $estado (se esperaba 401)." -ForegroundColor Yellow }
}

Write-Host "`nListo. Prueba en la demo: Facturas > Compras > una factura con original en Drive,"
Write-Host 'en una ventana de incognito (sin sesion de Google): la imagen tiene que verse a la derecha.'
