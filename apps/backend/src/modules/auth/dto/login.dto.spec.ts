import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { LoginDto } from './login.dto';

const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: LoginDto };

describe('LoginDto under the production ValidationPipe (Group 8 regression: POST /auth/login {} was an HTTP 500)', () => {
  it('accepts an Egyptian mobile number', async () => {
    await expect(pipe.transform({ phone: '+201012345678' }, meta)).resolves.toMatchObject({ phone: '+201012345678' });
  });

  it.each([{}, { phone: '' }, { phone: 123 }, { phone: 'abc' }, { phone: '+1 202 555 0100' }, { phone: null }])('rejects %j with a 400', async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects unknown properties', async () => {
    await expect(pipe.transform({ phone: '+201012345678', role: 'ADMIN' }, meta)).rejects.toBeInstanceOf(BadRequestException);
  });
});
