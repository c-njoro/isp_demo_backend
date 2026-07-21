FROM node:20-slim

# Install MySQL + FreeRADIUS + curl (for healthchecks)
RUN apt-get update && apt-get install -y \
    mysql-server \
    freeradius \
    freeradius-mysql \
    freeradius-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install Node dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy full app
COPY . .

# Build the app
RUN npm run build

# Copy FreeRADIUS config from your repo
COPY ./freeradius/raddb/ /etc/freeradius/

COPY ./mysql/isrgrootx1.pem /app/mysql/isrgrootx1.pem

# Fix FreeRADIUS permissions
RUN chown -R freerad:freerad /etc/freeradius \
    && chmod 640 /etc/freeradius/mods-config/sql/main/mysql/queries.conf 2>/dev/null || true

# Copy startup script
COPY demo-start.sh /demo-start.sh
RUN chmod +x /demo-start.sh

# Expose app port (Render handles HTTP routing here)
EXPOSE 5000

# Healthcheck for Render
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:5000/health || exit 1

CMD ["/demo-start.sh"]