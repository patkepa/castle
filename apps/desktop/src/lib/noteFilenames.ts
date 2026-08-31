const maximumNoteStemLength = 80;

export function noteStem(title: string) {
  return title
    .toLocaleLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, maximumNoteStemLength)
    .replace(/_+$/u, "");
}
