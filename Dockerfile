FROM node:22-slim

WORKDIR /app

# Abhängigkeiten cachen
COPY package*.json ./
RUN npm ci --omit=dev

# App-Code kopieren
COPY import.mjs ./

# Cache-Verzeichnis vorbereiten
ENV ACTUAL_DATA_DIR=/tmp/actual-cache
RUN mkdir -p /tmp/actual-cache

ENTRYPOINT ["node", "import.mjs"]
