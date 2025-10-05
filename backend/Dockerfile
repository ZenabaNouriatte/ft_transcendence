# --- build ---
FROM node:20-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
 && (npm ci || (echo "Lock out of sync → fallback to npm install" && npm install))

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache libstdc++ sqlite sqlite-dev

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/database/schema.sql ./dist/database/schema.sql

COPY package.json ./

CMD ["node","dist/index.js"]
