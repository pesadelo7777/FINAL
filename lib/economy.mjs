export const INITIAL_FREE_COINS = 10;
export const DAILY_FREE_COINS = 5;
export const COINS_PER_1000_CREDITS = 8;
export const CREDITS_PER_PACKAGE = 1000;

export function coinsForConfirmedCredits(credits) {
  if (!Number.isSafeInteger(credits) || credits < CREDITS_PER_PACKAGE) return null;
  if (credits % CREDITS_PER_PACKAGE !== 0) return null;
  return (credits / CREDITS_PER_PACKAGE) * COINS_PER_1000_CREDITS;
}
