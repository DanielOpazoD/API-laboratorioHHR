#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ ! -f .env ]]; then
  (umask 077; cp .env.example .env)
fi
chmod 600 .env
if [[ ! -t 0 ]]; then
  echo 'Ejecuta este comando en una terminal interactiva del Mac mini.' >&2
  exit 1
fi
IFS= read -r -p 'Usuario Syslab: ' syslab_user
IFS= read -r -s -p 'Contraseña Syslab: ' syslab_pass
printf '\n'
IFS= read -r -s -p 'Clave compartida con Netlify (SYSLAB_API_TOKEN del archivo privado): ' syslab_token
printf '\n'
IFS= read -r -p 'Dominio HTTPS de tu túnel ngrok: ' syslab_url
# Pass via the child's environment; never include secrets in command arguments or output.
export syslab_user syslab_pass syslab_token syslab_url
node scripts/write-mac-config.js
unset syslab_user syslab_pass syslab_token syslab_url
printf 'Configuración guardada localmente en .env (permiso 600).\n'
