/**
 * Abstraction over wherever OTP SMS messages actually get delivered.
 * Business logic (OtpService) depends only on this interface — never
 * on a concrete provider — matching the existing UploadProvider
 * pattern exactly (see uploads/upload-provider.interface.ts). A real
 * Unifonic implementation can replace a future stub/dev provider
 * later without touching OtpService or anything that calls it.
 *
 * `success: false` (rather than a thrown exception) is the expected,
 * ordinary outcome of a provider rejection — OtpService decides how
 * to fail closed, not the provider. A thrown exception from a
 * provider is reserved for genuinely unexpected implementation bugs,
 * not for "the SMS didn't send."
 */
export interface SmsSendResult {
  success: boolean;
  providerMessageId?: string;
}

export interface SmsProvider {
  sendSms(params: { to: string; body: string }): Promise<SmsSendResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
