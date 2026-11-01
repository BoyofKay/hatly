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
import { TypeOrmModule } from '@nestjs/typeorm';
import { StaffMfaCredential } from './mfa/staff-mfa.entity';
import { StaffMfaService } from './mfa/staff-mfa.service';
import { StaffMfaAdminController, StaffMfaController } from './mfa/staff-mfa.controller';
import { DashboardSessionController } from './dashboard-session.controller';
import { AccountDeletionService } from './account-deletion.service';
import { AccountDeletionRequest } from './deletion/account-deletion-request.entity';
import { AdminAccountDeletionRequestsController, PublicAccountDeletionController } from './deletion/account-deletion.controllers';
import { UploadsModule } from '../uploads/uploads.module';

@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({}), BusinessConfigModule, TypeOrmModule.forFeature([StaffMfaCredential, AccountDeletionRequest]), UploadsModule],
  controllers: [AuthController, DashboardSessionController, StaffMfaController, StaffMfaAdminController, PublicAccountDeletionController, AdminAccountDeletionRequestsController],
  providers: [
    AuthService,
    AccountDeletionService,
    OtpService,
    RefreshTokenStore,
    LoginAttemptLimiter,
    StaffMfaService,
    JwtStrategy,
    UnifonicSmsProvider,
    { provide: SMS_PROVIDER, useClass: UnifonicSmsProvider },
  ],
  exports: [AuthService, StaffMfaService, RefreshTokenStore],
})
export class AuthModule {}
