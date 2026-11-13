#!/bin/sh
# Run from the checkout root (Make does this). Dotenv is data, never shell code.
set -eu
fail() { echo "cloud: $*" >&2; exit 1; }
action=${1:-up}
case "$action" in up|down|logs) ;; *) fail 'expected up, down or logs' ;; esac
read_selector() {
  if [ -f .env ]; then
    awk -v key="$1" -f scripts/cloud-env.awk .env || fail "invalid $1 in .env"
  else
    printf '%s\n' __UNSET__
  fi
}
domain=${DOMAIN-$(read_selector DOMAIN)}
email=${ACME_EMAIL-$(read_selector ACME_EMAIL)}
# Ignore inherited Compose stack selection, including COMPOSE_PROJECT_NAME.
unset COMPOSE_PROJECT_NAME COMPOSE_FILE COMPOSE_PROFILES COMPOSE_ENV_FILES
if [ "$domain" = __UNSET__ ] && [ "$email" = __UNSET__ ]; then
  mode=local
  project=tuck-cloud-local
  file=compose.cloud.local.yml
  secret=.env.cloud-local.secret
  # Local credentials always belong to this stack, never an inherited production shell.
  unset JWT_SECRET POSTGRES_PASSWORD
else
  case "$domain" in ''|__UNSET__|*[!a-zA-Z0-9.-]*) fail 'set both literal DOMAIN and ACME_EMAIL for production' ;; esac
  case "$email" in ''|__UNSET__|*[!a-zA-Z0-9.@_+-]*) fail 'set both literal DOMAIN and ACME_EMAIL for production' ;; esac
  case "$email" in *@*.*) ;; *) fail 'invalid ACME_EMAIL' ;; esac
  export DOMAIN="$domain" ACME_EMAIL="$email"
  mode=production
  project=tuck-cloud
  file=compose.cloud.yml
  secret=.env.secret
fi
# Only up creates secrets. Stop/log operations must not silently create new credentials.
if [ "$action" = up ]; then
  umask 077
  for key in JWT_SECRET POSTGRES_PASSWORD; do
    if ! grep -qs "^$key=" "$secret"; then
      value=$(openssl rand -hex 32) || fail "could not generate $key"
      [ ${#value} -eq 64 ] || fail "invalid generated $key"
      printf '%s=%s\n' "$key" "$value" >> "$secret"
    fi
  done
fi
[ -f "$secret" ] || fail "missing $secret; run make cloud first"
set -- docker compose --project-name "$project"
if [ -f .env ]; then set -- "$@" --env-file .env; fi
set -- "$@" --env-file "$secret" -f "$file"
case "$action" in
  down) "$@" down ;;
  logs) "$@" logs --follow ;;
  up)
    "$@" config --quiet
    if [ "$mode" = local ]; then
      "$@" up --build --detach --wait
      echo "Tuck cloud local: http://localhost:${CLOUD_LOCAL_PORT:-8081} (demo@example.com / demo1234)"
    elif [ -z "${BUILD:-}" ] && "$@" pull --quiet api web 2>/dev/null; then
      "$@" up --detach --wait
    else
      "$@" -f compose.cloud.source.yml up --build --detach --wait
    fi
    if [ "$mode" = production ]; then
      echo "Tuck is up: https://$domain (the first certificate can take a minute)"
    fi
    ;;
esac
