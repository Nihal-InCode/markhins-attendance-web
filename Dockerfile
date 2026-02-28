FROM node:22-slim

# Install Python and dependencies
RUN apt-get update && apt-get install -y python3 python3-pip && \
    pip3 install pyTelegramBotAPI --break-system-packages && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only package files first (for caching)
COPY package.json package-lock.json* ./

RUN npm install --production

# Now copy remaining source code
COPY . .

EXPOSE 8080

CMD ["npm", "start"]
