import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { CastleContentDelta, CastleEntityDelta } from "../platform/castle_platform";
import type {
  CalendarEvent,
  KnowledgeBase,
  Note,
  Project,
  ShortcutCollection,
  Task,
} from "../types";

interface EntityTable<T extends { id: string }> {
  byId: Map<string, T>;
  orderedIds: string[];
}

interface KnowledgeBaseState {
  contractVersion: number;
  generatedAt: string;
  sections: KnowledgeBase["sections"];
  folders: KnowledgeBase["folders"];
  notes: EntityTable<Note>;
  tasks: EntityTable<Task>;
  projects: EntityTable<Project>;
  calendarEvents: EntityTable<CalendarEvent>;
  shortcutCollections: ShortcutCollection[];
}

type KnowledgeBaseAction =
  | { type: "replaceSnapshot"; snapshot: KnowledgeBase }
  | { type: "applyDelta"; delta: CastleContentDelta }
  | { type: "replaceTasks"; tasks: Task[] };

interface KnowledgeBaseStoreValue {
  knowledgeBase: KnowledgeBase;
  applyDelta(delta: CastleContentDelta): void;
  replaceTasks(tasks: Task[]): void;
}

const KnowledgeBaseStoreContext = createContext<KnowledgeBaseStoreValue | null>(null);

export function KnowledgeBaseStoreProvider({
  children,
  snapshot,
}: {
  children: ReactNode;
  snapshot: KnowledgeBase;
}) {
  const [state, dispatch] = useReducer(
    reduceKnowledgeBase,
    snapshot,
    normalizeKnowledgeBase,
  );

  useEffect(() => {
    dispatch({ type: "replaceSnapshot", snapshot });
  }, [snapshot]);

  const knowledgeBase = useMemo(() => materializeKnowledgeBase(state), [state]);
  const applyDelta = useCallback((delta: CastleContentDelta) => {
    dispatch({ type: "applyDelta", delta });
  }, []);
  const replaceTasks = useCallback((tasks: Task[]) => {
    dispatch({ type: "replaceTasks", tasks });
  }, []);
  const value = useMemo(
    () => ({ knowledgeBase, applyDelta, replaceTasks }),
    [applyDelta, knowledgeBase, replaceTasks],
  );

  return (
    <KnowledgeBaseStoreContext.Provider value={value}>
      {children}
    </KnowledgeBaseStoreContext.Provider>
  );
}

export function useKnowledgeBaseStore() {
  const store = useContext(KnowledgeBaseStoreContext);
  if (!store) {
    throw new Error("Castle knowledge-base state is unavailable outside its provider.");
  }
  return store;
}

export function normalizeKnowledgeBase(snapshot: KnowledgeBase): KnowledgeBaseState {
  return {
    contractVersion: snapshot.contractVersion,
    generatedAt: snapshot.generatedAt,
    sections: snapshot.sections,
    folders: snapshot.folders,
    notes: createEntityTable(snapshot.notes),
    tasks: createEntityTable(snapshot.tasks),
    projects: createEntityTable(snapshot.projects),
    calendarEvents: createEntityTable(snapshot.calendarEvents),
    shortcutCollections: snapshot.shortcutCollections,
  };
}

export function materializeKnowledgeBase(state: KnowledgeBaseState): KnowledgeBase {
  return {
    contractVersion: state.contractVersion,
    generatedAt: state.generatedAt,
    sections: state.sections,
    folders: state.folders,
    notes: materializeEntityTable(state.notes),
    tasks: materializeEntityTable(state.tasks),
    projects: materializeEntityTable(state.projects),
    calendarEvents: materializeEntityTable(state.calendarEvents),
    shortcutCollections: state.shortcutCollections,
  };
}

export function reduceKnowledgeBase(
  state: KnowledgeBaseState,
  action: KnowledgeBaseAction,
): KnowledgeBaseState {
  if (action.type === "replaceSnapshot") {
    if (isOlder(action.snapshot.generatedAt, state.generatedAt)) return state;
    return normalizeKnowledgeBase(action.snapshot);
  }
  if (action.type === "replaceTasks") {
    return { ...state, tasks: createEntityTable(action.tasks) };
  }
  const { delta } = action;
  if (isOlder(delta.generatedAt, state.generatedAt)) return state;
  return {
    contractVersion: delta.contractVersion,
    generatedAt: delta.generatedAt,
    sections: delta.sections,
    folders: delta.folders,
    notes: applyEntityDelta(state.notes, delta.notes as CastleEntityDelta<Note>),
    tasks: applyEntityDelta(state.tasks, delta.tasks as CastleEntityDelta<Task>),
    projects: applyEntityDelta(
      state.projects,
      delta.projects as CastleEntityDelta<Project>,
    ),
    calendarEvents: applyEntityDelta(
      state.calendarEvents,
      delta.calendarEvents as CastleEntityDelta<CalendarEvent>,
    ),
    shortcutCollections: delta.shortcutCollections,
  };
}

function createEntityTable<T extends { id: string }>(items: readonly T[]): EntityTable<T> {
  return {
    byId: new Map(items.map((item) => [item.id, item])),
    orderedIds: items.map((item) => item.id),
  };
}

function materializeEntityTable<T extends { id: string }>(table: EntityTable<T>) {
  return table.orderedIds.flatMap((id) => {
    const item = table.byId.get(id);
    return item ? [item] : [];
  });
}

function applyEntityDelta<T extends { id: string }>(
  current: EntityTable<T>,
  delta: CastleEntityDelta<T>,
): EntityTable<T> {
  const byId = new Map(current.byId);
  for (const id of delta.removedIds) byId.delete(id);
  for (const item of delta.upserted) byId.set(item.id, item);

  const requestedOrder = delta.orderedIds ?? current.orderedIds;
  const orderedIds = requestedOrder.filter((id) => byId.has(id));
  const includedIds = new Set(orderedIds);
  for (const id of byId.keys()) {
    if (!includedIds.has(id)) orderedIds.push(id);
  }
  return { byId, orderedIds };
}

function isOlder(candidate: string, current: string) {
  const candidateTime = Date.parse(candidate);
  const currentTime = Date.parse(current);
  return Number.isFinite(candidateTime) &&
    Number.isFinite(currentTime) &&
    candidateTime < currentTime;
}
