# Omnifi SuperTools — production image
# Multi-stage: install deps, build, then run the standalone server as a non-root user.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/data
# Video downloader engine: yt-dlp (pre-release channel, where YouTube fixes land first) + FFmpeg.
# Node is already present for yt-dlp's JavaScript challenges.
RUN apk add --no-cache python3 py3-pip ffmpeg ca-certificates \
    && pip install --no-cache-dir --break-system-packages --upgrade --pre yt-dlp \
    && (pip install --no-cache-dir --break-system-packages curl_cffi || echo "curl_cffi unavailable on this platform") \
    && python3 -m yt_dlp --version \
    && ffmpeg -version | head -n 1
RUN addgroup -S omnifi && adduser -S -h /home/omnifi omnifi -G omnifi \
    && mkdir -p /data /home/omnifi && chown -R omnifi:omnifi /data /home/omnifi
# The engine is invoked as a module so a newer copy in the user site-packages (refreshed at start) wins over the image copy.
ENV YTDLP_BIN="python3 -m yt_dlp" \
    HOME=/home/omnifi
COPY --chown=omnifi:omnifi docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh
COPY --from=build --chown=omnifi:omnifi /app/.next/standalone ./
COPY --from=build --chown=omnifi:omnifi /app/.next/static ./.next/static
COPY --from=build --chown=omnifi:omnifi /app/public ./public
USER omnifi
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["./docker-entrypoint.sh"]
