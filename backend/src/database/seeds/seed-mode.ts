/** Real catalog data must not implicitly create an account or mutate a career. */
export function isCatalogOnlySeed(
  managedTeamCode: string | undefined,
  args: readonly string[],
): boolean {
  return args.includes('--catalog-only') || !managedTeamCode?.trim();
}
