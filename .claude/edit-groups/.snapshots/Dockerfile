# syntax=docker/dockerfile:1
# todo: PocketBase serving the built PWA. Single origin, single binary.

# --- build frontend → dist/ ---
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- runtime: pocketbase + static frontend ---
FROM alpine:3.21
ARG PB_VERSION=0.28.4
ARG TARGETARCH=arm64
RUN apk add --no-cache ca-certificates unzip wget
RUN wget -qO /tmp/pb.zip \
      "https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/pocketbase_${PB_VERSION}_linux_${TARGETARCH}.zip" \
 && unzip /tmp/pb.zip -d /usr/local/bin/ \
 && rm /tmp/pb.zip \
 && chmod +x /usr/local/bin/pocketbase
COPY --from=frontend /app/dist /app/pb_public
COPY pb_migrations /app/pb_migrations
EXPOSE 8090
# pb_data is a volume. PB_ENCRYPTION_KEY must be set (see compose .env).
ENTRYPOINT ["/usr/local/bin/pocketbase", "serve", \
  "--http=0.0.0.0:8090", \
  "--dir=/app/pb_data", \
  "--publicDir=/app/pb_public", \
  "--migrationsDir=/app/pb_migrations", \
  "--automigrate=false", \
  "--encryptionEnv=PB_ENCRYPTION_KEY"]
