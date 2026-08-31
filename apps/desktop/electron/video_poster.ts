import { net } from "electron";
import {
  parseVideoPosterInput,
  resolveVideoPosterWithFetcher,
} from "../src/lib/videoPosterServer";

export { parseVideoPosterInput };

export function resolveVideoPoster(sourceUrl: string) {
  return resolveVideoPosterWithFetcher(sourceUrl, net.fetch);
}
