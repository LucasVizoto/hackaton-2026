#!/usr/bin/env bash
set -euo pipefail
for program in cocapec-postgres cocapec-redis cocapec-api cocapec-web; do
    supervisorctl status "$program" | awk '$2 != "RUNNING" {exit 1}'
done
