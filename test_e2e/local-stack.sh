#!/usr/bin/env bash
# Local end-to-end stack for the onboarding flow.
#
# Brings up a throwaway Postgres, migrates and seeds it, and prints the
# connection string the backend needs. Everything is local and disposable: the
# shared dev VPS is never touched, so a test run cannot disturb it.
#
#   ./test_e2e/local-stack.sh up       start + migrate + seed
#   ./test_e2e/local-stack.sh down     remove the container
#   ./test_e2e/local-stack.sh psql     open a shell on the test database
#
set -euo pipefail

NAME=boe-local-pg
PGPORT=5433
PGUSER=boe_local
PGPASS=boe_local_pw
PGDB=boe_local
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend_controller"

export DATABASE_URL="postgresql://$PGUSER:$PGPASS@127.0.0.1:$PGPORT/$PGDB"

case "${1:-up}" in
up)
    if [ -n "$(docker ps -aq -f "name=^${NAME}$")" ]; then
        docker start "$NAME" >/dev/null
    else
        docker run -d --name "$NAME" \
            -e "POSTGRES_USER=$PGUSER" -e "POSTGRES_PASSWORD=$PGPASS" -e "POSTGRES_DB=$PGDB" \
            -p "127.0.0.1:$PGPORT:5432" postgres:16-alpine >/dev/null
    fi

    printf 'waiting for postgres'
    for _ in $(seq 1 60); do
        if docker exec "$NAME" pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null 2>&1; then
            printf ' ready\n'
            break
        fi
        printf '.'
        sleep 1
    done
    docker exec "$NAME" pg_isready -U "$PGUSER" -d "$PGDB" >/dev/null

    echo "running migrations"
    (cd "$BACKEND" && node --env-file-if-exists=.env --import=tsx src/scripts/migrate.ts up)
    echo "seeding roles, permissions, consent documents and the admin login"
    (cd "$BACKEND" && node --env-file-if-exists=.env --import=tsx src/scripts/seedAuth.ts)
    echo
    echo "DATABASE_URL=$DATABASE_URL"
    ;;
down)
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    echo "removed $NAME"
    ;;
psql)
    shift
    docker exec -i "$NAME" psql -U "$PGUSER" -d "$PGDB" "$@"
    ;;
*)
    echo "usage: $0 {up|down|psql}" >&2
    exit 2
    ;;
esac
