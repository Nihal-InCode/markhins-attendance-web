FROM python:3.11-slim

# ── Install Node.js 22 via NodeSource ──
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# ── Python dependencies (cached layer — only rebuilds when requirements change) ──
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && rm /tmp/requirements.txt

WORKDIR /app

# ── Node dependencies (cached layer — only rebuilds when package.json changes) ──
COPY package.json package-lock.json* ./
RUN npm install --production

# ── Application code (rebuilds on any code change) ──
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
