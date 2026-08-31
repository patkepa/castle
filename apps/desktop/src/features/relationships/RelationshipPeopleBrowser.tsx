import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Icon } from "@patkepa/kantzen-ui/primitives";
import { SelectableList } from "@patkepa/kantzen-ui";
import type { GraphNode, RelationshipGraphData } from "../../types";
import { buildRelationshipHierarchy } from "./relationshipHierarchy";
import { ROOT_NODE_ID } from "./relationshipGraphPresentation";
import {
  usePeopleTreeKeyboardNavigation,
  type PeopleTreeItemKeyboardProps,
} from "./people_tree_keyboard_navigation";
import { ContextMenuTarget } from "../context_menu/CastleContextMenu";
import { createPersonContextMenu } from "../context_menu/context_menu_models";

export function PeopleList({
  people,
  selectedNodeId,
  onSelectNode,
}: {
  people: GraphNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  return (
    <SelectableList
      items={people}
      selectedId={selectedNodeId}
      ariaLabel="All people"
      className="people-list"
      rowClassName="people-list-row"
      empty={<EmptyPeopleState />}
      onSelect={(person) => onSelectNode(person.id)}
      renderItem={(person) => (
        <>
          <span
            className="people-list-marker"
            style={{ "--person-color": person.color } as CSSProperties}
            aria-hidden="true"
          />
          <strong>{person.label}</strong>
          <span className="people-list-category">
            {person.categoryLabel || person.relationLabel || "Other"}
          </span>
        </>
      )}
      wrapItem={(person, row) => (
        <ContextMenuTarget
          menu={createPersonContextMenu(person)}
          onOpen={() => onSelectNode(person.id)}
        >
          {row}
        </ContextMenuTarget>
      )}
    />
  );
}

export function PeopleTree({
  graph,
  people,
  activeCategories,
  queryActive,
  selectedNodeId,
  onSelectNode,
}: {
  graph: RelationshipGraphData;
  people: GraphNode[];
  activeCategories: Set<string>;
  queryActive: boolean;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const treeRef = useRef<HTMLDivElement>(null);
  const [expandedIds, setExpandedIds] = useState(
    () => new Set<string>([ROOT_NODE_ID]),
  );
  const hierarchy = useMemo(
    () => buildRelationshipHierarchy(graph, people, activeCategories),
    [activeCategories, graph, people],
  );
  const branches = hierarchy.categories;
  const treeItemIds = useMemo(() => {
    const ids = new Set<string>([ROOT_NODE_ID]);
    for (const branch of branches) {
      ids.add(branch.node.id);
      branch.directPeople.forEach((person) => ids.add(person.id));
      for (const company of branch.companies) {
        ids.add(company.node.id);
        company.directPeople.forEach((person) => ids.add(person.id));
        for (const department of company.departments) {
          ids.add(department.node.id);
          department.people.forEach((person) => ids.add(person.id));
        }
      }
    }
    return ids;
  }, [branches]);
  const { getTreeItemProps, handleKeyDown: handleTreeKeyDown } =
    usePeopleTreeKeyboardNavigation({
      availableItemIds: treeItemIds,
      initialItemId: ROOT_NODE_ID,
      selectedItemId: selectedNodeId,
    });

  useEffect(() => {
    if (!selectedNodeId && !queryActive) return;

    setExpandedIds((current) => {
      const next = new Set(current);
      next.add(ROOT_NODE_ID);

      for (const branch of branches) {
        const directMatch = branch.directPeople.some(
          (person) => queryActive || person.id === selectedNodeId,
        );
        let branchHasMatch = directMatch;

        for (const company of branch.companies) {
          let companyHasMatch = company.directPeople.some(
            (person) => queryActive || person.id === selectedNodeId,
          );

          for (const department of company.departments) {
            const departmentHasMatch = department.people.some(
              (person) => queryActive || person.id === selectedNodeId,
            );
            if (!departmentHasMatch) continue;
            companyHasMatch = true;
            next.add(department.node.id);
          }

          if (!companyHasMatch) continue;
          branchHasMatch = true;
          next.add(company.node.id);
        }

        if (branchHasMatch) next.add(branch.node.id);
      }

      return current.size === next.size ? current : next;
    });
  }, [branches, queryActive, selectedNodeId]);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree || !selectedNodeId) return;

    const selectedRow = Array.from(
      tree.querySelectorAll<HTMLButtonElement>("[data-node-id]"),
    ).find((row) => row.dataset.nodeId === selectedNodeId);
    if (!selectedRow) return;

    const treeRect = tree.getBoundingClientRect();
    const rowRect = selectedRow.getBoundingClientRect();
    const rowCenter =
      rowRect.top - treeRect.top + tree.scrollTop + rowRect.height / 2;
    tree.scrollTop = Math.max(0, rowCenter - tree.clientHeight / 2);
  }, [expandedIds, selectedNodeId]);

  const toggleExpanded = useCallback((nodeId: string) => {
    setExpandedIds((current) => toggleSetValue(current, nodeId));
  }, []);

  if (people.length === 0) {
    return <EmptyPeopleState />;
  }

  const rootExpanded = expandedIds.has(ROOT_NODE_ID);

  return (
    <div
      ref={treeRef}
      className="relationship-tree"
      role="tree"
      aria-label="People relationship tree"
      onKeyDown={handleTreeKeyDown}
    >
      <button
        type="button"
        className="people-tree-row people-tree-group-row people-tree-root-row"
        role="treeitem"
        aria-level={1}
        aria-expanded={rootExpanded}
        {...getTreeItemProps(ROOT_NODE_ID)}
        onClick={() => toggleExpanded(ROOT_NODE_ID)}
      >
        <Icon icon={rootExpanded ? "chevron-down" : "chevron-right"} size={12} />
        <Icon icon="person" size={13} />
        <strong>{hierarchy.root?.label ?? "Owner"}</strong>
        <span className="people-tree-count mono-data">{people.length}</span>
      </button>

      {rootExpanded ? (
        <div className="people-tree-children" role="group">
          {branches.map((branch) => {
            const branchExpanded = expandedIds.has(branch.node.id);

            return (
              <div className="people-tree-node" key={branch.node.id}>
                <button
                  type="button"
                  className="people-tree-row people-tree-group-row"
                  role="treeitem"
                  aria-level={2}
                  aria-expanded={branchExpanded}
                  {...getTreeItemProps(branch.node.id)}
                  onClick={() => toggleExpanded(branch.node.id)}
                >
                  <Icon
                    icon={branchExpanded ? "chevron-down" : "chevron-right"}
                    size={12}
                  />
                  <span
                    className="people-tree-group-marker"
                    style={{ "--person-color": branch.node.color } as CSSProperties}
                    aria-hidden="true"
                  />
                  <strong>{branch.node.label}</strong>
                  <span className="people-tree-count mono-data">
                    {branch.peopleCount}
                  </span>
                </button>

                {branchExpanded ? (
                  <div className="people-tree-children" role="group">
                    {branch.directPeople.map((person) => (
                      <PeopleTreePerson
                        key={`${branch.node.id}:${person.id}`}
                        person={person}
                        level={3}
                        selected={selectedNodeId === person.id}
                        keyboardProps={getTreeItemProps(person.id)}
                        onSelect={onSelectNode}
                      />
                    ))}
                    {branch.companies.map((company) => {
                      const companyExpanded = expandedIds.has(company.node.id);

                      return (
                        <div className="people-tree-node" key={company.node.id}>
                          <button
                            type="button"
                            className="people-tree-row people-tree-group-row people-tree-company-row"
                            role="treeitem"
                            aria-level={3}
                            aria-expanded={companyExpanded}
                            {...getTreeItemProps(company.node.id)}
                            onClick={() => toggleExpanded(company.node.id)}
                          >
                            <Icon
                              icon={
                                companyExpanded
                                  ? "chevron-down"
                                  : "chevron-right"
                              }
                              size={12}
                            />
                            <Icon icon="office" size={12} />
                            <strong>{company.node.label}</strong>
                            <span className="people-tree-count mono-data">
                              {company.peopleCount}
                            </span>
                          </button>
                          {companyExpanded ? (
                            <div className="people-tree-children" role="group">
                              {company.directPeople.map((person) => (
                                <PeopleTreePerson
                                  key={`${company.node.id}:${person.id}`}
                                  person={person}
                                  level={4}
                                  selected={selectedNodeId === person.id}
                                  keyboardProps={getTreeItemProps(person.id)}
                                  onSelect={onSelectNode}
                                />
                              ))}
                              {company.departments.map((department) => {
                                const departmentExpanded = expandedIds.has(
                                  department.node.id,
                                );

                                return (
                                  <div
                                    className="people-tree-node"
                                    key={department.node.id}
                                  >
                                    <button
                                      type="button"
                                      className="people-tree-row people-tree-group-row people-tree-department-row"
                                      role="treeitem"
                                      aria-level={4}
                                      aria-expanded={departmentExpanded}
                                      {...getTreeItemProps(department.node.id)}
                                      onClick={() =>
                                        toggleExpanded(department.node.id)
                                      }
                                    >
                                      <Icon
                                        icon={
                                          departmentExpanded
                                            ? "chevron-down"
                                            : "chevron-right"
                                        }
                                        size={12}
                                      />
                                      <Icon icon="folder-close" size={12} />
                                      <strong>{department.node.label}</strong>
                                      <span className="people-tree-count mono-data">
                                        {department.people.length}
                                      </span>
                                    </button>
                                    {departmentExpanded ? (
                                      <div
                                        className="people-tree-children"
                                        role="group"
                                      >
                                        {department.people.map((person) => (
                                          <PeopleTreePerson
                                            key={`${department.node.id}:${person.id}`}
                                            person={person}
                                            level={5}
                                            selected={
                                              selectedNodeId === person.id
                                            }
                                            keyboardProps={getTreeItemProps(
                                              person.id,
                                            )}
                                            onSelect={onSelectNode}
                                          />
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function PeopleTreePerson({
  person,
  level,
  selected,
  keyboardProps,
  onSelect,
}: {
  person: GraphNode;
  level: number;
  selected: boolean;
  keyboardProps: PeopleTreeItemKeyboardProps;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <ContextMenuTarget
      menu={createPersonContextMenu(person)}
      onOpen={() => onSelect(person.id)}
    >
      <button
        type="button"
        className={[
          "people-tree-row",
          "people-tree-person-row",
          selected && "is-selected",
        ]
          .filter(Boolean)
          .join(" ")}
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        data-node-id={person.id}
        {...keyboardProps}
        onClick={() => onSelect(person.id)}
      >
        <Icon icon="person" size={12} />
        <span
          className="people-list-marker"
          style={{ "--person-color": person.color } as CSSProperties}
          aria-hidden="true"
        />
        <strong>{person.label}</strong>
        <span className="people-tree-person-status">
          {person.status || person.alignmentLabel || "—"}
        </span>
      </button>
    </ContextMenuTarget>
  );
}

function EmptyPeopleState() {
  return (
    <div className="people-list-empty">
      <Icon icon="search" size={20} />
      <p>No people match these filters.</p>
    </div>
  );
}

function toggleSetValue<T>(current: Set<T>, value: T) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
