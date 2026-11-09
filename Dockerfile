# Daggery runs as one container. The server serves the built web app and the API.
FROM node:22-bookworm

WORKDIR /app

# The manifests come first, so the dependency layer is reused when only source files change.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/content/package.json packages/content/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build -w @daggery/web

# Set after the build, so npm ci above still installs the dev tools that the build needs.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DAGGERY_DATA_DIR=/app/data

WORKDIR /app/apps/server
EXPOSE 3000
CMD ["/app/node_modules/.bin/tsx", "src/index.ts"]
