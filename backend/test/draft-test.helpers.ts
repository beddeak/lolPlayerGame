import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { MatchSeries } from '../src/match-series/entities/match-series.entity';
import { MatchSeriesResponseDto } from '../src/match-series/dto/match-series-response.dto';
import { updateSeriesDraft } from '../src/drafts/series-draft.store';
import { autoCompleteDraft } from '../src/drafts/draft-state';

// Long season regression tests need valid drafts without waiting on UI timers.
// The interactive action API itself is separately exercised in app.e2e-spec.
export async function finishDraftForTest(
  db: DataSource,
  seriesId: number,
  game: number,
) {
  const series = await db.manager.findOneOrFail(MatchSeries, {
    where: { id: seriesId },
    relations: { career: true },
  });
  const draft = await updateSeriesDraft(
    db,
    series.career.accountId,
    seriesId,
    game,
  );
  const { serverNow, ...state } = draft;
  await db.manager.update(MatchSeries, seriesId, {
    drafts: {
      ...series.drafts,
      [String(game)]: autoCompleteDraft(state, serverNow),
    },
  });
}

export async function playFixtureForTest(
  app: INestApplication<App>,
  db: DataSource,
  token: string,
  path: string,
) {
  const api = request(app.getHttpServer());
  const prepared = await api
    .post(`${path}/prepare`)
    .set('Authorization', `Bearer ${token}`)
    .expect(201);
  let series = (prepared.body as { series: MatchSeriesResponseDto }).series;
  let response = prepared;
  while (series.nextGameNumber !== null) {
    await finishDraftForTest(db, series.seriesId, series.nextGameNumber);
    response = await api
      .post(`${path}/games/simulate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ gameNumber: series.nextGameNumber })
      .expect(201);
    series = (
      await api
        .get(`/match-series/${series.seriesId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as MatchSeriesResponseDto;
  }
  return response;
}
