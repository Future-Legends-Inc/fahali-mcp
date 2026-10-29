# Build context is this directory. Default CMD serves SSE on PORT (3001);
# run "node dist/index.js --stdio" for stdio. API base defaults to https://app.fahaliai.com.
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
