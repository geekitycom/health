export type WeightUnit = 'lb' | 'kg';

export type Config = {
    port: number;
    databasePath: string;
    timeZone: string;
    weightUnit: WeightUnit;
    appPassword: string | undefined;
    mcpToken: string | undefined;
};

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env): Config {
    return {
        port: positiveInt(env, 'PORT', 3000, 65535),
        databasePath: env.DATABASE_PATH || 'data/health.db',
        timeZone: timeZone(env.TIME_ZONE),
        weightUnit: weightUnit(env.WEIGHT_UNIT),
        appPassword: env.APP_PASSWORD || undefined,
        mcpToken: env.MCP_TOKEN || undefined
    };
}

function timeZone(raw: string | undefined): string {
    if (!raw) return Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: raw });
    } catch {
        throw new Error(`TIME_ZONE is not a valid IANA time zone: ${raw}`);
    }
    return raw;
}

function weightUnit(raw: string | undefined): WeightUnit {
    const value = raw?.toLowerCase() || 'lb';
    if (value === 'lb' || value === 'kg') return value;
    throw new Error(`WEIGHT_UNIT must be lb or kg, got: ${raw}`);
}

function positiveInt(
    env: Env,
    name: string,
    fallback: number,
    max = Number.MAX_SAFE_INTEGER
): number {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${name} must be a positive integer, got: ${raw}`);
    }
    if (value > max) {
        throw new Error(`${name} must be at most ${max}, got: ${raw}`);
    }
    return value;
}
