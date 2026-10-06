# Veriflow Real Runner — small Docker image for VPS / GitHub Actions runner
# Usage: docker build -t veriflow-runner ./runner && docker run -d --name veriflow-runner \
#   -e VERIFLOW_API_BASE=https://your-vercel-app.vercel.app \
#   -e RUNNER_CALLBACK_SECRET=super-secret \
#   -v /var/run/docker.sock:/var/run/docker.sock \
#   veriflow-runner

FROM node:26-alpine AS base
RUN apk add --no-cache git chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

FROM base AS deps
WORKDIR /app
COPY runner/package*.json ./
RUN npm ci --omit=dev

FROM base AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY runner/worker.mjs ./worker.mjs
COPY runner/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
ENV NODE_ENV=production
ENTRYPOINT ["./entrypoint.sh"]