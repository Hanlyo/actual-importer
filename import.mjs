import * as api from '@actual-app/api';
import { parse } from 'csv-parse/sync';
import { readFileSync, mkdirSync, rmSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';

// Node.js verwendet keinen Windows-Zertifikatsspeicher – lokale HTTPS-Zertifikate
// (z.B. Tailscale/self-signed) werden ohne diesen Schalter abgelehnt.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// ─── Konfiguration ────────────────────────────────────────────────────────────
const CONFIG = {
  serverURL:  process.env.ACTUAL_SERVER_URL  || 'https://actual.lan',
  password:   process.env.ACTUAL_PASSWORD    || '',
  syncId:     process.env.ACTUAL_SYNC_ID     || '',
  dataDir:    process.env.ACTUAL_DATA_DIR    || join(tmpdir(), 'actual-cache'),
  // TLS: Tailscale-Zertifikat ist vertrauenswürdig, daher kein NODE_TLS_REJECT_UNAUTHORIZED nötig.
  // Falls doch Probleme: NODE_EXTRA_CA_CERTS=/pfad/zum/cert.crt node import.mjs ...
};

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

/**
 * Wandelt DKB-Datum (DD.MM.YY oder DD.MM.YYYY) in YYYY-MM-DD um.
 */
function parseDate(raw) {
  const parts = raw.trim().split('.');
  if (parts.length !== 3) throw new Error(`Unbekanntes Datumsformat: ${raw}`);
  let [day, month, year] = parts;
  if (year.length === 2) year = '20' + year;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

/**
 * Wandelt DKB-Betrag ("1.234,56" oder "-11,99") in Actual-Cent-Integer um.
 * Actual erwartet negative Werte für Ausgaben.
 */
function parseAmount(raw) {
  const cleaned = raw.trim().replace(/\./g, '').replace(',', '.');
  const float = parseFloat(cleaned);
  if (isNaN(float)) throw new Error(`Ungültiger Betrag: ${raw}`);
  return api.utils.amountToInteger(float);
}

/**
 * Bestimmt den Payee-Namen:
 * - Bei Eingang (positiver Betrag): Zahlungspflichtiger
 * - Bei Ausgang (negativer Betrag): Zahlungsempfänger
 * Fallback auf den jeweils anderen Wert falls einer leer ist.
 */
function resolvePayee(row) {
  const debtor   = (row['Zahlungspflichtige*r']  || '').trim();
  const creditor = (row['Zahlungsempfänger*in']  || '').trim();
  const amount   = parseAmount(row['Betrag (€)']);

  if (amount >= 0) {
    return debtor   || creditor || 'Unbekannt';
  } else {
    return creditor || debtor   || 'Unbekannt';
  }
}

/**
 * Erzeugt eine stabile imported_id zur Duplikatsvermeidung.
 * Kombination aus Datum + Betrag + Verwendungszweck + transaction_id falls vorhanden.
 */
function buildImportedId(row, index) {
  const date    = row['Buchungsdatum']  || '';
  const amount  = row['Betrag (€)']    || '';
  const purpose = row['Verwendungszweck'] || '';
  // DKB exportiert keine eindeutige Transaktions-ID – Index als Tiebreaker
  return `dkb-${date}-${amount}-${purpose}-${index}`.replace(/\s+/g, '_');
}

/**
 * Liest eine DKB-CSV-Datei und gibt ein Array von Actual-Transaktionsobjekten zurück.
 */
function parseDkbCsv(filePath) {
  // DKB liefert CSV als UTF-8; BOM falls vorhanden entfernen
  const raw = readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');

  // DKB verwendet Komma als Trennzeichen und Anführungszeichen als Textbegrenzer
  const records = parse(raw, {
    delimiter:        ',',
    columns:          true,
    skip_empty_lines: true,
    trim:             true,
    relax_quotes:     true,
    bom:              true,
  });

  const transactions = [];

  for (let i = 0; i < records.length; i++) {
    const row = records[i];

    // Zeilen ohne Buchungsdatum überspringen (z.B. Leerzeilen am Anfang der DKB-CSV)
    if (!row['Buchungsdatum'] || row['Buchungsdatum'].trim() === '') continue;
    // Nur gebuchte Transaktionen importieren
    if (row['Status'] && !row['Status'].includes('Gebucht')) continue;

    try {
      transactions.push({
        date:        parseDate(row['Buchungsdatum']),
        amount:      parseAmount(row['Betrag (€)']),
        payee_name:  resolvePayee(row),
        notes:       row['Verwendungszweck']?.trim() || '',
        imported_id: buildImportedId(row, i),
      });
    } catch (err) {
      console.warn(`  ⚠ Zeile ${i + 2} übersprungen: ${err.message}`);
    }
  }

  return transactions;
}

/**
 * Budget ließ sich nicht laden: Fast immer ist die installierte @actual-app/api älter als der
 * Server (dessen Datenbank hat Migrationen, die die API nicht kennt).
 * Im Docker-Container kann das Paket nicht nachträglich aktualisiert werden – dafür muss ein
 * neues Image gebaut werden. Daher nur eine aussagekräftige Fehlermeldung ausgeben.
 */
async function selfHeal() {
  await api.shutdown().catch(() => {});
  rmSync(CONFIG.dataDir, { recursive: true, force: true });

  console.error('❌ Budget lässt sich nicht laden (out-of-sync-migrations).');
  console.error('   Die @actual-app/api Version passt wahrscheinlich nicht zur Serverversion.');
  console.error('   Lösung: In package.json @actual-app/api auf die Serverversion anpassen');
  console.error('   und das Docker-Image neu bauen.');
  throw new Error('Budget konnte nicht geladen werden');
}

// ─── Hauptprogramm ────────────────────────────────────────────────────────────

async function main() {
  if (!CONFIG.password) {
    console.error('❌ Fehlende Konfiguration: ACTUAL_PASSWORD muss gesetzt sein.');
    process.exit(1);
  }
  if (!CONFIG.syncId) {
    console.error('❌ Fehlende Konfiguration: ACTUAL_SYNC_ID muss gesetzt sein.');
    process.exit(1);
  }

  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Verwendung: node import.mjs <account-id> <dkb-export.csv>');
    console.error('');
    console.error('Umgebungsvariablen:');
    console.error('  ACTUAL_SERVER_URL  – URL des Actual-Servers (Standard: https://actual.lan)');
    console.error('  ACTUAL_PASSWORD    – Passwort für den Actual-Server');
    console.error('  ACTUAL_SYNC_ID     – Sync-ID aus Einstellungen → Erweitert → Sync-ID');
    console.error('  ACTUAL_DATA_DIR    – Lokaler Cache-Ordner (Standard: /tmp/actual-cache)');
    console.error('');
    console.error('Beispiel:');
    console.error('  ACTUAL_PASSWORD=geheim ACTUAL_SYNC_ID=abc-123 node import.mjs a1b2c3d4 girokonto.csv');
    process.exit(1);
  }

  const [accountId, csvPath] = args;
  const resolvedPath = resolve(csvPath);

  console.log(`\nDKB → Actual Budget Importer`);
  console.log(`────────────────────────────`);
  console.log(`Server:  ${CONFIG.serverURL}`);
  console.log(`Konto:   ${accountId}`);
  console.log(`Datei:   ${resolvedPath}\n`);

  // CSV einlesen
  console.log('📂 CSV wird eingelesen...');
  const transactions = parseDkbCsv(resolvedPath);
  console.log(`   ${transactions.length} Transaktionen gefunden.\n`);

  if (transactions.length === 0) {
    console.log('Keine Transaktionen zum Importieren. Beende.');
    process.exit(0);
  }

  // Actual API initialisieren
  mkdirSync(CONFIG.dataDir, { recursive: true });
  console.log('🔌 Verbinde mit Actual Budget...');
  await api.init({
    dataDir:   CONFIG.dataDir,
    serverURL: CONFIG.serverURL,
    password:  CONFIG.password,
  });

  console.log('📥 Budget wird heruntergeladen...');
  await api.downloadBudget(CONFIG.syncId);

  // downloadBudget() wirft bei Migrationsfehlern (out-of-sync-migrations) NICHT, sondern
  // schließt das Budget still wieder. Daher explizit prüfen, ob es wirklich geladen ist.
  try {
    await api.getAccounts();
  } catch (err) {
    if (!err.message?.includes('No budget file is open')) throw err;
    await selfHeal();
  }

  // Transaktionen importieren
  console.log('📤 Importiere Transaktionen...');
  const result = await api.importTransactions(accountId, transactions);

  console.log(`\n✅ Import abgeschlossen:`);
  console.log(`   Neu:         ${result.added?.length    ?? 0}`);
  console.log(`   Aktualisiert: ${result.updated?.length ?? 0}`);
  if (result.errors?.length) {
    console.log(`   Fehler:      ${result.errors.length}`);
    result.errors.forEach(e => console.warn(`   ⚠ ${e}`));
  }

  await api.shutdown();
  console.log('\nFertig.\n');
}

main().catch(err => {
  console.error('\n❌ Fehler:', err.message);
  process.exit(1);
});
