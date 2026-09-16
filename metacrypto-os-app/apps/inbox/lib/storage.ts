import "server-only";

const URL_BASE = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const HDR = { Authorization: `Bearer ${KEY}`, apikey: KEY };

export function storagePathFor(convId: string, kapsoMessageId: string, filename: string): string {
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeId = kapsoMessageId.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${convId}/${safeId}.${ext}`;
}

export async function uploadToStorage(path: string, bytes: ArrayBuffer, mime: string, bucket: string = "wa-media"): Promise<boolean> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, {
    method: "POST",
    headers: { ...HDR, "Content-Type": mime, "x-upsert": "true" },
    body: bytes,
  });
  if (!res.ok) console.error("[storage] upload failed", res.status, await res.text().catch(() => ""));
  return res.ok;
}

export async function getStorageBytes(path: string, bucket: string = "wa-media"): Promise<{ bytes: ArrayBuffer; mime: string } | null> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, { headers: HDR, cache: "no-store" });
  if (!res.ok) return null;
  return { bytes: await res.arrayBuffer(), mime: res.headers.get("content-type") || "application/octet-stream" };
}

export async function signStorageUrl(path: string, expiresIn: number, bucket: string = "wa-media"): Promise<string | null> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/sign/${bucket}/${path}`, {
    method: "POST",
    headers: { ...HDR, "Content-Type": "application/json" },
    body: JSON.stringify({ expiresIn }),
  });
  if (!res.ok) return null;
  const d = await res.json().catch(() => null);
  return d?.signedURL ? `${URL_BASE}/storage/v1${d.signedURL}` : null;
}

export async function deleteFromStorage(path: string, bucket: string = "wa-media"): Promise<boolean> {
  const res = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${path}`, { method: "DELETE", headers: HDR });
  return res.ok;
}
