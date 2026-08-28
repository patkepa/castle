import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { CastleContentServiceStatus } from "../src/platform/desktop_bridge";
import {
  createSourceChannel,
  createFolderChannel,
  createTaskChannel,
  deleteSourceChannel,
  deleteFolderChannel,
  deleteTaskChannel,
  indexStatusChannel,
  knowledgeOverviewChannel,
  listProjectsChannel,
  moveSourceChannel,
  mutateTaskChannel,
  parseCreateSourceInput,
  parseCreateFolderInput,
  parseCreateTaskInput,
  parseDeleteSourceInput,
  parseDeleteFolderInput,
  parseDeleteTaskInput,
  parseEntityQuery,
  parseMoveSourceInput,
  parseMutateTaskInput,
  parseNoteContextRequest,
  parseRelatedNotesRequest,
  parseRestoreSourceInput,
  parseRestoreTaskInput,
  parseSaveSourceInput,
  parseSearchRequest,
  parseUpdatePersonInput,
  queryEventsChannel,
  queryPeopleChannel,
  queryRelationshipsChannel,
  queryTasksChannel,
  readNoteContextChannel,
  readSourceChannel,
  relatedNotesChannel,
  restoreSourceChannel,
  restoreTaskChannel,
  saveSourceChannel,
  searchKnowledgeChannel,
  updatePersonChannel,
} from "./ipc_contract";
import {
  type CastleNativeMethod,
  type CastleNativeParams,
} from "./native_contract";
import { CastleNativeService } from "./native_service";
import { assertTrustedIpcSenderUrl } from "./security_policy";

export interface DesktopServiceAccess {
  service: CastleNativeService | null;
  status: CastleContentServiceStatus;
}

export interface ContentIpcOptions {
  developmentServerUrl?: string;
  libraryRoot: string | null;
  serviceAccess: DesktopServiceAccess | null;
}

export function registerContentIpc(options: ContentIpcOptions) {
  const invoke = <Method extends CastleNativeMethod>(
    event: IpcMainInvokeEvent,
    method: Method,
    params: CastleNativeParams<Method>,
  ) => {
    assertTrusted(event, options.developmentServerUrl);
    if (!options.libraryRoot) {
      throw new Error("Castle content access is unavailable for this window.");
    }
    return requireService(options.serviceAccess).request(method, params);
  };

  ipcMain.handle(readSourceChannel, (event, noteId: unknown) => {
    if (typeof noteId !== "string" || noteId.length === 0 || noteId.length > 512) {
      throw new Error("Castle rejected an invalid note ID.");
    }
    return invoke(event, "readSource", { noteId });
  });

  registerParsed(options, saveSourceChannel, "saveSource", parseSaveSourceInput);
  registerParsed(options, createSourceChannel, "createSource", parseCreateSourceInput);
  registerParsed(options, createFolderChannel, "createFolder", parseCreateFolderInput);
  registerParsed(options, moveSourceChannel, "moveSource", parseMoveSourceInput);
  registerParsed(options, deleteSourceChannel, "deleteSource", parseDeleteSourceInput);
  registerParsed(options, deleteFolderChannel, "deleteFolder", parseDeleteFolderInput);
  registerParsed(options, restoreSourceChannel, "restoreSource", parseRestoreSourceInput);
  registerParsed(options, mutateTaskChannel, "mutateTask", parseMutateTaskInput);
  registerParsed(options, createTaskChannel, "createTask", parseCreateTaskInput);
  registerParsed(options, deleteTaskChannel, "deleteTask", parseDeleteTaskInput);
  registerParsed(options, restoreTaskChannel, "restoreTask", parseRestoreTaskInput);
  registerParsed(options, updatePersonChannel, "updatePerson", parseUpdatePersonInput);

  ipcMain.handle(indexStatusChannel, (event) =>
    invoke(event, "getIndexStatus", {}));
  registerParsed(options, searchKnowledgeChannel, "searchKnowledge", parseSearchRequest);
  registerParsed(options, readNoteContextChannel, "readNoteContext", parseNoteContextRequest);
  registerParsed(options, relatedNotesChannel, "relatedNotes", parseRelatedNotesRequest);
  registerParsed(options, queryTasksChannel, "queryTasks", parseEntityQuery);
  registerParsed(options, queryEventsChannel, "queryEvents", parseEntityQuery);
  registerParsed(options, listProjectsChannel, "listProjects", parseEntityQuery);
  registerParsed(options, queryPeopleChannel, "queryPeople", parseEntityQuery);
  registerParsed(
    options,
    queryRelationshipsChannel,
    "queryRelationships",
    parseEntityQuery,
  );

  ipcMain.handle(knowledgeOverviewChannel, (event) =>
    invoke(event, "getKnowledgeOverview", {}));
}

function registerParsed<Method extends CastleNativeMethod>(
  options: ContentIpcOptions,
  channel: string,
  method: Method,
  parse: (value: unknown) => CastleNativeParams<Method>,
) {
  ipcMain.handle(channel, (event, rawInput: unknown) => {
    assertTrusted(event, options.developmentServerUrl);
    if (!options.libraryRoot) {
      throw new Error("Castle content access is unavailable for this window.");
    }
    return requireService(options.serviceAccess).request(method, parse(rawInput));
  });
}

function assertTrusted(event: IpcMainInvokeEvent, developmentServerUrl?: string) {
  assertTrustedIpcSenderUrl(event.senderFrame?.url, developmentServerUrl);
}

function requireService(access: DesktopServiceAccess | null) {
  if (!access?.service || access.status.state === "unavailable") {
    throw new Error(access?.status.message || "Castle content service is unavailable.");
  }
  return access.service;
}
