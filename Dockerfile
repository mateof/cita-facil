# syntax=docker/dockerfile:1

###############################################################################
# CitaFácil: imagen única con el API y el frontend integrado.
#
# Se usa Debian slim en lugar de Alpine porque `better-sqlite3` publica
# binarios precompilados para glibc pero no siempre para musl: con Alpine
# habría que compilar en cada construcción y la imagen final acabaría siendo
# más grande, no más pequeña.
###############################################################################

ARG NODE_VERSION=24-bookworm-slim

# --------------------------------------------------------------- dependencias
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# Herramientas por si algún módulo nativo no tiene binario para esta plataforma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/

RUN npm ci

# ------------------------------------------------------------------ compilado
FROM deps AS build
WORKDIR /app

COPY tsconfig.base.json ./
COPY packages ./packages

RUN npm run build

# Se reinstalan solo las dependencias de ejecución para la imagen final.
RUN npm prune --omit=dev

# ------------------------------------------------------------------ ejecución
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    DB_FILE=/data/cita-facil.sqlite \
    BACKUP_DIR=/data/backups \
    CERT_TRUST_DIR=/app/config/trust \
    CERT_CRL_DIR=/data/crl \
    WEB_DIST_PATH=/app/packages/web/dist

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /data /app/config/trust \
  && chown -R node:node /data /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/api/dist ./packages/api/dist
COPY --from=build --chown=node:node /app/packages/api/package.json ./packages/api/package.json
COPY --from=build --chown=node:node /app/packages/web/dist ./packages/web/dist

USER node
EXPOSE 3000
VOLUME ["/data"]

# El contenedor se considera sano cuando el API responde, no solo cuando el
# proceso existe: así un fallo de base de datos se detecta desde fuera.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# `tini` recoge los procesos huérfanos y reenvía las señales, para que
# SIGTERM llegue a Node y el cierre ordenado funcione.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "packages/api/dist/main.js"]
