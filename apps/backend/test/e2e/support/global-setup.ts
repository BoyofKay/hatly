import { applyE2eEnv } from './config';

export default async function globalSetup(): Promise<void> {
  applyE2eEnv();
  const { resetE2eInfrastructure } = await import('./db');
  try {
    await resetE2eInfrastructure();
  } catch (error) {
    throw new Error(`Cannot prepare the E2E infrastructure. Create the database once with "npm run test:e2e:setup". Cause: ${(error as Error).message}`);
  }
}
