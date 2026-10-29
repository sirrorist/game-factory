// Никаких ключей/подключений при сборке или в Edge; включение только закрытого стенда A.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== 'phase-production-build' &&
      process.env.GF_AUTH_ACTIONS_ENABLED === 'closed-test' && process.env.GF_AUTH_MAIL_DISPATCHER === 'closed-test') {
    const { startAuthMailDispatcher } = await import('./lib/auth-actions-runtime.ts');
    startAuthMailDispatcher();
  }
}
