import type { GraphNode, GraphPersonLocation } from "../../types";

export interface RelationshipMapCoordinates {
  latitude: number;
  longitude: number;
}

export type RelationshipLocationPrecision = "address" | "city";

export interface RelationshipMapPlacement {
  person: GraphNode;
  personLocation: GraphPersonLocation;
  locationIndex: number;
  locationCount: number;
}

export interface RelationshipMapSource {
  id: string;
  label: string;
  mapsUrl?: string;
  color: string;
  precision: RelationshipLocationPrecision;
  people: GraphNode[];
  placements: RelationshipMapPlacement[];
}

export interface RelationshipMapLocation extends RelationshipMapSource {
  latitude: number;
  longitude: number;
}

export function createRelationshipMapSources(
  nodes: GraphNode[],
): RelationshipMapSource[] {
  const sources = new Map<string, RelationshipMapSource>();

  for (const node of nodes) {
    if (node.type !== "person") continue;

    const personLocations = mapLocationsForPerson(node);
    personLocations.forEach((personLocation, locationIndex) => {
      const id = normalizeLocation(personLocation.address);
      const placement = {
        person: node,
        personLocation,
        locationIndex,
        locationCount: personLocations.length,
      };
      const existing = sources.get(id);
      if (existing) {
        if (!existing.people.some((person) => person.id === node.id)) {
          existing.people.push(node);
        }
        existing.placements.push(placement);
        return;
      }

      sources.set(id, {
        id,
        label: personLocation.address,
        mapsUrl: personLocation.mapsUrl,
        color: node.relationColor || node.color,
        precision: classifyRelationshipLocation(personLocation.address),
        people: [node],
        placements: [placement],
      });
    });
  }

  return [...sources.values()]
    .map((source) => ({
      ...source,
      people: source.people.sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
      placements: source.placements.sort(comparePlacements),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function createRelationshipMapLocations(
  nodes: GraphNode[],
): RelationshipMapLocation[] {
  const sources = createRelationshipMapSources(nodes);
  const coordinatesBySource = new Map<string, RelationshipMapCoordinates>();
  for (const source of sources) {
    for (const { personLocation } of source.placements) {
      const coordinates = readCoordinates(
        personLocation.latitude,
        personLocation.longitude,
      );
      if (!coordinates) continue;
      coordinatesBySource.set(source.id, coordinates);
      break;
    }
  }
  const locations = new Map<string, RelationshipMapLocation>();

  for (const source of sources) {
    const coordinates = coordinatesBySource.get(source.id);
    if (!coordinates) continue;

    const coordinateId = `${source.precision}:${coordinates.latitude.toFixed(6)}:${coordinates.longitude.toFixed(6)}`;
    const existing = locations.get(coordinateId);
    if (existing) {
      for (const person of source.people) {
        if (!existing.people.some((candidate) => candidate.id === person.id)) {
          existing.people.push(person);
        }
      }
      existing.placements.push(...source.placements);
      if (existing.label !== source.label) {
        existing.label = `${existing.label}; ${source.label}`;
      }
      continue;
    }

    locations.set(coordinateId, {
      ...source,
      id: coordinateId,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      people: [...source.people],
    });
  }

  return [...locations.values()]
    .map((location) => ({
      ...location,
      people: location.people.sort((left, right) =>
        left.label.localeCompare(right.label),
      ),
      placements: location.placements.sort(comparePlacements),
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function mapLocationsForPerson(node: GraphNode): GraphPersonLocation[] {
  if (node.locations && node.locations.length > 0) {
    return node.locations.filter(
      (location) => location.mapsUrl && location.address,
    );
  }
  if (!node.mapsUrl || !node.location) return [];

  return [
    {
      id: `${node.id}:location:0`,
      label: "Location",
      address: node.location,
      primary: true,
      mapsUrl: node.mapsUrl,
      latitude: node.latitude,
      longitude: node.longitude,
    },
  ];
}

function comparePlacements(
  left: RelationshipMapPlacement,
  right: RelationshipMapPlacement,
) {
  return (
    left.person.label.localeCompare(right.person.label) ||
    left.locationIndex - right.locationIndex
  );
}

export function classifyRelationshipLocation(
  location: string,
): RelationshipLocationPrecision {
  const [firstPart = ""] = location.split(",");
  return /\d/u.test(firstPart) ? "address" : "city";
}

function normalizeLocation(value: string) {
  return value.trim().toLocaleLowerCase();
}

function readCoordinates(
  latitude: unknown,
  longitude: unknown,
): RelationshipMapCoordinates | undefined {
  if (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  ) {
    return { latitude, longitude };
  }
  return undefined;
}
