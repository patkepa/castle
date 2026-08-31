import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getShortcutCategoryStyle,
  getShortcutPixels,
  getShortcutSeed,
  groupShortcuts,
  moveShortcutPixelsIntoEmptyCells,
  type Shortcut,
} from "../lib/shortcutPixels";

export type { Shortcut } from "../lib/shortcutPixels";

interface ShortcutsPanelProps {
  shortcuts: readonly Shortcut[];
}

const externalUrlPattern = /^https?:\/\//;
const mobileShortcutQuery = "(max-width: 760px)";

export function ShortcutsPanel({ shortcuts }: ShortcutsPanelProps) {
  const groups = useMemo(() => groupShortcuts(shortcuts), [shortcuts]);
  const isMobileViewport = useMediaQuery(mobileShortcutQuery);

  return (
    <section aria-label="Shortcuts" className="shortcuts-panel">
      {groups.map((group, categoryIndex) => (
        <section
          className="shortcut-category"
          key={group.category}
          style={getShortcutCategoryStyle(group.category, categoryIndex)}
        >
          <h2>{group.category}</h2>
          <div className="shortcut-grid">
            {group.items.map(({ shortcut, variantIndex }) => (
              <ShortcutTile
                categoryIndex={categoryIndex}
                isMobileViewport={isMobileViewport}
                key={`${shortcut.category}-${shortcut.href}`}
                shortcut={shortcut}
                variantIndex={variantIndex}
              />
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

function ShortcutTile({
  categoryIndex,
  isMobileViewport,
  shortcut,
  variantIndex,
}: {
  categoryIndex: number;
  isMobileViewport: boolean;
  shortcut: Shortcut;
  variantIndex: number;
}) {
  const basePixels = useMemo(
    () => getShortcutPixels(shortcut, variantIndex, categoryIndex),
    [categoryIndex, shortcut, variantIndex],
  );
  const movementSeed = getShortcutSeed(shortcut) + variantIndex * 997;
  const moveSeedRef = useRef(movementSeed);
  const [pixels, setPixels] = useState(basePixels);
  const [isFocused, setIsFocused] = useState(false);
  const [isPointerInside, setIsPointerInside] = useState(false);
  const isMoving = isMobileViewport || isFocused || isPointerInside;
  const isExternal = externalUrlPattern.test(shortcut.href);

  useEffect(() => {
    setPixels(basePixels);
    moveSeedRef.current = movementSeed;
  }, [basePixels, movementSeed]);

  useEffect(() => {
    if (
      !isMoving ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      setPixels((currentPixels) => {
        const moved = moveShortcutPixelsIntoEmptyCells(
          currentPixels,
          moveSeedRef.current,
        );
        moveSeedRef.current = moved.seed;
        return moved.pixels;
      });
    }, 190);

    return () => window.clearInterval(interval);
  }, [isMoving]);

  return (
    <a
      aria-label={`${shortcut.label}: ${shortcut.description}`}
      className="shortcut-tile"
      href={shortcut.href}
      onBlur={() => setIsFocused(false)}
      onFocus={() => setIsFocused(true)}
      onMouseEnter={() => setIsPointerInside(true)}
      onMouseLeave={() => setIsPointerInside(false)}
      rel={isExternal ? "noreferrer" : undefined}
      target={isExternal ? "_blank" : undefined}
    >
      <span aria-hidden="true" className="shortcut-pixels">
        {pixels.map((backgroundColor, index) => (
          <span key={index} style={{ backgroundColor }} />
        ))}
      </span>
      <strong>{shortcut.label}</strong>
    </a>
  );
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const handleChange = () => setMatches(mediaQuery.matches);

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}
