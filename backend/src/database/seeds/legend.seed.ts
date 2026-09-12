import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreatePlayerDto } from '../../players/dto/create-player.dto';
import { CreatePlayerCardDto } from '../../players/dto/create-player-card.dto';
import { CreateThemeDto } from '../../players/dto/create-theme.dto';
import { Player } from '../../players/entities/player.entity';
import { PlayerCard } from '../../players/entities/player-card.entity';
import { Theme } from '../../players/entities/theme.entity';
import dataSource from '../data-source';

interface LegendDemoData {
  themes: Array<{
    code: string;
    name: string;
    description: string;
    cardDefaults: Record<string, unknown>;
    players: Array<{
      nickname: string;
      nationality: string;
      mainPosition: string;
      cardOverrides?: Record<string, unknown>;
    }>;
  }>;
}

function validateDto<T extends object>(value: T, label: string): T {
  const errors = validateSync(value, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  if (errors.length > 0) {
    throw new Error(
      `Invalid legend demo ${label}: ${errors.map((error) => error.property).join(', ')}`,
    );
  }
  return value;
}

async function seedLegends(): Promise<void> {
  const raw: unknown = JSON.parse(
    await readFile(resolve(__dirname, 'legend-demo.json'), 'utf8'),
  );
  if (
    !raw ||
    typeof raw !== 'object' ||
    !('themes' in raw) ||
    !Array.isArray(raw.themes)
  ) {
    throw new Error('legend-demo.json must contain a themes array');
  }
  const data = raw as LegendDemoData;
  const themeCodes = new Set<string>();
  const validated = data.themes.map((theme) => {
    const themeDto = validateDto(
      plainToInstance(CreateThemeDto, {
        code: theme.code,
        name: theme.name,
        description: theme.description,
        legendEnabled: true,
      }),
      'theme',
    );
    if (
      !themeDto.code.startsWith('DEMO_LEGEND_') ||
      themeCodes.has(themeDto.code)
    ) {
      throw new Error('Demo seed requires unique DEMO_LEGEND_ theme codes');
    }
    themeCodes.add(themeDto.code);
    if (!Array.isArray(theme.players) || theme.players.length === 0) {
      throw new Error(`Demo theme ${theme.code} must include players`);
    }
    return {
      themeDto,
      players: theme.players.map((entry) => {
        const playerDto = validateDto(
          plainToInstance(CreatePlayerDto, {
            nickname: entry.nickname,
            nationality: entry.nationality,
          }),
          'player',
        );
        if (!playerDto.nickname.startsWith('DEMO_LEGEND_')) {
          throw new Error(
            'Demo seed can only create DEMO_LEGEND_ player identities',
          );
        }
        const cardDto = validateDto(
          plainToInstance(CreatePlayerCardDto, {
            ...theme.cardDefaults,
            ...entry.cardOverrides,
            mainPosition: entry.mainPosition,
            playerId: 1,
            themeId: 1,
          }),
          'card',
        );
        return { playerDto, cardDto };
      }),
    };
  });

  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  let locked = false;
  try {
    const rows: unknown = await runner.query(
      'SELECT GET_LOCK(?, 10) AS acquired',
      ['lolplayergame:seed:legends'],
    );
    const acquired = Array.isArray(rows)
      ? (rows[0] as { acquired?: unknown } | undefined)?.acquired
      : undefined;
    // mysql2 can return this BIGINT expression as a string.
    locked = acquired === 1 || acquired === '1';
    if (!locked)
      throw new Error(
        'Another legend seed is running; retry when it completes',
      );
    await runner.startTransaction();
    const counts = { themesCreated: 0, playersCreated: 0, cardsCreated: 0 };
    for (const { themeDto, players } of validated) {
      let theme = await runner.manager.findOneBy(Theme, {
        code: themeDto.code,
      });
      if (!theme) {
        theme = await runner.manager.save(
          Theme,
          runner.manager.create(Theme, {
            ...themeDto,
            description: themeDto.description ?? null,
          }),
        );
        counts.themesCreated += 1;
      }
      for (const { playerDto, cardDto } of players) {
        const matches = await runner.manager.findBy(Player, {
          nickname: playerDto.nickname,
        });
        if (
          matches.length > 1 ||
          (matches[0] && matches[0].nationality !== playerDto.nationality)
        ) {
          throw new Error(
            `Ambiguous existing demo identity: ${playerDto.nickname}`,
          );
        }
        let player = matches[0];
        if (!player) {
          player = await runner.manager.save(
            Player,
            runner.manager.create(Player, playerDto),
          );
          counts.playersCreated += 1;
        }
        const existingCard = await runner.manager.findOneBy(PlayerCard, {
          playerId: player.id,
          themeId: theme.id,
          cardYear: cardDto.cardYear,
        });
        if (!existingCard) {
          await runner.manager.save(
            PlayerCard,
            runner.manager.create(PlayerCard, {
              ...cardDto,
              playerId: player.id,
              themeId: theme.id,
              imageUrl: cardDto.imageUrl ?? null,
            }),
          );
          counts.cardsCreated += 1;
        }
      }
    }
    await runner.commitTransaction();
    console.log('DEVELOPMENT DEMO legend catalog seed complete:', counts);
    console.log('Existing catalog values and all career saves were preserved.');
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    throw error;
  } finally {
    if (locked)
      await runner.query('SELECT RELEASE_LOCK(?)', [
        'lolplayergame:seed:legends',
      ]);
    await runner.release();
    await dataSource.destroy();
  }
}

seedLegends().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Legend demo seed failed',
  );
  process.exitCode = 1;
});
