/** Save bytes or text as a file in the browser's downloads. */
export function saveFile(content: Uint8Array | string, fileName: string, type: string): void {
  const blob = new Blob([content as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start the download only after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
