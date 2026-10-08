import { createHmac, timingSafeEqual } from "node:crypto";
import { all, one, run as dbRun, nowIso, uid, kvGet, kvSet } from "@/lib/db";
import { problem } from "@/lib/http";

export interface GitHubAppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string;
  permissions: Record<string, string>;
  repositorySelection: "all" | "selected";
}

const GITHUB_API = "https://api.github.com";
const TOKEN_CACHE_PREFIX = "gh_app_installation_token:";

/**
 * Generate a JWT for GitHub App authentication.
 * See: https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app
 */
export async function generateAppJwt(config: GitHubAppConfig): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iat: now - 60, // 60 seconds in the past to account for clock skew
    exp: now + 600, // 10 minutes
    iss: config.appId,
  };

  const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  
  // Import the private key for signing
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(config.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`),
  );

  const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
    .replace(/-----END RSA PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Get an installation access token for a given installation ID.
 * Caches tokens in KV with 5-minute buffer before expiry.
 */
export async function getInstallationToken(
  config: GitHubAppConfig,
  installationId: string,
): Promise<InstallationToken> {
  const cacheKey = `${TOKEN_CACHE_PREFIX}${installationId}`;
  const cached = await kvGet(cacheKey);
  if (cached) {
    const token = JSON.parse(cached) as InstallationToken;
    const expiry = new Date(token.expiresAt).getTime();
    if (expiry - Date.now() > 5 * 60 * 1000) {
      return token;
    }
  }

  const jwt = await generateAppJwt(config);
  const res = await fetch(`${GITHUB_API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
    },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get installation token: ${res.status} ${err}`);
  }

  const data = await res.json();
  const token: InstallationToken = {
    token: data.token,
    expiresAt: data.expires_at,
    permissions: data.permissions,
    repositorySelection: data.repository_selection,
  };

  await kvSet(cacheKey, JSON.stringify(token));
  return token;
}

/**
 * Verify a GitHub webhook signature using the App's webhook secret.
 * Supports both `sha256=` (GitHub App) and `sha1=` (legacy) formats.
 */
export function verifyWebhookSignature(
  config: GitHubAppConfig,
  payload: string,
  signature: string,
): boolean {
  if (!signature) return false;
  
  const [algo, sig] = signature.split("=");
  if (!algo || !sig) return false;

  const expected = createHmac(algo === "sha256" ? "sha256" : "sha1", config.webhookSecret)
    .update(payload)
    .digest("hex");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Get the installation ID for a repository.
 * Returns null if the repository is not installed with the App.
 */
export async function getInstallationIdForRepo(
  config: GitHubAppConfig,
  owner: string,
  repo: string,
): Promise<string | null> {
  const jwt = await generateAppJwt(config);
  const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/installation`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      accept: "application/vnd.github+json",
    },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to get installation: ${res.status} ${err}`);
  }

  const data = await res.json();
  return String(data.id);
}

/**
 * Exchange a GitHub App installation token for repository access.
 * Used by the runner to clone private repositories.
 */
export async function getRepoCloneUrl(
  config: GitHubAppConfig,
  installationId: string,
  owner: string,
  repo: string,
): Promise<string> {
  const { token } = await getInstallationToken(config, installationId);
  return `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
}

/**
 * Middleware to verify GitHub App webhook and extract installation context.
 */
export async function verifyGitHubAppWebhook(
  req: Request,
  config: GitHubAppConfig,
): Promise<{ payload: any; installationId: string | null } | null> {
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? req.headers.get("x-hub-signature") ?? "";
  
  if (!verifyWebhookSignature(config, raw, signature)) {
    return null;
  }

  const payload = JSON.parse(raw);
  const installationId = payload.installation?.id ? String(payload.installation.id) : null;
  
  return { payload, installationId };
}

export function getConfig(): GitHubAppConfig | null {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  
  if (!appId || !privateKey || !webhookSecret) return null;
  
  return { appId, privateKey, webhookSecret };
}