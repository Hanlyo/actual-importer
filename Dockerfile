FROM node:22-slim

WORKDIR /app

# Build-Tools für native Module (better-sqlite3)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Abhängigkeiten cachen
COPY package*.json ./
RUN npm ci --omit=dev

# App-Code kopieren
COPY import.mjs watch.mjs ./

# Cache- und Watch-Verzeichnisse vorbereiten
ENV ACTUAL_DATA_DIR=/tmp/actual-cache
RUN mkdir -p /tmp/actual-cache /csv/done /csv/error

CMD ["node", "watch.mjs"]
