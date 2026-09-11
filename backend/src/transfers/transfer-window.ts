import { ConflictException } from '@nestjs/common';
import { getCalendarYear } from '../calendars/calendar-date';

export const TRANSFER_WINDOW_CONFIG = {
  opensOn: '11-19',
  endsOn: '12-31',
} as const;

export type TransferWindowBoundaryType = 'OPEN' | 'CLOSE';

export interface TransferWindowState {
  seasonYear: number;
  isOpen: boolean;
  opensAt: string;
  endsAt: string;
  nextBoundaryDate: string | null;
  nextBoundaryType: TransferWindowBoundaryType;
}

export function getTransferWindow(date: string): TransferWindowState {
  const year = getCalendarYear(date);
  const opensAt = `${year}-${TRANSFER_WINDOW_CONFIG.opensOn}`;
  const endsAt = `${year}-${TRANSFER_WINDOW_CONFIG.endsOn}`;
  const isOpen = date >= opensAt && date <= endsAt;
  return {
    seasonYear: year,
    isOpen,
    opensAt,
    endsAt,
    nextBoundaryDate: isOpen
      ? year < 9999
        ? `${year + 1}-01-01`
        : null
      : opensAt,
    nextBoundaryType: isOpen ? 'CLOSE' : 'OPEN',
  };
}

export function assertTransferWindow(date: string, offeredDate?: string): void {
  const window = getTransferWindow(date);
  if (
    !window.isOpen ||
    (offeredDate !== undefined &&
      (offeredDate < window.opensAt || offeredDate > date))
  ) {
    throw new ConflictException(
      '신규 영입은 11월 19일부터 12월 31일까지 같은 이적시장 안에서 완료해야 합니다.',
    );
  }
}
