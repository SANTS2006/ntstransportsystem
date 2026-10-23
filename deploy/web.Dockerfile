# Web image: the built single-page app behind nginx, which also forwards /api to the API so the
# browser sees one origin (the app relies on same-origin cookies).
# Build from the repository root:  docker build -f deploy/web.Dockerfile -t nts-web .
# NOT yet built or run (no Docker on the development machine); see docs/DEPLOYMENT.md.
FROM node:22-slim AS build
WORKDIR /repo
ARG VITE_GOOGLE_CLIENT_ID=
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm ci --workspace=@nts/shared --workspace=@nts/web --include-workspace-root
RUN npm run build -w @nts/shared && npm run build -w @nts/web

FROM nginx:1.27-alpine
# API_UPSTREAM is filled in by the nginx image's template step, e.g. http://api:4000
ENV API_UPSTREAM=http://api:4000
COPY deploy/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
