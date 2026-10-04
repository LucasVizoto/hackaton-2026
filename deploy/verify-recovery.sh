#!/usr/bin/env bash
set -euo pipefail
test "$(id -u)" = 0
for program in cocapec-api cocapec-web cocapec-redis cocapec-postgres; do
    old_pid=$(supervisorctl pid "$program")
    test "$old_pid" -gt 1
    signal=TERM
    if [ "$program" = cocapec-postgres ]; then signal=INT; fi
    kill -s "$signal" "$old_pid"
    recovered=false
    for _ in $(seq 1 30); do
        new_pid=$(supervisorctl pid "$program")
        if [ "$new_pid" -gt 1 ] && [ "$new_pid" != "$old_pid" ] && supervisorctl status "$program" | grep -q ' RUNNING '; then
            recovered=true
            printf '%s recovered automatically: %s -> %s\n' "$program" "$old_pid" "$new_pid"
            break
        fi
        sleep 2
    done
    test "$recovered" = true
done
curl -fsS --retry 12 --retry-all-errors --retry-delay 2 --max-time 10 -A Cocapec-Deployment-Check/1.1 https://cocapec.lucasvizoto.com/api/v1/health/
printf '\nProcess recovery PASS.\n'
