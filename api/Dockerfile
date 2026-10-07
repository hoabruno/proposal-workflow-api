# Two stages: build with dev dependencies, then a slim runtime image that
# keeps only production dependencies (plus the Prisma CLI for migrations).

FROM node:22-bookworm-slim AS build
WORKDIR /app
# npm 9 and 10 crash on this dependency tree (see README).
RUN npm install -g npm@11
COPY package.json package-lock.json prisma7.config.ts ./
COPY prisma ./prisma
# Runs the approved install scripts (Prisma engines) and `prisma generate`.
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/package.json /app/prisma7.config.ts ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
# Pending migrations are applied before the API starts: safe with a single instance.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node dist/main.js"]
