# Built by Railway with rootDirectory="mcp-server", so the build context IS this
# directory — COPY paths are context-relative.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./
EXPOSE 3001
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
