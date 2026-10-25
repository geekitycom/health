import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export const OAUTH_SCHEMA = `
CREATE TABLE oauth_clients (
    client_id TEXT PRIMARY KEY,
    secret_hash TEXT,
    name TEXT,
    redirect_uris TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE oauth_codes (
    code_hash TEXT PRIMARY KEY,
    client_id TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
    redirect_uri TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE oauth_tokens (
    token_hash TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
    client_id TEXT NOT NULL REFERENCES oauth_clients (client_id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);
`;

export type OAuthClient = {
    clientId: string;
    hasSecret: boolean;
    name: string | null;
    redirectUris: string[];
};

export type TokenKind = 'access' | 'refresh';

export function newSecret(): string {
    return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
}

export type OAuthStore = ReturnType<typeof oauthStore>;

// Secrets, codes and tokens are stored only as SHA-256 hashes.
export function oauthStore(db: DatabaseSync) {
    return {
        addClient(
            client: Omit<OAuthClient, 'hasSecret'>,
            secret: string | null,
            now: number
        ) {
            db.prepare(
                `INSERT INTO oauth_clients
                 (client_id, secret_hash, name, redirect_uris, created_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(
                client.clientId,
                secret === null ? null : sha256(secret),
                client.name,
                JSON.stringify(client.redirectUris),
                now
            );
        },

        client(clientId: string): OAuthClient | undefined {
            const row = db
                .prepare('SELECT * FROM oauth_clients WHERE client_id = ?')
                .get(clientId) as
                | {
                      client_id: string;
                      secret_hash: string | null;
                      name: string | null;
                      redirect_uris: string;
                  }
                | undefined;
            return (
                row && {
                    clientId: row.client_id,
                    hasSecret: row.secret_hash !== null,
                    name: row.name,
                    redirectUris: JSON.parse(row.redirect_uris) as string[]
                }
            );
        },

        clientSecretMatches(clientId: string, secret: string): boolean {
            return Boolean(
                db
                    .prepare(
                        'SELECT 1 FROM oauth_clients WHERE client_id = ? AND secret_hash = ?'
                    )
                    .get(clientId, sha256(secret))
            );
        },

        addCode(
            code: string,
            grant: {
                clientId: string;
                redirectUri: string;
                codeChallenge: string;
            },
            expiresAt: number
        ) {
            db.prepare(
                `INSERT INTO oauth_codes
                 (code_hash, client_id, redirect_uri, code_challenge, expires_at)
                 VALUES (?, ?, ?, ?, ?)`
            ).run(
                sha256(code),
                grant.clientId,
                grant.redirectUri,
                grant.codeChallenge,
                expiresAt
            );
        },

        /** Codes are single use: taking one deletes it. */
        takeCode(code: string, now: number) {
            const row = db
                .prepare(
                    'DELETE FROM oauth_codes WHERE code_hash = ? RETURNING *'
                )
                .get(sha256(code)) as
                | {
                      client_id: string;
                      redirect_uri: string;
                      code_challenge: string;
                      expires_at: number;
                  }
                | undefined;
            if (!row || row.expires_at <= now) return undefined;
            return {
                clientId: row.client_id,
                redirectUri: row.redirect_uri,
                codeChallenge: row.code_challenge
            };
        },

        addToken(
            token: string,
            kind: TokenKind,
            clientId: string,
            expiresAt: number
        ) {
            db.prepare(
                `INSERT INTO oauth_tokens (token_hash, kind, client_id, expires_at)
                 VALUES (?, ?, ?, ?)`
            ).run(sha256(token), kind, clientId, expiresAt);
        },

        /** Client id of a live token of this kind, or undefined. */
        tokenClient(
            token: string,
            kind: TokenKind,
            now: number
        ): string | undefined {
            const row = db
                .prepare(
                    `SELECT client_id FROM oauth_tokens
                     WHERE token_hash = ? AND kind = ? AND expires_at > ?`
                )
                .get(sha256(token), kind, now) as
                { client_id: string } | undefined;
            return row?.client_id;
        },

        revokeToken(token: string) {
            db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(
                sha256(token)
            );
        },

        purgeExpired(now: number) {
            db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').run(
                now
            );
            db.prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?').run(
                now
            );
        }
    };
}
