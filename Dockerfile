# Horizon Remade — single container: static game + multiplayer server
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
# the worlds share the weather/season rules with the game
COPY src/world/climate.js ./src/world/climate.js
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
