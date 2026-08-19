import { createPrivateKey, createSign } from "node:crypto";

type ServiceAccountJson = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};

let cachedToken: { value: string; expiresAt: number } | undefined;

function normalizePrivateKey(value: string): string {
  let key = value.trim().replace(/^['"]|['"]$/g, "");
  key = key.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\r\n/g, "\n");
  const match = key.match(/-----BEGIN ([^-]+)-----([\s\S]*?)-----END \1-----/);
  if (!match) return key;
  const label = match[1];
  const body = match[2].replace(/\s+/g, "");
  const wrapped = body.match(/.{1,64}/g)?.join("\n") ?? body;
  return `-----BEGIN ${label}-----\n${wrapped}\n-----END ${label}-----\n`;
}

function readServiceAccount(): ServiceAccountJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccountJson>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: normalizePrivateKey(parsed.private_key),
          token_uri: parsed.token_uri,
        };
      }
    } catch {
      throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    };
  }

  throw new Error("Google service-account credentials are not configured on the server.");
}

function base64Url(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
  return bytes
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

async function createAccessToken() {
  const credentials = readServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: credentials.client_email,
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive",
      aud: credentials.token_uri ?? "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const unsigned = `${header}.${claim}`;
  const privateKey = normalizePrivateKey(credentials.private_key);
  const body = privateKey
    .replace(/-----BEGIN [^-]+-----|-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  console.info("Google service-account key shape", {
    length: privateKey.length,
    hasBegin: privateKey.includes("BEGIN PRIVATE KEY"),
    hasEnd: privateKey.includes("END PRIVATE KEY"),
    newlineCount: privateKey.split("\\n").length - 1,
    bodyLength: body.length,
  });
  const keyObject = createPrivateKey({ key: privateKey, format: "pem", type: "pkcs8" });
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = base64Url(signer.sign(keyObject));
  const assertion = `${unsigned}.${signature}`;

  const tokenUri = credentials.token_uri ?? "https://oauth2.googleapis.com/token";
  const startedAt = Date.now();
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  console.info(`Google token request completed in ${Date.now() - startedAt}ms.`);
  if (!response.ok) {
    const body = await response.text();
    console.error(`Google token request failed [${response.status}]: ${body}`);
    throw new Error("Google authentication failed for the server integration.");
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("Google did not return an access token.");
  return {
    value: json.access_token,
    expiresAt: Date.now() + Math.max((json.expires_in ?? 3600) - 60, 60) * 1000,
  };
}

export async function googleAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  cachedToken = await createAccessToken();
  return cachedToken.value;
}

export async function googleJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${await googleAccessToken()}`,
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Google API request failed [${response.status}] ${url}: ${body}`);
    throw new Error(`Google API request failed [${response.status}].`);
  }
  return (await response.json()) as T;
}

export async function googleBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await googleAccessToken()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Google download failed [${response.status}] ${url}: ${body}`);
    throw new Error(`Google download failed [${response.status}].`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

export async function googleText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${await googleAccessToken()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = await response.text();
    console.error(`Google text download failed [${response.status}] ${url}: ${body}`);
    throw new Error(`Google text download failed [${response.status}].`);
  }
  return response.text();
}
