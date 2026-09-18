# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY LICENSE README.md ./
USER node
# Set ODDS_API_KEY at run time: docker run -i -e ODDS_API_KEY=... odds-api-mcp-server
ENTRYPOINT ["node", "dist/index.js"]
