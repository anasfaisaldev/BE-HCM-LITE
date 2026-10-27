/**
 * Salary representation (single source of truth):
 *   basic   = stored input
 *   hra     = 40% of basic
 *   medical = 10% of basic
 *   gross   = basic + hra + medical = 1.5 x basic
 * "Gross = 1.5 x basic" and the allowance rules are the same statement, not two
 * additions: allowances are components OF gross and are never added on top of it.
 */
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function salaryFromBasic(basic) {
  const b = round2(basic);
  const hra = round2(b * 0.4);
  const medical = round2(b * 0.1);
  return { basic: b, hra, medical, gross: round2(b + hra + medical) };
}
