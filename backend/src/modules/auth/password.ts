import argon2 from 'argon2';

// OWASP-recommended Argon2id baseline: m=19 MiB, t=2, p=1.
const OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string): Promise<string> => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

export const needsRehash = (hash: string): boolean => argon2.needsRehash(hash, OPTIONS);

/** Verified against when the account does not exist, so response time does not reveal existence. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword('not-a-real-password-timing-equaliser'));
