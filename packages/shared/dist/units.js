/** All money is bigint yoctoNEAR. No floats anywhere. */
export const YOCTO_PER_NEAR = 10n ** 24n;
/** "2.5" -> 2500000000000000000000000n. Rejects negatives, exponents, >24 decimals. */
export function parseNear(input) {
    const s = input.trim();
    if (!/^\d+(\.\d{1,24})?$/.test(s)) {
        throw new Error(`Invalid NEAR amount "${input}". Use a plain decimal like "2.5" (max 24 decimals).`);
    }
    const [whole, frac = ""] = s.split(".");
    return BigInt(whole) * YOCTO_PER_NEAR + BigInt(frac.padEnd(24, "0"));
}
/** 2500000000000000000000000n -> "2.5" */
export function formatNear(yocto) {
    const v = BigInt(yocto);
    const whole = v / YOCTO_PER_NEAR;
    const frac = (v % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
    return frac ? `${whole}.${frac}` : `${whole}`;
}
