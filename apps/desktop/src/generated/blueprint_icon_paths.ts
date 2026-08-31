import { IconSize, Icons, type IconName, type IconPaths } from "@patkepa/kantzen-ui/icons";
import icon16_home from "@blueprintjs/icons/lib/esm/generated/16px/paths/home.js";
import icon16_folder_open from "@blueprintjs/icons/lib/esm/generated/16px/paths/folder-open.js";
import icon16_graph from "@blueprintjs/icons/lib/esm/generated/16px/paths/graph.js";
import icon16_tick_circle from "@blueprintjs/icons/lib/esm/generated/16px/paths/tick-circle.js";
import icon16_calendar from "@blueprintjs/icons/lib/esm/generated/16px/paths/calendar.js";
import icon16_grid_view from "@blueprintjs/icons/lib/esm/generated/16px/paths/grid-view.js";
import icon16_inbox from "@blueprintjs/icons/lib/esm/generated/16px/paths/inbox.js";

interface IconPathsModule {
  default: IconPaths;
}

type IconPathsImporter = () => Promise<IconPathsModule>;

const castleSidebarIconNames: IconName[] = ["home", "folder-open", "graph", "tick-circle", "calendar", "grid-view", "inbox"];

const castleSidebarIconPaths: Readonly<Record<string, IconPaths>> = {
  "home": icon16_home,
  "folder-open": icon16_folder_open,
  "graph": icon16_graph,
  "tick-circle": icon16_tick_circle,
  "calendar": icon16_calendar,
  "grid-view": icon16_grid_view,
  "inbox": icon16_inbox,
};

const castleIconPaths: Readonly<
  Record<string, readonly [IconPathsImporter, IconPathsImporter]>
