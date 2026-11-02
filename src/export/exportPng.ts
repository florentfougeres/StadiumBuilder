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
