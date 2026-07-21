#!/bin/bash
set -e

echo "=== Starting MySQL ==="
mkdir -p /var/run/mysqld /var/lib/mysql
chown -R mysql:mysql /var/run/mysqld /var/lib/mysql

# Initialize MySQL data directory if empty
if [ ! -d "/var/lib/mysql/mysql" ]; then
    echo "=== Initializing MySQL data directory ==="
    mysqld --initialize-insecure --user=mysql
fi

mysqld_safe --user=mysql &
sleep 5

# Wait for MySQL to be ready
echo "=== Waiting for MySQL to be ready ==="
for i in {1..30}; do
    if mysqladmin ping --silent; then
        echo "=== MySQL is ready ==="
        break
    fi
    echo "Waiting for MySQL... ($i/30)"
    sleep 2
done

echo "=== Initializing RADIUS DB ==="
mysql -u root -e "CREATE DATABASE IF NOT EXISTS radius;" 2>/dev/null || true
mysql -u root radius < /app/freeradius/init-db/radius-schema.sql 2>/dev/null || true
mysql -u root -e "CREATE USER IF NOT EXISTS 'radius'@'localhost' IDENTIFIED BY 'radius';" 2>/dev/null || true
mysql -u root -e "GRANT ALL ON radius.* TO 'radius'@'localhost';" 2>/dev/null || true
mysql -u root -e "FLUSH PRIVILEGES;" 2>/dev/null || true

echo "=== Starting FreeRADIUS ==="
freeradius -f &
sleep 3

# Verify FreeRADIUS is running
if ! pgrep -x "freeradius" > /dev/null; then
    echo "WARNING: FreeRADIUS may not have started properly"
fi

echo "=== Starting Node App ==="
exec node dist/server.js