import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { RefreshTokenStore } from './refresh-token.store';
import { JwtStrategy } from './strategies/jwt.strategy';
import { UsersModule } from '../users/users.module';
import { BusinessConfigModule } from '../business-config/business-config.module';
import { SMS_PROVIDER } from './sms-provider.interface';
import { UnifonicSmsProvider } from './providers/unifonic-sms.provider';
import { LoginAttemptLimiter } from './login-attempt-limiter';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({}), BusinessConfigModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    RefreshTokenStore,
    LoginAttemptLimiter,
    JwtStrategy,
    UnifonicSmsProvider,
    { provide: SMS_PROVIDER, useClass: UnifonicSmsProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
