# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app
ENV CI=1
RUN corepack enable

# Copy monorepo
COPY . .

# Install at repo root so pnpm workspace is respected
RUN pnpm install --frozen-lockfile
# Build the web app only
WORKDIR /app/apps/web
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
RUN pnpm build

# ---- run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
# only copy .next/ and minimal files
COPY --from=builder /app/apps/web/.next ./.next
COPY --from=builder /app/apps/web/next.config.js ./next.config.js
COPY --from=builder /app/apps/web/package.json ./package.json
COPY --from=builder /app/apps/web/public ./public

EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
