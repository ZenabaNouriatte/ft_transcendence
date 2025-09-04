# Dockerfile pour le backend
FROM node:20-alpine AS base

# Stage de dépendances
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN apk add --no-cache python3 make g++ \
 && npm ci --only=production && npm cache clean --force \
 && apk del python3 make g++ || true

# Stage de build
FROM base AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev && npm cache clean --force
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
RUN mkdir -p dist/data && cp -v src/data/schema.sql dist/data/

# Stage runtime
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./

EXPOSE 8000
CMD ["node", "dist/index.js"]