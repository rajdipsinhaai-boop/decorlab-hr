/**
 * Server-only Google Drive access through the native Google APIs.
 * The service-account credential is read only on the server and never reaches the browser.
 */
import { google, drive_v3 } from "googleapis";
import { Readable } from "node:stream";

type ServiceAccountJson = {
  client_email: string;
  private_key: string;
};

let driveClient: drive_v3.Drive | undefined;

function readServiceAccount(): ServiceAccountJson {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<ServiceAccountJson>;
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
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
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON on the server.",
  );
}

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;
  const credentials = readServiceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  driveClient = google.drive({ version: "v3", auth });
  return driveClient;
}

function esc(value: string) {
  return value.replace(/'/g, "\\'");
}

function parentId() {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? "root";
}

/** Finds a folder by name at the configured Drive root, creating it when missing. */
export async function findOrCreateFolder(name: string): Promise<string> {
  const parent = parentId();
  const q = [
    `name = '${esc(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${esc(parent)}' in parents`,
  ].join(" and ");
  const found = await getDriveClient().files.list({
    q,
    fields: "files(id,name)",
    pageSize: 1,
  });
  const existing = found.data.files?.[0]?.id;
  if (existing) return existing;

  const created = await getDriveClient().files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parent],
    },
    fields: "id",
  });
  if (!created.data.id) throw new Error("Google Drive did not return a folder ID.");
  return created.data.id;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

/** Finds a folder by name (optionally under a parent). Returns null when missing. */
export async function findFolder(
  name: string,
  parentIdValue = parentId(),
): Promise<string | null> {
  const q = [
    `name = '${esc(name)}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${esc(parentIdValue)}' in parents`,
  ].join(" and ");
  const found = await getDriveClient().files.list({
    q,
    fields: "files(id,name)",
    pageSize: 5,
  });
  return found.data.files?.[0]?.id ?? null;
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
  const response = await getDriveClient().files.list({
    q,
    fields: "files(id,name,mimeType,modifiedTime)",
    orderBy: "modifiedTime desc",
    pageSize: 200,
  });
  return (response.data.files ?? []) as DriveFile[];
}

export async function getFileMeta(fileId: string): Promise<DriveFile> {
  const response = await getDriveClient().files.get({
    fileId,
    fields: "id,name,mimeType,modifiedTime",
  });
  return response.data as DriveFile;
}

/** Raw bytes of a binary Drive file (PDF, txt, ...). */
export async function downloadFileBytes(fileId: string): Promise<Uint8Array> {
  const response = await getDriveClient().files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" },
  );
  return new Uint8Array(response.data as ArrayBuffer);
}

/** CSV text of a Google Sheets file, or plain text of a CSV/text file. */
export async function downloadAsCsv(file: DriveFile): Promise<string> {
  if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
    const response = await getDriveClient().files.export(
      { fileId: file.id, mimeType: "text/csv" },
      { responseType: "text" },
    );
    return String(response.data);
  }
  const response = await getDriveClient().files.get(
    { fileId: file.id, alt: "media" },
    { responseType: "text" },
  );
  return String(response.data);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Uploads a file into a Drive folder and returns its shareable Drive link. */
export async function uploadFile(opts: {
  folderId: string;
  filename: string;
  mimeType: string;
  base64: string;
}): Promise<string> {
  const response = await getDriveClient().files.create({
    requestBody: {
      name: opts.filename,
      parents: [opts.folderId],
    },
    media: {
      mimeType: opts.mimeType,
      body: Readable.from(Buffer.from(opts.base64, "base64")),
    },
    fields: "id,webViewLink",
  });
  const id = response.data.id;
  if (!id) throw new Error("Google Drive did not return an uploaded file ID.");
  return response.data.webViewLink ?? `https://drive.google.com/file/d/${id}/view`;
}
