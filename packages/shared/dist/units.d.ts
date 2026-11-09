/** All money is bigint yoctoNEAR. No floats anywhere. */
export declare const YOCTO_PER_NEAR: bigint;
/** "2.5" -> 2500000000000000000000000n. Rejects negatives, exponents, >24 decimals. */
export declare function parseNear(input: string): bigint;
/** 2500000000000000000000000n -> "2.5" */
export declare function formatNear(yocto: bigint | string): string;
