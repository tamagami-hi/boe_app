#!/usr/bin/env bash
# Local end-to-end stack for the onboarding flow.
#
# Brings up a throwaway Postgres and a throwaway SMTP sink, migrates and seeds the
# database, and prints the connection details the backend needs. Everything is
# local and disposable: the shared dev VPS is never touched, so a test run cannot
# disturb it.
#
#   ./test_e2e/local-stack.sh up       start + migrate + seed
#   ./test_e2e/local-stack.sh down     remove the containers
#   ./test_e2e/local-stack.sh psql     open a shell on the test database
#   ./test_e2e/local-stack.sh mail     list what has been delivered to the sink
#   ./test_e2e/local-stack.sh mail-clear   empty the sink
#
# Why a mail sink and not "just log it": onboarding is gated on the in-app email
# OTP. It cannot be exercised locally unless a real message is delivered somewhere
# the E2E harness can read it. Mailpit speaks SMTP, accepts any credentials, keeps
# everything in memory, and never forwards: nothing can escape to a real mailbox.
set -euo pipefail

NAME=boe-local-pg
PGPORT=5433
PGUSER=boe_local
PGPASS=boe_local_pw
PGDB=boe_local

MAILNAME=boe-local-mail
SMTP_PORT=1025
MAIL_UI_PORT=8025

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

    # Both ports bind to 127.0.0.1 only. An open relay reachable from the network
    # is not something a dev machine should be running, even a fake one.
    if [ -n "$(docker ps -aq -f "name=^${MAILNAME}$")" ]; then
        docker start "$MAILNAME" >/dev/null
    else
        docker run -d --name "$MAILNAME" \
            -p "127.0.0.1:$SMTP_PORT:1025" -p "127.0.0.1:$MAIL_UI_PORT:8025" \
            -e MP_SMTP_AUTH_ACCEPT_ANY=1 \
            -e MP_SMTP_AUTH_ALLOW_INSECURE=1 \
            axllent/mailpit >/dev/null
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

    printf 'waiting for the mail sink'
    for _ in $(seq 1 30); do
        if curl -fsS "http://127.0.0.1:$MAIL_UI_PORT/api/v1/info" >/dev/null 2>&1; then
            printf ' ready\n'
            break
        fi
        printf '.'
        sleep 1
    done
    curl -fsS "http://127.0.0.1:$MAIL_UI_PORT/api/v1/info" >/dev/null

    echo "running migrations"
    (cd "$BACKEND" && node --env-file-if-exists=.env --import=tsx src/scripts/migrate.ts up)
    echo "seeding roles, permissions, consent documents and the admin login"
    (cd "$BACKEND" && node --env-file-if-exists=.env --import=tsx src/scripts/seedAuth.ts)
    echo
    echo "DATABASE_URL=$DATABASE_URL"
    echo "SMTP        127.0.0.1:$SMTP_PORT  (any credentials accepted)"
    echo "Mailbox     http://127.0.0.1:$MAIL_UI_PORT"
    echo
    echo "Mail only leaves the outbox when a worker pass runs:"
    echo "  cd backend_controller && npm run worker:email:watch"
    ;;
down)
    docker rm -f "$NAME" "$MAILNAME" >/dev/null 2>&1 || true
    echo "removed $NAME and $MAILNAME"
    ;;
psql)
    shift
    docker exec -i "$NAME" psql -U "$PGUSER" -d "$PGDB" "$@"
    ;;
mail)
    # Subject + recipient of everything delivered, newest first. The bodies carry
    # one-time tokens, so they are not dumped wholesale; read an individual
    # message in the web UI, or fetch it by id from the same API.
    curl -fsS "http://127.0.0.1:$MAIL_UI_PORT/api/v1/messages?limit=50" \
        | python3 -c '
import json, sys
payload = json.load(sys.stdin)
messages = payload.get("messages", [])
if not messages:
    print("the sink is empty")
else:
    print(f'"'"'{payload.get("messages_count", len(messages))} message(s):'"'"')
    for m in messages:
        to = ", ".join(a.get("Address", "?") for a in m.get("To", []))
        print(f'"'"'  {m.get("Created", "")[:19]}  {to:<45} {m.get("Subject", "")}'"'"')
'
    echo
    echo "read a message: http://127.0.0.1:$MAIL_UI_PORT"
    ;;
mail-clear)
    curl -fsS -X DELETE "http://127.0.0.1:$MAIL_UI_PORT/api/v1/messages" >/dev/null
    echo "sink emptied"
    ;;
*)
    echo "usage: $0 {up|down|psql|mail|mail-clear}" >&2
    exit 2
    ;;
esac
