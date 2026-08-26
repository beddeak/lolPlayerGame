const { spawnSync } = require('node:child_process');
const { loadEnvFile } = require('node:process');
const mysql = require('mysql2/promise');

loadEnvFile('.env');

const database = `lol_manager_e2e_${Date.now()}_${process.pid}`;
const safeDatabasePattern = /^lol_manager_e2e_[0-9]+_[0-9]+$/;
const npmCliPath = process.env.npm_execpath;

function runNpm(arguments_) {
  if (!npmCliPath) {
    throw new Error('npm_execpath is required to run isolated e2e tests');
  }

  const result = spawnSync(process.execPath, [npmCliPath, ...arguments_], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DB_DATABASE: database,
    },
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      `npm ${arguments_.join(' ')} failed with exit code ${result.status}`,
    );
  }
}

async function main() {
  if (!safeDatabasePattern.test(database)) {
    throw new Error(`Unsafe temporary database name: ${database}`);
  }

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT),
    user: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  });
  let created = false;

  try {
    const [existingRows] = await connection.query(
      'SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
      [database],
    );

    if (Number(existingRows[0].count) !== 0) {
      throw new Error(`Temporary database already exists: ${database}`);
    }

    await connection.query(
      `CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    created = true;
    console.log(`Created isolated e2e database: ${database}`);

    runNpm(['run', 'migration:run']);
    runNpm(['run', 'schema:verify']);
    runNpm(['run', 'test:e2e', '--', '--runInBand']);
  } finally {
    if (created) {
      await connection.query(`DROP DATABASE \`${database}\``);
      const [remainingRows] = await connection.query(
        'SELECT COUNT(*) AS count FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = ?',
        [database],
      );

      if (Number(remainingRows[0].count) !== 0) {
        throw new Error(`Failed to remove temporary database: ${database}`);
      }

      console.log(`Removed isolated e2e database: ${database}`);
    }

    await connection.end();
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Isolated e2e failed: ${message}`);
  process.exitCode = 1;
});
