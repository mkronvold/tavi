const GENERATED_PASSWORD_LENGTH = 20;
const PASSWORD_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

export function generateAlphanumericPassword(
  length = GENERATED_PASSWORD_LENGTH,
) {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Unable to generate a secure password in this browser.");
  }

  const password: string[] = [];
  const maxValidRandomValue =
    Math.floor(256 / PASSWORD_ALPHABET.length) * PASSWORD_ALPHABET.length;

  while (password.length < length) {
    const randomValues = globalThis.crypto.getRandomValues(
      new Uint8Array(length - password.length),
    );

    for (const randomValue of randomValues) {
      if (randomValue >= maxValidRandomValue) {
        continue;
      }

      password.push(PASSWORD_ALPHABET[randomValue % PASSWORD_ALPHABET.length]);
      if (password.length === length) {
        break;
      }
    }
  }

  return password.join("");
}
