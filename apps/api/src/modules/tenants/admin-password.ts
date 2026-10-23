/**
 * The first password of a company's administrator: the first letters of the company's words, then
 * "@", then the year it was registered ("Sierra Coaches Ltd" in 2026 gives "SCL@2026"). It is
 * guessable on purpose of the design, so the account must replace it at first sign-in.
 */
export function defaultAdminPassword(companyName: string, year: number): string {
  const initials = companyName
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .split(/[^A-Za-z]+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 6)
    .join('');
  return `${initials || 'NTS'}@${year}`;
}
