$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    python -m venv .venv
    & '.venv\Scripts\python.exe' -m pip install -r backend\requirements.txt
}
if (-not (Test-Path -LiteralPath 'node_modules\vite\bin\vite.js')) {
    npm ci
}
& '.venv\Scripts\python.exe' scripts\dev.py
