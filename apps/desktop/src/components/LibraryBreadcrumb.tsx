import { Fragment, useMemo } from "react";
import { Icon, Menu, MenuDivider, MenuItem, PopoverNext } from "@patkepa/kantzen-ui/primitives";
import { useNavigate } from "react-router-dom";
import {
  createFolderRoute,
  decodeFolderPath,
  getDirectoryContents,
  getNoteDirectory,
  humanizePathSegment,
} from "../lib/libraryPaths";
import type { KnowledgeBase, Note, SectionSummary } from "../types";

interface LibraryBreadcrumbProps {
  knowledgeBase: KnowledgeBase;
  note?: Note;
  pathname: string;
}

interface BreadcrumbMenuEntry {
  current: boolean;
  key: string;
  kind: "folder" | "note";
  label: string;
  route: string;
}

interface BreadcrumbSegment {
  current: boolean;
  key: string;
  label: string;
  menuLabel: string;
  menuItems: BreadcrumbMenuEntry[];
  route: string;
}

export function LibraryBreadcrumb({
  knowledgeBase,
  note,
  pathname,
}: LibraryBreadcrumbProps) {
  const normalizedPathname = pathname.replace(/\/$/, "") || "/";
  const segments = useMemo(
    () =>
      createLibraryBreadcrumbSegments(
        normalizedPathname,
        knowledgeBase,
        note,
      ),
    [knowledgeBase, normalizedPathname, note],
  );

  if (segments.length === 0) return <span>The Castle</span>;

  return (
    <>
      {segments.map((segment, index) => (
        <Fragment key={`${pathname}-${segment.key}`}>
          {index > 0 ? <span className="breadcrumb-sep">/</span> : null}
          <BreadcrumbSegmentMenu segment={segment} pathname={normalizedPathname} />
        </Fragment>
      ))}
    </>
  );
}

function BreadcrumbSegmentMenu({
  pathname,
  segment,
}: {
  pathname: string;
  segment: BreadcrumbSegment;
}) {
  const navigate = useNavigate();
  const canOpenSegment = segment.route !== pathname;

  return (
    <PopoverNext
      arrow={false}
      className="breadcrumb-popover-target"
      content={
        <Menu className="breadcrumb-menu">
          {canOpenSegment ? (
            <MenuItem
              text={`Open ${segment.label}`}
              onClick={() => navigate(segment.route)}
            />
          ) : null}
          <MenuDivider title={segment.menuLabel} />
          {segment.menuItems.map((item) => (
            <MenuItem
              aria-current={item.current ? "page" : undefined}
              className={item.current ? "breadcrumb-menu-item--current" : undefined}
              key={item.key}
              text={item.label}
              onClick={() => navigate(item.route)}
            />
          ))}
        </Menu>
      }
      inheritDarkTheme
      placement="bottom-start"
      popoverClassName="breadcrumb-popover"
      portalClassName="breadcrumb-popover-portal"
      transitionDuration={0}
    >
      <button
        aria-label={`Browse ${segment.label}`}
        className={`breadcrumb-trigger${segment.current ? " breadcrumb-trigger--current" : ""}`}
        onClick={(event) => {
          if (!event.shiftKey) return;
          event.preventDefault();
          event.stopPropagation();
          navigate(segment.route);
        }}
        title={`Shift-click to open ${segment.label}`}
        type="button"
      >
        <span>{segment.label}</span>
        {segment.current ? (
          <Icon
            className="breadcrumb-trigger-caret"
            icon="chevron-down"
            size={10}
          />
        ) : null}
      </button>
    </PopoverNext>
  );
}

