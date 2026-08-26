import { Injectable } from '@nestjs/common';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const HASH_PREFIX = 'scrypt';
const SALT_LENGTH = 16;
const DERIVED_KEY_LENGTH = 64;

@Injectable()
export class PasswordService {
  async hash(password: string): Promise<string> {
    const salt = randomBytes(SALT_LENGTH);
    const derivedKey = await this.deriveKey(password, salt);

    return [HASH_PREFIX, salt.toString('hex'), derivedKey.toString('hex')].join(
      '$',
    );
  }

  async verify(password: string, passwordHash: string): Promise<boolean> {
    const [prefix, saltHex, derivedKeyHex, ...unexpected] =
      passwordHash.split('$');

    if (
      prefix !== HASH_PREFIX ||
      !saltHex ||
      !derivedKeyHex ||
      unexpected.length > 0
    ) {
      return false;
    }

    const salt = Buffer.from(saltHex, 'hex');
    const storedKey = Buffer.from(derivedKeyHex, 'hex');

    if (
      salt.length !== SALT_LENGTH ||
      storedKey.length !== DERIVED_KEY_LENGTH
    ) {
      return false;
    }

    const suppliedKey = await this.deriveKey(password, salt);

    return timingSafeEqual(storedKey, suppliedKey);
  }

  private deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, DERIVED_KEY_LENGTH, (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      });
    });
  }
}
