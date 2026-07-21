#!/bin/bash
set -e

echo "Waiting for MySQL to be ready..."
until mysql -h"$RADIUS_DB_HOST" -u"$RADIUS_DB_USER" -p"$RADIUS_DB_PASSWORD" -e "SELECT 1" >/dev/null 2>&1; do
    sleep 2
done

echo "MySQL is ready. Schema should be auto-loaded from /docker-entrypoint-initdb.d/"