function createLibraryBreadcrumbSegments(
  pathname: string,
  knowledgeBase: KnowledgeBase,
  note?: Note,
): BreadcrumbSegment[] {
  const location = note ? getNoteLocation(note) : getBrowseLocation(pathname);
  const currentSectionId = location?.sectionId;
  const rootItems = createSectionEntries(
    knowledgeBase.sections,
    currentSectionId,
  );

  if (pathname === "/library") {
    return [
      {
        current: true,
        key: "library",
        label: "Library",
        menuLabel: "Library folders",
        menuItems: rootItems,
        route: "/library",
      },
    ];
  }

  if (!location) return [];

  const section = knowledgeBase.sections.find(
    (candidate) => candidate.id === location.sectionId,
  );
  if (!section) return [];

  const sectionNotes = knowledgeBase.notes.filter(
    (candidate) => candidate.section === section.id,
  );
  const hasLeafNote = note !== undefined;
  const segments: BreadcrumbSegment[] = [
    {
      current: false,
      key: "library",
      label: "Library",
      menuLabel: "Library folders",
      menuItems: rootItems,
      route: "/library",
    },
    {
      current: location.directory.length === 0 && !hasLeafNote,
      key: `section-${section.id}`,
      label: section.label,
      menuLabel: "Library folders",
      menuItems: rootItems,
      route: createFolderRoute(section.id),
    },
  ];

  location.directory.forEach((folder, index) => {
    const directory = location.directory.slice(0, index + 1);
    const parentDirectory = directory.slice(0, -1);
    const parentLabel =
      parentDirectory.length === 0
        ? section.label
        : humanizePathSegment(parentDirectory[parentDirectory.length - 1]);

    segments.push({
      current: index === location.directory.length - 1 && !hasLeafNote,
      key: `folder-${directory.join("/")}`,
      label: humanizePathSegment(folder),
      menuLabel: `In ${parentLabel}`,
      menuItems: createDirectoryEntries(
        section.id,
        sectionNotes,
        parentDirectory,
        createFolderRoute(section.id, directory),
      ),
      route: createFolderRoute(section.id, directory),
    });
  });

  if (note) {
    const folderLabel =
      location.directory.length > 0
        ? humanizePathSegment(
            location.directory[location.directory.length - 1],
          )
        : section.label;
    const siblingNotes = getDirectoryContents(
      sectionNotes,
      location.directory,
    ).notes;

    segments.push({
      current: true,
      key: `note-${note.id}`,
      label: note.title,
      menuLabel: `Notes in ${folderLabel}`,
      menuItems: siblingNotes.map((candidate) => ({
        current: candidate.id === note.id,
        key: `note-${candidate.id}`,
        kind: "note",
        label: candidate.title,
        route: candidate.route,
      })),
      route: note.route,
    });
  }

  return segments;
}

function createSectionEntries(
  sections: SectionSummary[],
  currentSectionId?: string,
): BreadcrumbMenuEntry[] {
  return [...sections]
    .sort((left, right) => left.label.localeCompare(right.label))
    .map((section) => ({
      current: section.id === currentSectionId,
      key: `section-${section.id}`,
      kind: "folder",
      label: section.label,
      route: createFolderRoute(section.id),
    }));
}

function createDirectoryEntries(
  sectionId: string,
  sectionNotes: Note[],
  directory: string[],
  currentRoute: string,
): BreadcrumbMenuEntry[] {
  const contents = getDirectoryContents(sectionNotes, directory);

  return [
    ...contents.folders.map((folder) => {
      const route = createFolderRoute(sectionId, [...directory, folder.name]);
      return {
        current: route === currentRoute,
        key: `folder-${[...directory, folder.name].join("/")}`,
        kind: "folder" as const,
        label: humanizePathSegment(folder.name),
        route,
      };
    }),
    ...contents.notes.map((candidate) => ({
      current: candidate.route === currentRoute,
      key: `note-${candidate.id}`,
      kind: "note" as const,
      label: candidate.title,
      route: candidate.route,
    })),
  ];
}

function getNoteLocation(note: Note) {
  return {
    directory: getNoteDirectory(note),
    sectionId: note.section,
  };
}

function getBrowseLocation(pathname: string) {
  if (!pathname.startsWith("/browse/")) return undefined;
  const [sectionId = "", ...directory] = decodeFolderPath(
    pathname.slice("/browse/".length),
  );

  return { directory, sectionId };
}
