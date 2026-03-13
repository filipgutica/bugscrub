FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    chromium \
    git \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/google/chrome \
  && cat <<'EOF' > /opt/google/chrome/chrome
#!/bin/sh
exec /usr/bin/chromium \
  --headless=new \
  --no-sandbox \
  --disable-setuid-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --disable-crash-reporter \
  --disable-background-networking \
  --no-first-run \
  "$@"
EOF
RUN chmod +x /opt/google/chrome/chrome \
  && ln -sf /opt/google/chrome/chrome /usr/bin/google-chrome \
  && ln -sf /opt/google/chrome/chrome /usr/bin/google-chrome-stable

RUN corepack enable \
  && corepack prepare pnpm@10.0.0 --activate

RUN npm install --global \
  @anthropic-ai/claude-code \
  chrome-devtools-mcp \
  @openai/codex

ENV CHROME_BIN=/usr/bin/chromium
ENV CHROMIUM_BIN=/usr/bin/chromium
ENV CHROME_PATH=/opt/google/chrome/chrome
ENV GOOGLE_CHROME_BIN=/opt/google/chrome/chrome
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV PUPPETEER_EXECUTABLE_PATH=/opt/google/chrome/chrome

WORKDIR /workspace
