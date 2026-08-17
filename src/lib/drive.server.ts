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

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

function esc(v: string) {
  return v.replace(/'/g, "\\'");
}

/** Finds a folder by name (optionally under a parent). Returns null when missing. */
export async function findFolder(name: string, parentId = "root"): Promise<string | null> {
  const q = [
    `name = '${esc(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${esc(parentId)}' in parents`,
  ].join(" and ");
  const found = await driveJson(
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,name)")}&pageSize=5`,
  );
  return (found?.files?.[0]?.id as string | undefined) ?? null;
}

export function folderLink(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

export function fileIdFromLink(link: string): string | null {
  return (
    /\/file\/d\/([a-zA-Z0-9_-]+)/.exec(link)?.[1] ??
    /[?&]id=([a-zA-Z0-9_-]+)/.exec(link)?.[1] ??
    /\/d\/([a-zA-Z0-9_-]+)/.exec(link)?.[1] ??
    null
  );
}

export async function listFolderFiles(folderId: string): Promise<DriveFile[]> {
  const q = `'${esc(folderId)}' in parents and trashed = false`;
  const json = await driveJson(
    `/drive/v3/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent(
      "files(id,name,mimeType,modifiedTime)",
    )}&orderBy=${encodeURIComponent("modifiedTime desc")}&pageSize=200`,
  );
  return (json?.files ?? []) as DriveFile[];
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  return (await driveJson(
    `/drive/v3/files/${fileId}?fields=${encodeURIComponent("id,name,mimeType,modifiedTime")}`,
  )) as DriveFile;
}

async function driveRaw(path: string): Promise<Response> {
  const res = await fetch(`${GATEWAY}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Drive download failed [${res.status}] ${path}: ${body}`);
    throw new Error(`Google Drive download failed [${res.status}]`);
  }
  return res;
}

/** Raw bytes of a binary Drive file (PDF, txt, ...). */
export async function downloadFileBytes(fileId: string): Promise<Uint8Array> {
  const res = await driveRaw(`/drive/v3/files/${fileId}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}

/** CSV text of a Google Sheets file, or plain text of a CSV/text file. */
export async function downloadAsCsv(file: DriveFile): Promise<string> {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const res = await driveRaw(`/drive/v3/files/${file.id}/export?mimeType=text%2Fcsv`);
    return res.text();
  }
  const res = await driveRaw(`/drive/v3/files/${file.id}?alt=media`);
  return res.text();
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
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