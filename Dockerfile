# Single image: builds the React app, then serves it from the Express API (one origin, one port).
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production SERVE_FRONTEND=/app/public PORT=5000
COPY backend/package.json ./
RUN npm install --omit=dev
COPY backend/src ./src
COPY --from=web /web/dist ./public
EXPOSE 5000
USER node
CMD ["node", "src/server.js"]
