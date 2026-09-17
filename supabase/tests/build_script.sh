#!/usr/bin/env bash
# Concatenates a test file with the shared helpers into one SQL script that
# can be pasted into any SQL console (no psql meta-commands). Usage:
#   supabase/tests/build_script.sh supabase/tests/database/01_tenant_isolation.sql > /tmp/01.sql
set -euo pipefail
test_file="$1"
helpers="$(dirname "$0")/helpers/_helpers.sql"
awk -v helpers="$helpers" '
  /^\\ir / { while ((getline line < helpers) > 0) print line; close(helpers); next }
  /^\\/    { next }
  { print }
' "$test_file"
