
#!/bin/bash
set -e

echo "=== Starting MySQL ==="
mkdir -p /var/run/mysqld
chown mysql:mysql /var/run/mysqld
mysqld_safe --skip-grant-tables &
sleep 8

echo "=== Initializing RADIUS DB ==="
mysql -u root -e "CREATE DATABASE IF NOT EXISTS radius;" 2>/dev/null || true
mysql -u root radius < /app/freeradius/init-db/radius-schema.sql 2>/dev/null || true
mysql -u root -e "CREATE USER IF NOT EXISTS 'radius'@'localhost' IDENTIFIED BY 'radius';" 2>/dev/null || true
mysql -u root -e "GRANT ALL ON radius.* TO 'radius'@'localhost';" 2>/dev/null || true
mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || true

echo "=== Starting FreeRADIUS ==="
freeradius -f &
sleep 3

echo "=== Starting Node App ==="
exec node dist/server.js

