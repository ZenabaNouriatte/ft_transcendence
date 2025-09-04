# Dockerfile pour le backend
FROM node:20-alpine AS base

# Stage de dépendances (prod)
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ \
 && npm ci --only=production && npm cache clean --force \
 && apk del python3 make g++ || true

# Stage de build (dev + transpile)
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
# ⚠️ OUTILS DE BUILD AUSSI ICI
RUN apk add --no-cache python3 make g++ libstdc++ \
 && npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN mkdir -p dist/data && cp -v src/data/schema.sql dist/data/

# Stage runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# ⚠️ libstdc++ nécessaire à l’exécution des modules natifs
RUN apk add --no-cache libstdc++
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

EXPOSE 8000
CMD ["node", "dist/index.js"]
