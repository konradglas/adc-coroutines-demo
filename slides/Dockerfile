# Static build of the deck, served by nginx. Coolify: build pack "Dockerfile",
# base directory /slides, port 80.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY . .
# Speaker notes are the full spoken script; keep them out unless asked for.
ARG WITH_NOTES=false
RUN if [ "$WITH_NOTES" = "true" ]; then npx slidev build; \
    else npx slidev build --without-notes; fi

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
