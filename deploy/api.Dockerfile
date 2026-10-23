# API image. Build from the repository root:  docker build -f deploy/api.Dockerfile -t nts-api .
# NOT yet built or run (no Docker on the development machine); see docs/DEPLOYMENT.md.
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# openssl: Prisma's engine needs it at generate time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN npm ci --workspace=@nts/shared --workspace=@nts/api --include-workspace-root
RUN npm run build -w @nts/shared && npm run build -w @nts/api
RUN npm prune --omit=dev --workspace=@nts/shared --workspace=@nts/api --include-workspace-root

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /repo/package.json ./
COPY --from=build --chown=node:node /repo/node_modules node_modules
COPY --from=build --chown=node:node /repo/packages/shared packages/shared
COPY --from=build --chown=node:node /repo/apps/api/package.json apps/api/package.json
COPY --from=build --chown=node:node /repo/apps/api/dist apps/api/dist
COPY --from=build --chown=node:node /repo/apps/api/src/generated apps/api/src/generated
USER node
WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]
