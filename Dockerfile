FROM node:22-bookworm-slim

# ── Install Python 3 (cached layer — only rebuilds when base image changes) ──
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip && \
    rm -rf /var/lib/apt/lists/*

# ── Python dependencies (cached layer — only rebuilds when requirements change) ──
COPY requirements.txt /tmp/requirements.txt
RUN pip install --break-system-packages --no-cache-dir --default-timeout=120 --retries=5 -r /tmp/requirements.txt && \
    rm /tmp/requirements.txt

WORKDIR /app

# ── Node dependencies (cached layer — only rebuilds when package.json changes) ──
COPY package.json package-lock.json* ./
RUN npm install --production

# ── Application code (rebuilds on any code change) ──
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
