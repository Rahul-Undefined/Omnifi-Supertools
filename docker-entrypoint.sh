#!/bin/sh
# Refresh the video download engine in the background on every start, then run the app.
# Render's free service restarts often, so the engine stays within days of YouTube's changes
# without a redeploy. Failures are ignored: the copy baked into the image keeps working.
(pip install --user --break-system-packages --no-cache-dir --quiet --upgrade --pre yt-dlp >/tmp/ytdlp-update.log 2>&1 && echo "yt-dlp refreshed: $(python3 -m yt_dlp --version)" || echo "yt-dlp refresh skipped") &
exec node server.js
