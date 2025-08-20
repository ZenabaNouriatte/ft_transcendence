FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --package-lock-only 
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
