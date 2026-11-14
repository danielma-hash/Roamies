FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-noto-core && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir browser-use==1.0.4 browser-harness==0.1.13
RUN useradd --create-home --uid 1000 browser
USER browser
WORKDIR /home/browser
ENV ANONYMIZED_TELEMETRY=false BH_RECORD=0 BH_TAB_MARKER=0 BU_CDP_URL=http://127.0.0.1:9222
# Chromium's sandbox is disabled only inside this non-root, networkless test container.
# The live test enforces no capabilities, no host mounts, read-only root and memory/CPU caps.
CMD ["chromium","--headless","--disable-gpu","--no-sandbox","--disable-dev-shm-usage","--remote-debugging-address=127.0.0.1","--remote-debugging-port=9222","--user-data-dir=/tmp/profile","--no-first-run","--no-default-browser-check","about:blank"]
