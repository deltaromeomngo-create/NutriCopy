// lib/exportDownload.web.ts

type DownloadArgs = {
  filename: string;
  content: string;
  mime: string;
};

export function downloadTextFile({
  filename,
  content,
  mime,
}: DownloadArgs) {
  const blob = new Blob([content], { type: mime });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();

  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
