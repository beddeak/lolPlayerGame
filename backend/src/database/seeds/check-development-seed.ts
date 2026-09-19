import 'reflect-metadata';
import { readFile, access } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { validateDevelopmentSeed } from './development-seed.validation';
import { DEVELOPMENT_PLAYER_DEFAULTS } from './development-seed.types';

async function check(): Promise<void> {
  const data = validateDevelopmentSeed(
    JSON.parse(
      await readFile(resolve('data/development-seed.json'), 'utf8'),
    ) as unknown,
  );
  const warnings: string[] = [];
  const publicRoot = resolve('../frontend/public');
  const asset = async (url: string | null | undefined, label: string) => {
    if (!url?.startsWith('/')) return;
    const location = resolve(publicRoot, `.${url}`);
    const path = relative(publicRoot, location);
    if (path.startsWith('..') || isAbsolute(path))
      throw new Error(`${label}: path escapes public directory`);
    try {
      await access(location);
    } catch {
      warnings.push(`${label}: local asset is missing: ${url}`);
    }
  };
  for (const card of data.playerCards) {
    if (card.startingAge === undefined)
      warnings.push(
        `${card.key}.startingAge: omitted; defaults to ${DEVELOPMENT_PLAYER_DEFAULTS.startingAge}, not a verified real age`,
      );
    if (card.nationality === undefined)
      warnings.push(`${card.key}.nationality: omitted; defaults to UNKNOWN`);
    await asset(card.imageUrl, card.key);
  }
  for (const team of data.teams) {
    if (!team.logoUrl) warnings.push(`${team.code}.logoUrl: not set`);
    await asset(team.logoUrl, team.code);
    if (team.enabled !== false && team.starters.length !== 5)
      warnings.push(
        `${team.code}: incomplete starting roster; new career will be blocked`,
      );
  }
  console.log(
    `Seed valid: ${data.playerCards.length} cards, ${data.teams.filter((team) => team.enabled !== false).length} active clubs, ${data.themes.length} themes.`,
  );
  for (const warning of warnings) console.warn(`WARNING: ${warning}`);
  console.log('Read-only check completed. No database connection or writes.');
}

void check().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
