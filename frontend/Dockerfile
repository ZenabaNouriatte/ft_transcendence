# --- Build stage ---
FROM node:20-alpine AS build
WORKDIR /app

# Dépendances
COPY package*.json ./
COPY tsconfig.json ./
COPY tailwind.config.cjs ./
COPY postcss.config.cjs ./
RUN npm ci

# Source
COPY src/ ./src/
COPY index.html ./
COPY public/ ./public/

# Build (produit dist/)
RUN npm run build

# --- Runtime stage ---
FROM nginx:alpine
# Copie tout le dossier dist dans la racine Nginx
COPY --from=build /app/dist/ /usr/share/nginx/html/
# Nginx sert automatiquement /usr/share/nginx/html/index.html
