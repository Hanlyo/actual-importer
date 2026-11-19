FROM node:22-slim

WORKDIR /app

# Abhängigkeiten cachen
COPY package*.json ./
RUN npm ci --omit=dev

# App-Code kopieren
COPY import.mjs watch.mjs ./

# Cache- und Watch-Verzeichnisse vorbereiten
ENV ACTUAL_DATA_DIR=/tmp/actual-cache
RUN mkdir -p /tmp/actual-cache /csv/done /csv/error

CMD ["node", "watch.mjs"]
