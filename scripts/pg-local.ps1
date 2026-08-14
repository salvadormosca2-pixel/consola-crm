<#
.SYNOPSIS
  Postgres local portable, para desarrollo sin Docker.

.DESCRIPTION
  Este equipo no tiene Docker ni Postgres instalado, así que los binarios de
  PostgreSQL 16 viven dentro del proyecto en .pgdev\ (ignorado por git).
  No hay servicio de Windows ni nada instalado a nivel sistema: se levanta y
  se baja con este script, y se borra con  Remove-Item .pgdev -Recurse.

  Cuando tengas Docker, `docker compose up -d db redis` reemplaza esto sin
  tocar el código: la app solo mira DATABASE_URL.

.EXAMPLE
  .\scripts\pg-local.ps1 init     # crea el cluster y la base (una sola vez)
  .\scripts\pg-local.ps1 start
  .\scripts\pg-local.ps1 status
  .\scripts\pg-local.ps1 stop
#>
param(
  [Parameter(Position = 0)]
  [ValidateSet('init', 'start', 'stop', 'status', 'psql')]
  [string]$Accion = 'status'
)

$ErrorActionPreference = 'Stop'

$raiz  = Split-Path -Parent $PSScriptRoot
$bin   = Join-Path $raiz '.pgdev\pgsql\bin'
$datos = Join-Path $raiz '.pgdev\data'
$log   = Join-Path $raiz '.pgdev\postgres.log'
$pass  = Join-Path $raiz '.pgdev\.superpass'

$usuario = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'crm' }
$base    = if ($env:POSTGRES_DB)   { $env:POSTGRES_DB }   else { 'crm' }
$puerto  = if ($env:POSTGRES_PORT) { $env:POSTGRES_PORT } else { '5432' }
$clave   = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { 'crm_local_dev' }

if (-not (Test-Path (Join-Path $bin 'postgres.exe'))) {
  throw "No encuentro los binarios en .pgdev\pgsql\bin. Bajá el zip de PostgreSQL 16 para Windows x64 y descomprimilo ahí."
}

$env:PGPASSWORD = $clave

# pg_ctl deja al proceso hijo heredando la consola, así que un `& pg_ctl start`
# directo cuelga a PowerShell aunque el servidor haya arrancado bien.
function Start-Servidor {
  Start-Process -FilePath "$bin\pg_ctl.exe" `
    -ArgumentList @('-D', "`"$datos`"", '-l', "`"$log`"", '-o', "`"-p $puerto`"", '-w', 'start') `
    -NoNewWindow -Wait
}

switch ($Accion) {
  'init' {
    if (Test-Path $datos) { Write-Host "El cluster ya existe en .pgdev\data."; break }
    Set-Content -Path $pass -Value $clave -Encoding ascii -NoNewline
    # UTC en el servidor: los timestamps se guardan en UTC y se convierten en consulta.
    & "$bin\initdb.exe" -D $datos -U $usuario --pwfile=$pass -E UTF8 --locale=C -A scram-sha-256 2>&1 | Out-Null
    Remove-Item $pass -Force
    Add-Content -Path (Join-Path $datos 'postgresql.conf') -Value "`ntimezone = 'UTC'`nlog_timezone = 'UTC'"
    Start-Servidor
    & "$bin\createdb.exe" -h localhost -p $puerto -U $usuario $base
    Write-Host "Cluster creado y base '$base' lista en el puerto $puerto."
  }
  'start' {
    Start-Servidor
    Write-Host "Postgres escuchando en localhost:$puerto."
  }
  'stop' {
    & "$bin\pg_ctl.exe" -D $datos -m fast stop
  }
  'status' {
    & "$bin\pg_ctl.exe" -D $datos status
  }
  'psql' {
    & "$bin\psql.exe" -h localhost -p $puerto -U $usuario -d $base
  }
}