> = {
  "arrow-left": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/arrow-left.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/arrow-left.js"),
  ],
  "arrow-right": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/arrow-right.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/arrow-right.js"),
  ],
  "arrow-top-right": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/arrow-top-right.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/arrow-top-right.js"),
  ],
  "book": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/book.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/book.js"),
  ],
  "briefcase": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/briefcase.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/briefcase.js"),
  ],
  "calendar": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/calendar.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/calendar.js"),
  ],
  "caret-down": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/caret-down.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/caret-down.js"),
  ],
  "chat": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/chat.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/chat.js"),
  ],
  "chevron-down": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/chevron-down.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/chevron-down.js"),
  ],
  "chevron-left": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/chevron-left.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/chevron-left.js"),
  ],
  "chevron-right": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/chevron-right.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/chevron-right.js"),
  ],
  "circle": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/circle.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/circle.js"),
  ],
  "clipboard": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/clipboard.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/clipboard.js"),
  ],
  "code-block": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/code-block.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/code-block.js"),
  ],
  "cog": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/cog.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/cog.js"),
  ],
  "column-layout": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/column-layout.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/column-layout.js"),
  ],
  "console": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/console.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/console.js"),
  ],
  "cross": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/cross.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/cross.js"),
  ],
  "database": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/database.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/database.js"),
  ],
  "delete": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/delete.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/delete.js"),
  ],
  "delta": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/delta.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/delta.js"),
  ],
  "desktop": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/desktop.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/desktop.js"),
  ],
  "diagram-tree": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/diagram-tree.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/diagram-tree.js"),
  ],
  "document": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/document.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/document.js"),
  ],
  "document-open": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/document-open.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/document-open.js"),
  ],
  "double-caret-vertical": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/double-caret-vertical.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/double-caret-vertical.js"),
  ],
  "double-chevron-left": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/double-chevron-left.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/double-chevron-left.js"),
  ],
  "double-chevron-right": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/double-chevron-right.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/double-chevron-right.js"),
  ],
  "download": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/download.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/download.js"),
  ],
  "drag-handle-vertical": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/drag-handle-vertical.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/drag-handle-vertical.js"),
  ],
  "duplicate": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/duplicate.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/duplicate.js"),
  ],
  "edit": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/edit.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/edit.js"),
  ],
  "envelope": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/envelope.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/envelope.js"),
  ],
  "error": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/error.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/error.js"),
  ],
  "exchange": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/exchange.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/exchange.js"),
  ],
  "eye-open": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/eye-open.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/eye-open.js"),
  ],
  "filter": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/filter.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/filter.js"),
  ],
  "filter-list": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/filter-list.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/filter-list.js"),
  ],
  "floppy-disk": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/floppy-disk.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/floppy-disk.js"),
  ],
  "folder-close": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/folder-close.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/folder-close.js"),
  ],
  "folder-open": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/folder-open.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/folder-open.js"),
  ],
  "folder-shared": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/folder-shared.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/folder-shared.js"),
  ],
  "function": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/function.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/function.js"),
  ],
  "globe-network": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/globe-network.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/globe-network.js"),
  ],
  "graph": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/graph.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/graph.js"),
  ],
  "grid": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/grid.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/grid.js"),
  ],
  "grid-view": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/grid-view.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/grid-view.js"),
  ],
  "header": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/header.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/header.js"),
  ],
  "help": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/help.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/help.js"),
  ],
  "home": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/home.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/home.js"),
  ],
  "id-number": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/id-number.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/id-number.js"),
  ],
  "inbox": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/inbox.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/inbox.js"),
  ],
  "input": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/input.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/input.js"),
  ],
  "key": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/key.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/key.js"),
  ],
  "label": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/label.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/label.js"),
  ],
  "link": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/link.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/link.js"),
  ],
  "list": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/list.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/list.js"),
  ],
  "locate": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/locate.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/locate.js"),
  ],
  "log-out": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/log-out.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/log-out.js"),
  ],
  "manual": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/manual.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/manual.js"),
  ],
  "map": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/map.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/map.js"),
  ],
  "map-marker": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/map-marker.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/map-marker.js"),
  ],
  "markdown": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/markdown.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/markdown.js"),
  ],
  "maximize": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/maximize.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/maximize.js"),
  ],
  "media": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/media.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/media.js"),
  ],
  "menu": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/menu.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/menu.js"),
  ],
  "minus": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/minus.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/minus.js"),
  ],
  "more": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/more.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/more.js"),
  ],
  "move": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/move.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/move.js"),
  ],
  "new-object": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/new-object.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/new-object.js"),
  ],
  "office": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/office.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/office.js"),
  ],
  "offline": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/offline.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/offline.js"),
  ],
  "panel-stats": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/panel-stats.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/panel-stats.js"),
  ],
  "path": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/path.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/path.js"),
  ],
  "path-search": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/path-search.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/path-search.js"),
  ],
  "pause": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/pause.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/pause.js"),
  ],
  "people": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/people.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/people.js"),
  ],
  "percentage": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/percentage.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/percentage.js"),
  ],
  "person": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/person.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/person.js"),
  ],
  "phone": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/phone.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/phone.js"),
  ],
  "pin": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/pin.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/pin.js"),
  ],
  "play": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/play.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/play.js"),
  ],
  "plus": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/plus.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/plus.js"),
  ],
  "presentation": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/presentation.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/presentation.js"),
  ],
  "projects": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/projects.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/projects.js"),
  ],
  "properties": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/properties.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/properties.js"),
  ],
  "property": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/property.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/property.js"),
  ],
  "redo": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/redo.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/redo.js"),
  ],
  "refresh": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/refresh.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/refresh.js"),
  ],
  "remove": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/remove.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/remove.js"),
  ],
  "repeat": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/repeat.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/repeat.js"),
  ],
  "reset": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/reset.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/reset.js"),
  ],
  "route": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/route.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/route.js"),
  ],
  "saved": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/saved.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/saved.js"),
  ],
  "search": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/search.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/search.js"),
  ],
  "select": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/select.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/select.js"),
  ],
  "share": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/share.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/share.js"),
  ],
  "shield": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/shield.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/shield.js"),
  ],
  "small-cross": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/small-cross.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/small-cross.js"),
  ],
  "small-plus": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/small-plus.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/small-plus.js"),
  ],
  "small-tick": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/small-tick.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/small-tick.js"),
  ],
  "social-media": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/social-media.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/social-media.js"),
  ],
  "square": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/square.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/square.js"),
  ],
  "stopwatch": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/stopwatch.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/stopwatch.js"),
  ],
  "switch": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/switch.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/switch.js"),
  ],
  "tag": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/tag.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/tag.js"),
  ],
  "tags": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/tags.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/tags.js"),
  ],
  "target": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/target.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/target.js"),
  ],
  "text-highlight": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/text-highlight.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/text-highlight.js"),
  ],
  "th": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/th.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/th.js"),
  ],
  "tick": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/tick.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/tick.js"),
  ],
  "tick-circle": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/tick-circle.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/tick-circle.js"),
  ],
  "time": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/time.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/time.js"),
  ],
  "timeline-events": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/timeline-events.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/timeline-events.js"),
  ],
  "timeline-line-chart": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/timeline-line-chart.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/timeline-line-chart.js"),
  ],
  "trash": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/trash.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/trash.js"),
  ],
  "tree": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/tree.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/tree.js"),
  ],
  "undo": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/undo.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/undo.js"),
  ],
  "user": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/user.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/user.js"),
  ],
  "video": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/video.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/video.js"),
  ],
  "warning-sign": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/warning-sign.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/warning-sign.js"),
  ],
  "zoom-in": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/zoom-in.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/zoom-in.js"),
  ],
  "zoom-out": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/zoom-out.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/zoom-out.js"),
  ],
  "zoom-to-fit": [
    () => import("@blueprintjs/icons/lib/esm/generated/16px/paths/zoom-to-fit.js"),
    () => import("@blueprintjs/icons/lib/esm/generated/20px/paths/zoom-to-fit.js"),
  ],
};

export function configureCastleIconLoader() {
  Icons.setLoaderOptions({
    loader: async (iconName, iconSize) => {
      const sidebarPaths =
        iconSize < IconSize.LARGE ? castleSidebarIconPaths[iconName] : undefined;
      if (sidebarPaths) return sidebarPaths;
      const importers = castleIconPaths[iconName];
      if (!importers) throw new Error(`Castle has no generated paths for icon "${iconName}".`);
      const module = await importers[iconSize >= IconSize.LARGE ? 1 : 0]();
      return module.default;
    },
  });
}

export function preloadCastleSidebarIcons() {
  return Icons.load(castleSidebarIconNames, IconSize.STANDARD);
}
