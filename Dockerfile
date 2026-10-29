# Built by Railway with rootDirectory="mcp-server", so the build context IS this
# directory — COPY paths are context-relative.
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
# llms.txt is served verbatim by the /llms.txt route (index.ts reads it from
# disk) — without this COPY the file never reaches the image and the route 500s.
COPY llms.txt ./
# Deliberately NOT copying scripts/ and NOT running `npm run build` here.
# Attempted 2026-07-30 so the check-dispatch guard would gate the image; the build
# failed with `"/scripts": not found` even though both files under mcp-server/
# scripts/ are tracked and no .gitignore/.railwayignore/.dockerignore rule matches
# them. Railway's deploy tarball is a separate filter pipeline that drops
# directories on its own terms — same family as the migrations/ omission.
# So the image compiles directly and the guard runs outside it:
#   cd mcp-server && npm run check-dispatch
# Weaker than a build gate, and stated as such rather than pretended otherwise.
RUN npx tsc

FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/llms.txt ./llms.txt
COPY package.json ./
EXPOSE 3001
ENV NODE_ENV=production
# NOTE: do NOT set MCP_ALLOW_KEYLESS_INTROSPECTION here. This image serves the
# HOSTED endpoint (mcp.fahaliai.com), where a keyless `initialize` must return
# 401 + WWW-Authenticate — that challenge is what makes Claude/ChatGPT prompt
# "Connect with Fahali" and run the OAuth flow. With keyless allowed, clients
# silently open an unauthenticated session and every tool call then fails with
# "missing_api_key". Directory introspection does not need the flag: the public
# stdio proxy (Future-Legends-Inc/fahali-mcp) lists tools without auth already.
CMD ["node", "dist/index.js"]
