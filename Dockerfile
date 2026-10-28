# Cloud Run 이미지. Next.js standalone 출력(`server.js`)과, 운영 필수 환경 변수를 확인한 뒤
# 그 서버를 띄우는 진입점(`boot.mjs` = scripts/cloudRunBoot.mjs)만 담는다.
# 빌드: docker build --build-arg GITHUB_SHA=$(git rev-parse HEAD) -t bangsongteam .

FROM node:22-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
ARG GITHUB_SHA
ENV GITHUB_SHA=${GITHUB_SHA}
RUN pnpm build

FROM gcr.io/distroless/nodejs22-debian12:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=8080
COPY --from=build --chown=nonroot:nonroot /app/.next/standalone ./
COPY --from=build --chown=nonroot:nonroot /app/.next/static ./.next/static
COPY --from=build --chown=nonroot:nonroot /app/public ./public
COPY --from=build --chown=nonroot:nonroot /app/scripts/cloudRunBoot.mjs ./boot.mjs
EXPOSE 8080
CMD ["boot.mjs"]
