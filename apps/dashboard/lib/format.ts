const Y = 10n ** 24n;

/** yoctoNEAR string -> "1.2345" (integer math, no floats). */
export function fmtNear(yocto: string | bigint, dp = 4): string {
  const v = BigInt(yocto);
  const whole = v / Y;
  const frac = (v % Y).toString().padStart(24, "0").slice(0, dp).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function pct(part: string, whole: string): number {
  const w = BigInt(whole);
  if (w === 0n) return 0;
  return Math.min(100, Number((BigInt(part) * 10000n) / w) / 100);
}

export function fmtTime(ns: string): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleString();
}

export const REASONS: Record<string, string> = {
  exceeds_max_transaction: "Above the per-payment limit",
  exceeds_daily: "Daily limit reached",
  exceeds_weekly: "Weekly limit reached",
  exceeds_monthly: "Monthly limit reached",
  insufficient_treasury: "Not enough funds in the treasury",
  agent_paused: "Agent is paused",
  agent_revoked: "Agent is revoked",
  unregistered_agent: "Agent is not registered",
  recipient_not_allowed: "Recipient is not on the allowlist",
};

const MASK = process.env.NEXT_PUBLIC_BILA_MASK !== "0";
/** Hides account names on screen by default (the chain itself stays public). */
export function mask(id: string): string {
  if (!MASK) return id;
  const dot = id.lastIndexOf(".");
  return dot > 0 ? `${id.slice(0, 3)}•••${id.slice(dot)}` : `${id.slice(0, 3)}•••`;
}
