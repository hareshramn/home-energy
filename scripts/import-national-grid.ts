import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import dotenv from 'dotenv';


// ============================================================
// Environment
// ============================================================

dotenv.config({
  path: path.resolve(process.cwd(), '.env.local'),
});

const email = process.env.SUPABASE_AUTH_EMAIL;
const password = process.env.SUPABASE_AUTH_PASSWORD;

if (!email || !password) {
  throw new Error(
    'Missing SUPABASE_AUTH_EMAIL or SUPABASE_AUTH_PASSWORD in .env.local'
  );
}


// ============================================================
// Input file
// ============================================================

const filename = process.argv[2];

if (!filename) {
  console.error(
    'Usage: npm run import:meter -- /path/to/national-grid.csv'
  );

  process.exit(1);
}

const filepath = path.resolve(filename);


// ============================================================
// Main
// ============================================================

async function main() {

  console.log();
  console.log('National Grid meter import');
  console.log('==========================');

  // ----------------------------------------------------------
  // Read CSV
  // ----------------------------------------------------------

  console.log();
  console.log('Reading CSV...');

  const text = await fs.readFile(
    filepath,
    'utf8'
  );

  // ----------------------------------------------------------
  // Load app modules after .env.local has been loaded
  // ----------------------------------------------------------

  const [
    { supabase },
    { parseNationalGridCsv },
    { importMeterFile, latestMeterTimestamp },
  ] = await Promise.all([
    import('../lib/supabase/client'),
    import('../lib/meter/parse-national-grid'),
    import('../lib/meter/import-meter'),
  ]);

  // ----------------------------------------------------------
  // Parse CSV
  // ----------------------------------------------------------

  console.log('Parsing National Grid data...');

  const parsed = parseNationalGridCsv(text);

  console.log(
    `Rows received: ${parsed.rowsReceived}`
  );

  console.log(
    `Valid readings: ${parsed.readings.length}`
  );

  if (parsed.invalidRows > 0) {
    console.log(
      `Invalid rows: ${parsed.invalidRows}`
    );
  }

  // ----------------------------------------------------------
  // Authenticate
  // ----------------------------------------------------------

  console.log();
  console.log('Signing into Home Energy...');

  const {
    error: signInError,
  } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw new Error(
      `Unable to sign into Home Energy: ${signInError.message}`
    );
  }

  console.log('Signed in.');

  try {

    // --------------------------------------------------------
    // Import using existing Home Energy pipeline
    // --------------------------------------------------------

    console.log();
    console.log('Importing readings...');

    let lastShown = -1;

    const counts = await importMeterFile(
      path.basename(filepath),
      parsed,
      progress => {

        // Avoid printing one line for every meter reading.
        const percent = progress.validRows
          ? Math.floor(
              progress.processed /
              progress.validRows *
              100
            )
          : 100;

        if (
          percent >= lastShown + 10 ||
          progress.processed === progress.validRows
        ) {

          lastShown = percent;

          console.log(
            `  ${progress.processed} / ${progress.validRows}`
          );
        }
      }
    );

    // --------------------------------------------------------
    // Latest reading
    // --------------------------------------------------------

    const latest = await latestMeterTimestamp();

    // --------------------------------------------------------
    // Results
    // --------------------------------------------------------

    console.log();
    console.log('========================================');
    console.log('IMPORT COMPLETE');
    console.log('========================================');

    console.log(
      `Rows received:   ${counts.rowsReceived}`
    );

    console.log(
      `New:             ${counts.inserted}`
    );

    console.log(
      `Already stored:  ${counts.duplicate}`
    );

    console.log(
      `Conflicts:       ${counts.conflict}`
    );

    console.log(
      `Invalid:         ${counts.invalid}`
    );

    console.log(
      `Latest reading:  ${latest ?? 'none'}`
    );

    console.log('========================================');

  } finally {

    // --------------------------------------------------------
    // Sign out
    // --------------------------------------------------------

    await supabase.auth.signOut();
  }
}


// ============================================================
// Run
// ============================================================

main().catch(error => {

  console.error();
  console.error('IMPORT FAILED');

  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(String(error));
  }

  process.exit(1);
});
