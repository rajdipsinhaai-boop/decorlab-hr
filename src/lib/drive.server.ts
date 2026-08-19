import { googleBytes, googleJson, googleText } from "./google-auth.server";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

function esc(value: string) {
  return value.replace(/'/g, "\\'");
}

function configuredRootFolder() {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "root";
}

export async function findOrCreateFolder(name: string): Promise<string> {
  const parent = configuredRootFolder();
  const q = [
    `name = '${esc(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${esc(parent)}' in parents`,
  ].join(" and ");
  const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "1" });
  const found = await googleJson<{ files?: { id?: string }[] }>(
    `${DRIVE_API}/files?${params.toString()}`,
  );
  const existing = found.files?.[0]?.id;
  if (existing) return existing;

  const created = await googleJson<{ id?: string }>(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parent],
    }),
  });
  if (!created.id) throw new Error("Google Drive did not return a folder ID.");
  return created.id;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

export async function findFolder(
  name: string,
  parentId = configuredRootFolder(),
): Promise<string | null> {
  const q = [
    `name = '${esc(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${esc(parentId)}' in parents`,
  ].join(" and ");
  const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "5" });
  const found = await googleJson<{ files?: { id?: string }[] }>(
    `${DRIVE_API}/files?${params.toString()}`,
  );
  return found.files?.[0]?.id ?? null;
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
  const params = new URLSearchParams({
    q,
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: "200",
  });
  const response = await googleJson<{ files?: DriveFile[] }>(
    `${DRIVE_API}/files?${params.toString()}`,
  );
  return response.files ?? [];
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  const params = new URLSearchParams({ fields: "id,name,mimeType,modifiedTime" });
  return googleJson<DriveFile>(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`);
}

export async function downloadFileBytes(fileId: string): Promise<Uint8Array> {
  return googleBytes(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
}

export async function downloadAsCsv(file: DriveFile): Promise<string> {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    return googleText(
      `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?mimeType=text%2Fcsv`,
    );
  }
  return googleText(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

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
  return googleJson<{ id?: string; webViewLink?: string }>(
    `${UPLOAD_API}?uploadType=multipart&fields=id,webViewLink`,
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    },
  ).then((response) => {
    if (!response.id) throw new Error("Google Drive did not return an uploaded file ID.");
    return response.webViewLink ?? `https://drive.google.com/file/d/${response.id}/view`;
  });
}
