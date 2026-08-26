import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AuthController } from './auth.controller';

describe('AuthController HTTP semantics', () => {
  it('returns 200 for login and logout actions', () => {
    const loginHandler = Reflect.get(
      AuthController.prototype,
      'login',
    ) as unknown as object;
    const logoutHandler = Reflect.get(
      AuthController.prototype,
      'logout',
    ) as unknown as object;

    expect(Reflect.getMetadata(HTTP_CODE_METADATA, loginHandler)).toBe(
      HttpStatus.OK,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, logoutHandler)).toBe(
      HttpStatus.OK,
    );
  });
});
