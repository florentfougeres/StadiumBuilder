export function triggerDownloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function sanitizeFilename(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'stadiumforge-project'
  );
}

/**
 * Downloads a canvas data URL through a Blob: Chrome silently drops anchor downloads of data URLs
 * over ~2 MB, which a full-resolution render easily exceeds.
 */
function downloadDataUrl(dataUrl: string, filename: string): void {
  const [header, base64] = dataUrl.split(',', 2);
  const mime = /^data:([^;]+)/.exec(header)?.[1] ?? 'application/octet-stream';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  triggerDownloadBlob(new Blob([bytes], { type: mime }), filename);
}

let captureHandler: (() => string | null) | null = null;

export function registerViewportCaptureHandler(fn: (() => string | null) | null): void {
  captureHandler = fn;
}

export function exportViewportPng(projectName: string): boolean {
  if (!captureHandler) return false;
  const dataUrl = captureHandler();
  if (!dataUrl) return false;

  downloadDataUrl(dataUrl, `${sanitizeFilename(projectName)}-3d.png`);
  return true;
}

let pathTraceHandler: ((onProgress: (fraction: number) => void) => Promise<string | null>) | null =
  null;

export function registerPathTraceHandler(
  fn: ((onProgress: (fraction: number) => void) => Promise<string | null>) | null
): void {
  pathTraceHandler = fn;
}

/** Path-traced still of the current view; resolves false when the viewport cannot trace. */
export async function exportPathTracedPng(
  projectName: string,
  onProgress: (fraction: number) => void
): Promise<boolean> {
  if (!pathTraceHandler) return false;
  const dataUrl = await pathTraceHandler(onProgress);
  if (!dataUrl) return false;

  downloadDataUrl(dataUrl, `${sanitizeFilename(projectName)}-photo.png`);
  return true;
}
