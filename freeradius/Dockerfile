FROM freeradius/freeradius-server:latest

# Install MySQL module and curl (for healthchecks)
RUN apt-get update -qq && \
    apt-get install -y -qq freeradius-mysql curl && \
    rm -rf /var/lib/apt/lists/*

# Copy your VPS raddb config
COPY ./raddb/ /etc/freeradius/

# Fix permissions
RUN chown -R freerad:freerad /etc/freeradius && \
    chmod 640 /etc/freeradius/mods-config/sql/main/mysql/queries.conf 2>/dev/null || true

EXPOSE 1812/udp 1813/udp 3799/udp

CMD ["freeradius", "-f"]