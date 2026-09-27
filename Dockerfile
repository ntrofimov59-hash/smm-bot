# syntax=docker/dockerfile:1.6

# -------- builder --------
FROM node:20-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

RUN corepack enable && corepack prepare pnpm@10 --activate

WORKDIR /app

# Native deps (better-sqlite3, sharp) — python/make/g++ на случай, если
# prebuilt-бинарь не подойдёт под платформу
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Манифесты первыми — для кэша слоёв
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# Исходники
COPY . .

# Только prod-зависимости в runtime.
# HUSKY=0 — prepare-скрипт husky не запускается, иначе падает:
# husky в devDeps и уже удалён к этому моменту.
RUN HUSKY=0 pnpm prune --prod


# -------- runtime --------
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false

RUN apt-get update && apt-get install -y --no-install-recommends \
        tini ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app /app

# Директории для volume'ов — на случай, если не смонтированы
RUN mkdir -p /app/agent/data /app/logs

# tini = правильный PID 1, корректно обрабатывает SIGTERM
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bot.js"]
