import { Icon, type IconName } from "@patkepa/kantzen-ui/primitives";
import type { CSSProperties, MouseEvent } from "react";
import { Link } from "react-router-dom";
import type {
  BacklinkOccurrence,
  Heading,
  Note,
  PersonContact,
  PersonContactKind,
  PersonNoteSidebar as PersonNoteSidebarData,
} from "../../types";

interface NoteSidebarProps {
  activeHeading: string;
  backlinks: SidebarBacklink[];
  headings: Heading[];
  note: Note;
  open: boolean;
  onClose: () => void;
  onHeadingClick: (
    event: MouseEvent<HTMLAnchorElement>,
    headingId: string,
  ) => void;
}

interface SidebarBacklink {
  note: Note;
  occurrences: BacklinkOccurrence[];
}

const contactIcons: Record<PersonContactKind, IconName> = {
  phone: "phone",
  email: "envelope",
  address: "map-marker",
  website: "globe-network",
  social: "social-media",
  other: "id-number",
};

const personDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function NoteSidebar({
  activeHeading,
  backlinks,
  headings,
  note,
  open,
  onClose,
  onHeadingClick,
}: NoteSidebarProps) {
  const sectionCount = headings.length;

  return (
    <>
      {open ? (
        <button
          aria-label="Close note sidebar"
          className="note-sidebar-backdrop"
          tabIndex={-1}
          type="button"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-hidden={open ? undefined : true}
        aria-labelledby="note-context-sidebar-title"
        className={`note-sidebar right-sidebar--inline${
          open ? "" : " right-sidebar--collapsed"
        }${note.sidebar ? " has-note-module" : ""}${
          backlinks.length > 0 ? " has-connections" : ""
        }`}
        id="note-context-sidebar"
      >
        <header className="note-sidebar-header">
          <div>
            <h2 id="note-context-sidebar-title">
              {note.sidebar ? note.sidebar.title : "On this page"}
            </h2>
            <span>
              {note.sidebar
                ? "Person"
                : `${sectionCount} ${sectionCount === 1 ? "section" : "sections"}`}
            </span>
          </div>
        </header>
        <div className="note-sidebar-body">
          {note.sidebar ? <NoteSidebarModule sidebar={note.sidebar} /> : null}
          {note.sidebar || headings.length > 0 ? (
            <TableOfContents
              activeHeading={activeHeading}
              headings={headings}
              primary={!note.sidebar}
              onHeadingClick={onHeadingClick}
            />
          ) : null}
          <SidebarConnections notes={backlinks} />
        </div>
      </aside>
    </>
  );
}

function NoteSidebarModule({
  sidebar,
}: {
  sidebar: NonNullable<Note["sidebar"]>;
}) {
  switch (sidebar.kind) {
    case "person":
      return <PersonNoteSidebar sidebar={sidebar} />;
  }
}

function PersonNoteSidebar({ sidebar }: { sidebar: PersonNoteSidebarData }) {
  const initials = sidebar.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join("");

  return (
    <section
      className="person-note-card"
      aria-label={`${sidebar.title} information`}
    >
      <div className="person-note-card-hero">
        <div className="person-note-card-portrait">
          {sidebar.avatarUrl ? (
            <img src={sidebar.avatarUrl} alt={`${sidebar.title} portrait`} />
          ) : (
            <span aria-hidden="true">{initials || <Icon icon="person" />}</span>
          )}
        </div>
      </div>

      {sidebar.facts.length > 0 ? (
        <dl className="person-note-facts">
          {sidebar.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>
                {fact.href ? (
                  <a href={fact.href} target="_blank" rel="noreferrer">
                    {formatFactValue(fact.label, fact.value)}
                    <Icon icon="map-marker" size={11} aria-hidden="true" />
                  </a>
                ) : (
                  formatFactValue(fact.label, fact.value)
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      {sidebar.contacts.length > 0 ? (
        <section
          className="person-note-contacts"
          aria-label="Contact information"
        >
          <h3>Contact</h3>
          <ul>
            {sidebar.contacts.map((contact, index) => (
              <ContactItem
                contact={contact}
                key={`${contact.kind}:${contact.value}:${index}`}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ContactItem({ contact }: { contact: PersonContact }) {
  const external = /^https?:\/\//i.test(contact.href);
  const content = (
    <>
      <strong>{contact.label}</strong>
      <span>{displayContactValue(contact)}</span>
      {contact.detail ? <small>{contact.detail}</small> : null}
    </>
  );

  return (
    <li>
      <Icon icon={contactIcons[contact.kind]} aria-hidden="true" />
      {contact.href ? (
        <a
          href={contact.href}
          target={external ? "_blank" : undefined}
          rel={external ? "noreferrer" : undefined}
        >
          {content}
        </a>
      ) : (
        <span>{content}</span>
      )}
    </li>
  );
}

function TableOfContents({
  activeHeading,
  headings,
  primary = false,
  onHeadingClick,
}: {
  activeHeading: string;
  headings: Heading[];
  primary?: boolean;
  onHeadingClick: NoteSidebarProps["onHeadingClick"];
}) {
  return (
    <section
      className={`table-of-contents${primary ? " is-primary" : ""}`}
      aria-label="On this page"
    >
      {primary ? null : <span>On this page</span>}
      {headings.length > 0 ? (
        <nav>
          {headings.map((heading) => (
            <a
              key={heading.id}
              className={activeHeading === heading.id ? "active" : ""}
              href={`#${heading.id}`}
              onClick={(event) => onHeadingClick(event, heading.id)}
              style={{ "--toc-depth": heading.depth - 2 } as CSSProperties}
            >
              {heading.label}
            </a>
          ))}
        </nav>
      ) : (
        <p>No sections in this note.</p>
      )}
    </section>
  );
}

function SidebarConnections({ notes }: { notes: SidebarBacklink[] }) {
  if (notes.length === 0) return null;

  const mentionCount = notes.reduce(
    (total, backlink) => total + backlink.occurrences.length,
    0,
  );

  return (
    <section
      className="note-sidebar-connections"
      aria-labelledby="note-sidebar-connections-title"
    >
      <span>Knowledge graph</span>
      <h3 id="note-sidebar-connections-title">Connections</h3>
      <small>
        {mentionCount} {mentionCount === 1 ? "mention" : "mentions"} from{" "}
        {notes.length} {notes.length === 1 ? "note" : "notes"}
      </small>
      <ul>
        {notes.map(({ note, occurrences }) => (
          <li className="note-sidebar-connection" key={note.id}>
            <div className="note-sidebar-connection-header">
              <span>
                <Link to={note.route}>{note.title}</Link>
                <small>
                  {note.sectionLabel} · {occurrences.length}{" "}
                  {occurrences.length === 1 ? "mention" : "mentions"}
                </small>
              </span>
            </div>
            <ol>
              {occurrences.map((occurrence, index) => (
                <li key={occurrence.anchorId}>
                  <Link
                    aria-label={`Open mention ${index + 1} in ${note.title}`}
                    to={`${note.route}#${occurrence.anchorId}`}
                  >
                    <span>{occurrence.context}</span>
                    <Icon icon="arrow-right" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatFactValue(label: string, value: string) {
  if (label !== "Born" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.valueOf()) ? value : personDateFormatter.format(date);
}

function displayContactValue(contact: PersonContact) {
  if (contact.kind !== "website" || !contact.href) return contact.value;
  try {
    return new URL(contact.href).hostname.replace(/^www\./, "");
  } catch {
    return contact.value;
  }
}
