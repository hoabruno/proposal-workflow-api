# Builds the back-office, then serves it with nginx next to the tornado page.
# The tornado (front/) is not part of this repository: it is mounted at runtime.

FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN npm install -g npm@11
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/admin
