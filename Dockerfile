# The release: the built frontend and the route service in one image, so a deploy switches both
# at once. Build context: the repository root with submodules checked out (tooling/ and its
# shortest-path/).
FROM node:24-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tooling/corpus tooling/corpus
COPY index.html tsconfig*.json vite.config.ts ./
COPY scripts scripts
COPY src src
RUN npm run build

# gradle:*-jdk11: the plugin's build asks for a Java 11 toolchain.
FROM gradle:8.14-jdk11 AS service
WORKDIR /src
COPY . .
RUN gradle --no-daemon :service:installDist

FROM eclipse-temurin:21-jre-jammy
RUN useradd --system --uid 10001 --create-home planner
WORKDIR /app
COPY --from=service --chown=planner:planner /src/service/build/install/osrs-planner/ ./
COPY --from=frontend --chown=planner:planner /src/dist/ ./frontend/
ARG RELEASE=dev
ENV RELEASE=${RELEASE} FRONTEND_DIR=/app/frontend PORT=8080
USER planner
EXPOSE 8080
ENTRYPOINT ["/app/bin/osrs-planner"]
