FROM node:18-alpine

# 1. Install system dependencies
# Using freeradius-utils to get the 'radclient' binary
RUN echo "=== Updating APK ===" && \
    apk update && \
    echo "=== Installing packages ===" && \
    apk add --no-cache dumb-init freeradius-utils && \
    echo "=== Verifying radclient ===" && \
    which radclient && \
    echo "=== Cleanup ===" && \
    rm -rf /var/cache/apk/*

# 2. Setup application directory
WORKDIR /app

# 3. Create non-root user and set permissions on WORKDIR
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown nodejs:nodejs /app

# 4. Copy package files first
COPY package*.json ./

# 5. Install dependencies
RUN npm ci --only=production && npm cache clean --force

# 6. Copy application code
COPY --chown=nodejs:nodejs . .

# 7. Security: Switch to non-root user
USER nodejs

# 8. Networking
EXPOSE 5000

# 9. Process Management
ENTRYPOINT ["dumb-init", "--"]

# 10. Start Command
CMD ["node", "server.js"]