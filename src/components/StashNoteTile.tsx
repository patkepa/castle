import { Icon } from "@patkepa/kantzen-ui/primitives";
import { Link } from "react-router-dom";
import {
  getExternalWebUrl,
  getStashPreviewBlocks,
  getYouTubeVideoId,
} from "../features/stash/stashPresentation";
import type { Note } from "../types";
import { ContextMenuTarget } from "../features/context_menu/CastleContextMenu";
import { createStashContextMenu } from "../features/context_menu/context_menu_models";

const inlineWebUrlPattern = /(https?:\/\/[^\s<>]+)/giu;

export function StashNoteTile({ note }: { note: Note }) {
  const content = note.preview || note.excerpt;
  const youtubeVideoId = getYouTubeVideoId(content);

  if (youtubeVideoId) {
    return (
      <ContextMenuTarget menu={createStashContextMenu(note)}>
        <article className="stash-youtube-card" tabIndex={0}>
          <div className="stash-youtube-embed">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              src={`https://www.youtube-nocookie.com/embed/${youtubeVideoId}`}
              title="YouTube video preview"
            />
          </div>
          <footer className="stash-youtube-footer">
            <a href={content} rel="noreferrer" target="_blank">
              <Icon icon="video" size={14} aria-hidden="true" />
              <span>{content}</span>
              <Icon icon="arrow-top-right" size={11} aria-hidden="true" />
            </a>
            <Link to={note.route}>
              Open note
              <Icon icon="chevron-right" size={12} aria-hidden="true" />
            </Link>
          </footer>
        </article>
      </ContextMenuTarget>
    );
  }

  return (
    <ContextMenuTarget menu={createStashContextMenu(note)}>
      <article
        className="file-tile file-tile--note file-tile--stash"
        tabIndex={0}
      >
        <span className="file-tile-primary">
          <StashPreviewContent content={content} />
        </span>
        <Link
          aria-label="Open full stash note"
          className="stash-note-open"
          title="Open full note"
          to={note.route}
        >
          <Icon className="file-tile-arrow" icon="chevron-right" aria-hidden="true" />
        </Link>
      </article>
    </ContextMenuTarget>
  );
}

function StashPreviewContent({ content }: { content: string }) {
  const blocks = getStashPreviewBlocks(content);
  const isLinkOnly = blocks.length === 1 && blocks[0].kind === "links";

  return (
    <div
      className={`file-tile-stash-preview${
        isLinkOnly ? " file-tile-stash-preview--link-only" : ""
      }`}
    >
      {blocks.map((block, blockIndex) =>
        block.kind === "links" ? (
          <ul className="stash-link-list" key={`links-${blockIndex}`}>
            {block.links.map((link, linkIndex) => (
              <li key={`${link}-${linkIndex}`}>
                <ExternalLink href={link}>{link}</ExternalLink>
              </li>
            ))}
          </ul>
        ) : (
          <p key={`text-${blockIndex}`}>{linkifyText(block.text)}</p>
        ),
      )}
    </div>
  );
}

function linkifyText(text: string) {
  return text.split(inlineWebUrlPattern).map((part, index) => {
    const link = getExternalWebUrl(part);
    return link ? (
      <ExternalLink href={link} key={`${link}-${index}`}>
        {link}
      </ExternalLink>
    ) : (
      part
    );
  });
}

function ExternalLink({
  children,
  href,
}: {
  children: string;
  href: string;
}) {
  return (
    <a href={href} rel="noreferrer" target="_blank">
      <Icon icon="link" size={12} aria-hidden="true" />
      <span>{children}</span>
      <Icon icon="arrow-top-right" size={10} aria-hidden="true" />
    </a>
  );
}
