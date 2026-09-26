// @dsh-ssh/dsh-ssh — host settings surface for the SSH host dict.
//
// DSH 0.1.7 replaced registrable settings namespaces with a forms service over the
// profile's own entries (dsh-settings SettingsForms): a form is addressed by the
// Loader ROW's entry id, its schema is the plugin module's exported Config, and its
// live value is the fiber config. The host dict therefore lives in this plugin's own
// profile entry (config.hosts) instead of a 'dsh-ssh-hosts' section of the retired
// settings.yaml, and reads/writes go through ctx.settings.describe()/mutate().
import z from '@deepseek-ai/schemastery';

/** Bundle-patch row id; used when no loader row identifies this plugin instance. */
export const HOST_ENTRY_FALLBACK_ID = '@dsh-ssh/dsh-ssh';

/** This package's name, as the Loader row's `name` spells it. */
export const PLUGIN_PACKAGE_NAME = '@dsh-ssh/dsh-ssh';

/** Default connection-pool size (deployment tuning, not user data). */
export const DEFAULT_MAX_CONNECTIONS = 4;

/** Config key holding the host dict (id → HostConfig). */
export const HOSTS_KEY = 'hosts';

// HostConfig — one SSH target. Mirrors the ssh-core HostConfig shape.
export const HostConfigSchema = z.object({
  id: z.string().required().description('稳定 id(占位目录路径依赖, 如 uuid)'),
  name: z.string().description('显示名'),
  host: z.string().required().description('主机名或 IP'),
  port: z.number().min(1).max(65535).default(22).description('SSH 端口'),
  user: z.string().required().description('登录用户'),
  auth: z
    .union([
      z.object({ type: z.const('key'), privateKeyPath: z.string().description('私钥路径; 缺省走 ssh-agent') }),
      z.object({ type: z.const('password'), password: z.string().role('secret').description('口令; write-only(保存后不回传, 留空沿用已保存值); 当前以明文落 profile patch, 属已知待改进项') }),
    ])
    .default({ type: 'key' })
    .description('认证方式'),
  knownHostsPath: z.string().description('known_hosts 路径; 缺省 ~/.ssh/known_hosts'),
  connectTimeoutMs: z.number().min(500).default(10_000).description('连接超时(ms)'),
  keepaliveIntervalMs: z.number().min(1_000).default(15_000).description('keepalive 间隔(ms)'),
});

// The host dict (id → HostConfig). A dict keeps the settings merge able to preserve
// the stored password when auth.password is omitted (a write-only field left blank =
// keep as-is); deletion writes the whole dict minus the removed id.
export const HostsConfigSchema = z.dict(HostConfigSchema).default({});

// This plugin's Loader row schema. DSH's forms service exposes a row only when its
// schema carries at least one VOLATILE field, and only volatile paths are editable:
// the host dict is the user-editable half, while maxConnections stays deployment
// tuning. `.volatile()` returns a copy, so the marked schema is what the row carries.
export const Config = z.object({
  maxConnections: z.number().step(1).min(1).max(64).default(DEFAULT_MAX_CONNECTIONS),
  hosts: HostsConfigSchema.volatile(),
});

/** Extract the hosts dict from a settings form value (tolerant of undefined). */
export function hostsOf(value) {
  return value && typeof value === 'object' && value[HOSTS_KEY] && typeof value[HOSTS_KEY] === 'object'
    ? value[HOSTS_KEY]
    : {};
}

/**
 * The Loader row id of this plugin instance — the settings form is addressed by it.
 * An aggregate bundle may mount the same package under its own id, so the row whose
 * fiber is this plugin's is preferred; a disabled duplicate is never a fallback.
 * @param ctx - host plugin context (its `loader` lists the composed rows).
 * @param packageName - this package's name as it appears in the row's `name`.
 * @returns the row id, or undefined when the loader exposes no matching row.
 */
export function resolveOwnEntryId(ctx, packageName) {
  let fallback;
  try {
    for (const entry of ctx?.loader?.entries?.() ?? []) {
      const id = entry?.options?.id;
      if (entry?.options?.name !== packageName || typeof id !== 'string' || id === '') continue;
      if (entry.fiber === ctx.fiber) return id;
      if (entry.disabled !== true && fallback === undefined) fallback = id;
    }
  } catch {
    return undefined;
  }
  return fallback;
}

/**
 * Stored hosts of this plugin read from any host/agent context, without the settings
 * service being injected: describe() is safe to call from a ctx that owns it.
 * @param ctx - host or agent context exposing the settings service.
 * @returns the hosts dict (unredacted), or {} when the settings form is unavailable.
 */
export function storedHosts(ctx) {
  try {
    const settings = ctx?.get ? ctx.get('settings') : ctx?.settings;
    if (!settings || typeof settings.describe !== 'function') return {};
    const entryId = resolveOwnEntryId(ctx, PLUGIN_PACKAGE_NAME) ?? HOST_ENTRY_FALLBACK_ID;
    const descriptor = (settings.describe() ?? []).find((row) => row && row.ns === entryId);
    return hostsOf(descriptor && descriptor.value);
  } catch {
    return {};
  }
}
