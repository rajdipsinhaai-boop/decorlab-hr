/**
 * Server-only Google Drive access through the Lovable connector gateway.
 * Credentials never reach the browser.
 */
const GATEWAY = "https://connector-gateway.lovable.dev/google_drive";

function authHeaders() {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const connectionKey = process.env["GOOGLE_DRIVE_API_KEY"];
  if (!lovableKey || !connectionKey) {
    throw new Error("Google Drive connection is not configured on the server.");
  }
  return {
    Authorization: `Bearer ${lovableKey}`,
    "X-Connection-Api-Key": connectionKey,
  };
}

async function driveJson(path: string, init?: RequestInit) {
  const res = await fetch(`${GATEWAY}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Drive request failed [${res.status}] ${path}: ${body}`);
    throw new Error(`Google Drive request failed [${res.status}]`);
  }
  return res.json() as Promise<any>;
}

/** Finds a folder by name at Drive root, creating it when missing. */
export async function findOrCreateFolder(name: string): Promise<string> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    "'root' in parents",
  ].join(" and ");
  const found = await driveJson(
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=1`,
  );
  const existing = found?.files?.[0]?.id as string | undefined;
  if (existing) return existing;

  const created = await driveJson(`/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: ["root"],
    }),
  });
  return created.id as string;
}

/** Uploads a file (base64 payload) into a folder and returns its shareable Drive link. */
export async function uploadFile(opts: {
  folderId: string;
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<string> {
  const boundary = `decorlab-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: opts.filename, parents: [opts.folderId] });
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
    `--${boundary}\r\nContent-Type: ${opts.mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${opts.base64}\r\n` +
    `--${boundary}--`;

  const res = await fetch(
    `${GATEWAY}/upload/drive/v3/files?uploadType=multipart&fields=${encodeURIComponent("id,webViewLink")}`,
    {
      method: "POST",
      headers: {
        ...authHeaders(),
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const text = await res.text();
    console.error(`Drive upload failed [${res.status}]: ${text}`);
    throw new Error(`Could not upload the file to Drive [${res.status}]`);
  }
  const json = (await res.json()) as { id: string; webViewLink?: string };
  return json.webViewLink ?? `https://drive.google.com/file/d/${json.id}/view`;
}