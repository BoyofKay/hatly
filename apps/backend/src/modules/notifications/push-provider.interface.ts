/**
 * Abstraction over wherever push notifications actually get delivered.
 * Business logic (PushNotificationService) depends only on this
 * interface — never on a concrete provider — matching the existing
 * SmsProvider/UploadProvider pattern exactly (see
 * auth/sms-provider.interface.ts). A real Firebase implementation can
 * be replaced later without touching PushNotificationService or
 * anything that calls it.
 *
 * `invalidTokens` reports back which of the SENT tokens Firebase
 * identified as invalid/unregistered — CONFIRMED per this chunk's own
 * requirement: only the specific reported tokens are ever deactivated,
 * never a blanket "clear all tokens for this user" response.
 */
export interface PushSendResult {
  success: boolean;
  invalidTokens: string[];
}

export interface PushNotificationProvider {
  sendToTokens(params: {
    tokens: string[];
    title: string;
    body: string;
    data: Record<string, string>;
  }): Promise<PushSendResult>;
}

export const PUSH_NOTIFICATION_PROVIDER = Symbol('PUSH_NOTIFICATION_PROVIDER');
