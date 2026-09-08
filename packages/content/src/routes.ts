export interface NoteRoute {
  id: string;
  route: string;
}

export function noteRoutePath(note: NoteRoute) {
  const prefix = "/note/";
  if (!note.route.startsWith(prefix)) {
    throw new Error(`Castle note ${note.id} has an invalid route.`);
  }
  return note.route.slice(prefix.length);
}

export function withBase(pathname: string, base: string) {
  if (!pathname.startsWith("/")) return pathname;
  const normalizedBase = base === "/" ? "" : `/${base.split("/").filter(Boolean).join("/")}`;
  return `${normalizedBase}${pathname}` || "/";
}
