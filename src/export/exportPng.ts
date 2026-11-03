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

let captureHandler: (() => string | null) | null = null;

export function registerViewportCaptureHandler(fn: (() => string | null) | null): void {
  captureHandler = fn;
}

export function exportViewportPng(projectName: string): boolean {
  if (!captureHandler) return false;
  const dataUrl = captureHandler();
  if (!dataUrl) return false;

  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = `${sanitizeFilename(projectName)}-3d.png`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
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

  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = `${sanitizeFilename(projectName)}-photo.png`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  return true;
}
