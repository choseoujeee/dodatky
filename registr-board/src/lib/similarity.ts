/**
 * Jednoduchá podobnost řetězců (0–1), aproximace chování difflib pro krátké až střední texty.
 * Pro velmi dlouhé řetězce používáme zkrácení kvůli výkonu.
 */
const MAX_LEN = 200;

function truncate(s: string): string {
  return s.length <= MAX_LEN ? s : s.slice(0, MAX_LEN);
}

export function sequenceRatio(a: string, b: string): number {
  const s1 = truncate(a);
  const s2 = truncate(b);
  if (s1 === s2) return 1;
  if (!s1 || !s2) return 0;
  const len1 = s1.length;
  const len2 = s2.length;
  const dp: number[] = new Array(len2 + 1);
  for (let j = 0; j <= len2; j++) dp[j] = j;
  for (let i = 1; i <= len1; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= len2; j++) {
      const temp = dp[j];
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }
  const dist = dp[len2];
  const maxLen = Math.max(len1, len2);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}
