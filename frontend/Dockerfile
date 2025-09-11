FROM node:20-alpine AS build
WORKDIR /app

# Copie des fichiers de configuration
COPY package*.json ./
COPY tsconfig.json ./
COPY tailwind.config.cjs ./
COPY postcss.config.cjs ./

# Installation des dépendances
RUN npm ci

# Copie du code source
COPY src/ ./src/
COPY index.html ./
COPY public/ ./public/

# Build
RUN npm run build

# Production
FROM nginx:alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
