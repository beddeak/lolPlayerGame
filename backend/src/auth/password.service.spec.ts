import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes and verifies a password without storing the original value', async () => {
    const hash = await service.hash('correct-password');

    expect(hash).not.toContain('correct-password');
    await expect(service.verify('correct-password', hash)).resolves.toBe(true);
    await expect(service.verify('wrong-password', hash)).resolves.toBe(false);
  });

  it('rejects malformed password hashes', async () => {
    await expect(service.verify('password', 'disabled')).resolves.toBe(false);
  });
});
