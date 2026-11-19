#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f .env ]; then
  echo "❌ .env nicht gefunden. Bitte aus .env.example erstellen."
  exit 1
fi

echo "🐳 Baue und starte dkb-actual-importer..."
docker compose up --build -d

echo ""
echo "✅ Container läuft. Logs:"
docker compose logs -f
