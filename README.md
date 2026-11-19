# DKB → Actual Budget Importer

Importiert DKB-Kontoauszüge (CSV) in Actual Budget.

## Features

- Erkennt automatisch ob eine Transaktion ein Eingang oder Ausgang ist und wählt den richtigen Payee (`Zahlungspflichtige*r` vs. `Zahlungsempfänger*in`)
- Duplikatsvermeidung über `imported_id`
- Nur gebuchte Transaktionen werden importiert
- Unterstützt DKB-Datumsformat (DD.MM.YY und DD.MM.YYYY)
- Unterstützt DKB-Betragsformat mit Komma als Dezimaltrennzeichen

## Installation

```bash
npm install
```

## Docker mit automatischem CSV-Watch (empfohlen für Server)

Der Container überwacht dauerhaft den Ordner `csv/`. Sobald eine `.csv`-Datei dort abgelegt wird, wird sie importiert.

- Bei Erfolg wird die Datei nach `csv/done/` verschoben.
- Bei Fehler wird die Datei nach `csv/error/` verschoben.

### Vorbereitung

1. `.env`-Datei im Projektverzeichnis anlegen:

```dot
ACTUAL_PASSWORD=meinpasswort
ACTUAL_SYNC_ID=1cfdbb80-6274-49bf-b0c2-737235a4c81f
ACTUAL_ACCOUNT_ID=08a5ac5d-e276-4f28-96e7-28a1118dd9b1
```

2. Container starten:

```bash
docker compose up --build -d
```

3. CSV-Datei in `csv/` legen – der Import startet automatisch.

### Umgebungsvariablen

| Variable | Beschreibung | Standard |
|---|---|---|
| `ACTUAL_SERVER_URL` | URL des Actual-Servers | `https://actual.lan` |
| `ACTUAL_PASSWORD` | Passwort für den Actual-Server | – |
| `ACTUAL_SYNC_ID` | Sync-ID aus den Actual-Einstellungen | – |
| `ACTUAL_ACCOUNT_ID` | Account-ID des Zielkontos | – |
| `POLL_INTERVAL` | Prüfintervall in ms | `5000` |
| `NODE_TLS_REJECT_UNAUTHORIZED` | TLS-Validierung deaktivieren | `0` |

### Logs ansehen

```bash
docker logs -f dkb-actual-importer
```

### Container stoppen

```bash
docker compose down
```

### Deploy-Skript

```bash
./deploy.sh
```

Startet den Container neu und zeigt danach die Logs.

### Backup der `.env`

Die `.env` enthält das Actual-Passwort. Sichere sie z.B. so:

```bash
cp .env .env.backup.$(date +%F)
```

Oder ins Password-Manager-Backup mit aufnehmen.

## Konfiguration

Die Konfiguration erfolgt über Umgebungsvariablen:

| Variable | Beschreibung | Standard |
|---|---|---|
| `ACTUAL_SERVER_URL` | URL des Actual-Servers | `https://actual.lan` |
| `ACTUAL_PASSWORD` | Passwort für den Actual-Server | – |
| `ACTUAL_SYNC_ID` | Sync-ID (siehe unten) | – |
| `ACTUAL_DATA_DIR` | Lokaler Cache-Ordner | `/tmp/actual-cache` |

### Sync-ID herausfinden

In Actual Budget: **Einstellungen → Erweiterte Einstellungen → Sync-ID**

### Account-ID herausfinden

In Actual Budget die URL im Browser aufrufen wenn ein Konto geöffnet ist:
`https://actual.lan/1cfdbb80-6274-49bf-b0c2-737235a4c81f/accounts/ACCOUNT-ID`

Oder per API:
```bash
node -e "
import('@actual-app/api').then(async api => {
  await api.default.init({ dataDir: '/tmp/actual-cache', serverURL: 'https://actual.lan', password: process.env.ACTUAL_PASSWORD });
  await api.default.downloadBudget(process.env.ACTUAL_SYNC_ID);
  const accounts = await api.default.getAccounts();
  accounts.forEach(a => console.log(a.id, a.name));
  await api.default.shutdown();
});
"
```

## Verwendung

```bash
ACTUAL_PASSWORD=geheim \
ACTUAL_SYNC_ID=abc-123-def-456 \
node import.mjs <account-id> <dkb-export.csv>
```

### Beispiel

```bash
ACTUAL_PASSWORD=meinpasswort \
ACTUAL_SYNC_ID=1cfdbb80-6274-49bf-b0c2-737235a4c81f \
node import.mjs 08a5ac5d-e276-4f28-96e7-28a1118dd9b1 girokonto_2026.csv
```

## DKB CSV Export

In der DKB App oder im Online-Banking:
1. Konto öffnen
2. Kontoauszug / Umsätze exportieren
3. Format: CSV
4. Gewünschten Zeitraum wählen

## Hinweise

- Der erste Import kann etwas länger dauern, da das Budget-Cache lokal aufgebaut wird
- Bei wiederholtem Import werden Duplikate automatisch erkannt und übersprungen
- Überlappende Zeiträume sind kein Problem – einfach die komplette CSV importieren
