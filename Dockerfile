# The release: the built frontend and the route service in one image, so a deploy switches both
# at once. Build context: the repository root with submodules checked out (tooling/ and its
# shortest-path/).
FROM node:24-alpine AS frontend
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY schemas schemas
COPY index.html tsconfig*.json vite.config.ts tiles.json ./
COPY scripts scripts
COPY src src
COPY experiments experiments
# The frontend compares this with /version to notice it is out of date (src/app/UpdatePrompt.tsx).
ARG RELEASE=dev
ENV VITE_RELEASE=${RELEASE}
RUN npm run build

# gradle:*-jdk11: the plugin's build asks for a Java 11 toolchain.
FROM gradle:8.14-jdk11 AS service
WORKDIR /src
# The plugin data's commits, for the workbench's provenance (see service/build.gradle).
ARG TOOLING_REV=unknown
ARG PLUGIN_REV=unknown
ENV TOOLING_REV=${TOOLING_REV} PLUGIN_REV=${PLUGIN_REV}
COPY . .
RUN gradle --no-daemon :service:installDist

FROM eclipse-temurin:21-jre-jammy
# The workbench reads pull requests with git (shortestpath.workbench.GitSource).
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home planner
WORKDIR /app
COPY --from=service --chown=planner:planner /src/service/build/install/osrs-planner/ ./
COPY --from=frontend --chown=planner:planner /src/dist/ ./frontend/
ARG RELEASE=dev
ENV RELEASE=${RELEASE} FRONTEND_DIR=/app/frontend PORT=8080
USER planner
EXPOSE 8080
ENTRYPOINT ["/app/bin/osrs-planner"]
