FROM python:3.11-slim

# ── Install Node.js 22 via direct binary download ──
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl && \
    curl -fsSL https://nodejs.org/dist/v22.16.0/node-v22.16.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 && \
    node --version && \
    apt-get purge -y curl && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

# ── Python dependencies (cached layer — only rebuilds when requirements change) ──
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --default-timeout=120 --retries=5 -r /tmp/requirements.txt && rm /tmp/requirements.txt

WORKDIR /app

# ── Node dependencies (cached layer — only rebuilds when package.json changes) ──
COPY package.json package-lock.json* ./
RUN npm install --production

# ── Application code (rebuilds on any code change) ──
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
