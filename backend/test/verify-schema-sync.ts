import dataSource from '../src/database/data-source';

async function verifySchemaSync(): Promise<void> {
  await dataSource.initialize();

  try {
    const schemaBuilder = dataSource.driver.createSchemaBuilder();
    const schemaChanges = await schemaBuilder.log();

    if (schemaChanges.upQueries.length > 0) {
      const queries = schemaChanges.upQueries
        .map((query) => query.query)
        .join('\n');

      throw new Error(`TypeORM schema differs after migrations:\n${queries}`);
    }

    console.log('TypeORM schema matches all registered entities.');
  } finally {
    await dataSource.destroy();
  }
}

void verifySchemaSync().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  console.error(message);
  process.exitCode = 1;
});
