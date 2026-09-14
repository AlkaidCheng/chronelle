import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from "node:crypto";

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error === null ? resolve(key) : reject(error),
    );
  });
}

// scrypt with N = 2^15, r = 8, p = 1 (32 MiB, roughly 50 ms), a 16-byte
// salt, and a 32-byte key. The encoding carries the parameters so a later
// cost change verifies old hashes and re-hashes on the next sign-in.
const cost = 2 ** 15;
const blockSize = 8;
const parallelization = 1;
const saltLength = 16;
const keyLength = 32;

const encodedShape =
  /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

async function derive(
  password: string,
  salt: Buffer,
  parameters: { N: number; r: number; p: number },
): Promise<Buffer> {
  return scrypt(password.normalize("NFKC"), salt, keyLength, {
    ...parameters,
    maxmem: 128 * parameters.N * parameters.r * 2,
  });
}

/** The stored form of a password: the parameters, salt, and key, base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(saltLength);
  const key = await derive(password, salt, {
    N: cost,
    r: blockSize,
    p: parallelization,
  });
  return [
    "scrypt",
    cost,
    blockSize,
    parallelization,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/** Whether a password produces the stored key; false for a malformed hash. */
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = encodedShape.exec(encoded);
  if (match === null) return false;
  const [, N, r, p, salt, key] = match;
  const expected = Buffer.from(key ?? "", "base64url");
  if (expected.length !== keyLength) return false;
  const actual = await derive(password, Buffer.from(salt ?? "", "base64url"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}
