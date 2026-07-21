FROM mysql:8.0

# Copy your exported schema - will auto-run on first start
COPY ./init-db/radius_schema.sql /docker-entrypoint-initdb.d/01-radius-schema.sql

# Copy any data seed files
# COPY ./init-db/radius_seed_data.sql /docker-entrypoint-initdb.d/02-seed-data.sql

EXPOSE 3306