/**
 * Imported FIRST by a suite that runs the app with Maps disabled (PD-009 G). `setupFiles` (env.ts) re-applies the pinned E2E
 * environment before every test file, so this override never leaks into another suite.
 */
process.env.MAPS_PROVIDER = 'none';
delete process.env.GOOGLE_MAPS_API_KEY;
