#!/usr/bin/env bash
# ============================================================
# MetaCrypto OS — utilidades de desarrollo local.
# La base corre en Supabase local (Docker); ver docs/10 en el
# repo raíz (herramienta-berni) para la guía completa.
#
# Uso: ./scripts/dev.sh {start|stop|status|reset|env}
#   start   Levanta la pila de Supabase (Docker).
#   stop    La baja (los datos persisten en el volumen).
#   status  Muestra URLs y credenciales locales.
#   reset   BORRA la base y reaplica migraciones + seed desde cero.
#   env     Imprime las variables para pegar en apps/inbox/.env.local
# ============================================================
set -euo pipefail
cd "$(dirname "$0")/.."

cmd="${1:-help}"
case "$cmd" in
  start)  supabase start ;;
  stop)   supabase stop ;;
  status) supabase status ;;
  reset)  supabase db reset ;;
  env)    supabase status -o env ;;
  *)
    echo "uso: $0 {start|stop|status|reset|env}" >&2
    exit 1
    ;;
esac
