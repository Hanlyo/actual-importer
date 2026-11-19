import { readdirSync, renameSync, mkdirSync, statSync } from 'fs';
import { join, extname } from 'path';
import { spawn } from 'child_process';

// ─── Konfiguration ────────────────────────────────────────────────────────────
const CONFIG = {
  watchDir:      process.env.WATCH_DIR      || '/csv',
  accountId:     process.env.ACTUAL_ACCOUNT_ID || '',
  pollInterval:  parseInt(process.env.POLL_INTERVAL || '5000', 10),
  stableDelay:   parseInt(process.env.STABLE_DELAY || '1000', 10),
};

const DONE_DIR = join(CONFIG.watchDir, 'done');
const ERROR_DIR = join(CONFIG.watchDir, 'error');

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────

function ensureDirs() {
  mkdirSync(CONFIG.watchDir, { recursive: true });
  mkdirSync(DONE_DIR, { recursive: true });
  mkdirSync(ERROR_DIR, { recursive: true });
}

function getCsvFiles() {
  return readdirSync(CONFIG.watchDir)
    .filter(name => extname(name).toLowerCase() === '.csv')
    .map(name => join(CONFIG.watchDir, name));
}

async function isStable(filePath) {
  try {
    const stat1 = statSync(filePath);
    await new Promise(r => setTimeout(r, CONFIG.stableDelay));
    const stat2 = statSync(filePath);
    return stat1.size === stat2.size && stat1.mtime.getTime() === stat2.mtime.getTime();
  } catch (err) {
    return false;
  }
}

function moveFile(filePath, targetDir) {
  const name = filePath.split('/').pop().split('\\').pop();
  const target = join(targetDir, `${Date.now()}_${name}`);
  renameSync(filePath, target);
  return target;
}

function importFile(filePath) {
  return new Promise(resolve => {
    console.log(`\n📥 Verarbeite ${filePath}...`);
    const child = spawn('node', ['import.mjs', CONFIG.accountId, filePath], {
      stdio: 'inherit',
      env: process.env,
    });

    child.on('close', code => {
      if (code === 0) {
        const target = moveFile(filePath, DONE_DIR);
        console.log(`✅ Erfolg: verschoben nach ${target}`);
      } else {
        const target = moveFile(filePath, ERROR_DIR);
        console.error(`❌ Fehler (Exit ${code}): verschoben nach ${target}`);
      }
      resolve();
    });
  });
}

// ─── Hauptprogramm ────────────────────────────────────────────────────────────

async function main() {
  if (!CONFIG.accountId) {
    console.error('❌ Fehlende Konfiguration: ACTUAL_ACCOUNT_ID muss gesetzt sein.');
    process.exit(1);
  }

  ensureDirs();
  console.log(`👀 Überwache ${CONFIG.watchDir} alle ${CONFIG.pollInterval}ms`);
  console.log(`   Account-ID: ${CONFIG.accountId}`);
  console.log(`   Erfolg → ${DONE_DIR}`);
  console.log(`   Fehler → ${ERROR_DIR}\n`);

  // Initialer Durchlauf
  let files = getCsvFiles();
  if (files.length) {
    console.log(`🗂️  ${files.length} Datei(en) beim Start gefunden`);
  }

  for (const file of files) {
    if (await isStable(file)) {
      await importFile(file);
    }
  }

  // Dauerhaftes Polling
  setInterval(async () => {
    files = getCsvFiles();
    for (const file of files) {
      if (await isStable(file)) {
        await importFile(file);
      }
    }
  }, CONFIG.pollInterval);
}

main().catch(err => {
  console.error('\n❌ Fehler:', err.message);
  process.exit(1);
});
