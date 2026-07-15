# منصة الإدارة المدرسية المتكاملة — صورة الإنتاج
FROM node:24-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production

# تبعيات النظام: Chromium لتوليد PDF العربي + poppler لمعاينة صفحات PDF + عميل postgres للنسخ الاحتياطي
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils postgresql-client openssl ca-certificates \
    fonts-noto-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/drizzle.config.ts ./drizzle.config.ts

# متصفح Playwright داخل الصورة
RUN npx playwright install --with-deps chromium

RUN useradd -m -u 1001 madrasa \
  && mkdir -p /data/storage /data/backups \
  && chown -R madrasa:madrasa /data /app
USER madrasa

ENV STORAGE_DIR=/data/storage
ENV BACKUP_DIR=/data/backups
EXPOSE 3080

CMD ["sh", "-c", "npx tsx src/db/migrate.ts && npx tsx src/db/seed.ts && npm run start"]
