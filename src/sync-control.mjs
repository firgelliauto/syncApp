export function rolloutReady(env) {
  return env.SYNC_ENABLED === 'true' && env.ALLOW_INVENTORY_WRITES === 'true' &&
    env.FULL_ROLLOUT_COMPLETE === 'true';
}

export function canManageSync(user, env) {
  return user?.side === 'main' && typeof user.userId === 'string' &&
    Boolean(env.SYNC_CONTROL_USER_ID) && user.userId === env.SYNC_CONTROL_USER_ID;
}

export function syncActive(env, paused) {
  return rolloutReady(env) && !paused;
}
