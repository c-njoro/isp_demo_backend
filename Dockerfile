# Builder stage
FROM node:18-alpine AS builder
WORKDIR /build
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Final stage
FROM node:18-alpine

RUN apk update && \
    apk add --no-cache dumb-init bash curl openssl freeradius-utils shadow python3 py3-pip && \
    rm -rf /var/cache/apk/*

RUN pip3 install --no-cache-dir --break-system-packages netmiko

RUN groupadd -g 987 skylink-app && \
    useradd -u 999 -g 987 -s /bin/false -M skylink-app

WORKDIR /app

COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/dist ./dist

COPY --from=builder --chown=skylink-app:skylink-app /build/services/olt/python /app/dist/python

COPY --from=builder /build/node_modules/pdfkit/js/data /app/dist/data

# Copy static assets (PNG for PDFs)
COPY --from=builder /build/public ./public

RUN chown -R skylink-app:skylink-app /app

EXPOSE 5000
ENTRYPOINT ["dumb-init", "--"]
USER skylink-app

CMD ["node", "dist/server.js"]