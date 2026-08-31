import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRelationshipLocation,
  createRelationshipMapLocations,
  createRelationshipMapSources,
} from "../apps/desktop/src/features/relationships/relationshipMap.ts";

test("groups people sharing location text and omits unknown locations", () => {
  const sources = createRelationshipMapSources([
    person("alice", "Alice", "London, United Kingdom"),
    person("bob", "Bob", "London, United Kingdom"),
    person("charlie", "Charlie", "München, Germany"),
    person("unknown", "Unknown", "Unknown", ""),
  ]);

  assert.deepEqual(
    sources.map((source) => ({
      label: source.label,
      people: source.people.map(({ label }) => label),
    })),
    [
      { label: "London, United Kingdom", people: ["Alice", "Bob"] },
      { label: "München, Germany", people: ["Charlie"] },
    ],
  );
});

test("builds map markers from persisted coordinates", () => {
  const locations = createRelationshipMapLocations([
    person("alice", "Alice", "London, United Kingdom", undefined, 51.5074, -0.1278),
    person("bob", "Bob", "München, Germany", undefined, 48.1371, 11.5754),
  ]);

  assert.deepEqual(
    locations.map(({ label, latitude, longitude }) => ({
      label,
      latitude,
      longitude,
    })),
    [
      { label: "London, United Kingdom", latitude: 51.5074, longitude: -0.1278 },
      { label: "München, Germany", latitude: 48.1371, longitude: 11.5754 },
    ],
  );
});

test("omits known locations until coordinates have been synced", () => {
  assert.deepEqual(
    createRelationshipMapLocations([
      person("charlie", "Charlie", "London, United Kingdom"),
    ]),
    [],
  );
});

test("creates a marker and navigation placement for every person location", () => {
  const dana = person(
    "dana",
    "Dana",
    "London, United Kingdom",
  );
  dana.locations = [
    {
      id: "dana:primary",
      label: "Primary home",
      address: "London, United Kingdom",
      primary: true,
      mapsUrl: "https://maps.example/london",
      latitude: 51.5074,
      longitude: -0.1278,
    },
    {
      id: "dana:family",
      label: "Family home",
      address: "Edinburgh, United Kingdom",
      primary: false,
      mapsUrl: "https://maps.example/edinburgh",
      latitude: 55.9533,
      longitude: -3.1883,
    },
  ];

  const locations = createRelationshipMapLocations([dana]);

  assert.deepEqual(
    locations.map((location) => ({
      label: location.label,
      placements: location.placements.map((placement) => ({
        label: placement.personLocation.label,
        index: placement.locationIndex,
        count: placement.locationCount,
      })),
    })),
    [
      {
        label: "Edinburgh, United Kingdom",
        placements: [{ label: "Family home", index: 1, count: 2 }],
      },
      {
        label: "London, United Kingdom",
        placements: [{ label: "Primary home", index: 0, count: 2 }],
      },
    ],
  );
});

test("distinguishes exact addresses from city-only locations", () => {
  assert.equal(
    classifyRelationshipLocation("123 Example Street, Exampleville, EX1 2MP"),
    "address",
  );
  assert.equal(
    classifyRelationshipLocation("42 Fictional Road, Sampletown, ZZ9 9ZZ"),
    "address",
  );
  assert.equal(classifyRelationshipLocation("London, United Kingdom"), "city");
  assert.equal(
    classifyRelationshipLocation("Edinburgh, United Kingdom"),
    "city",
  );

  const sources = createRelationshipMapSources([
    person("address", "Address", "123 Example Street, Exampleville, EX1 2MP"),
    person("city", "City", "Exampleville, Example Country"),
  ]);

  assert.deepEqual(
    sources.map(({ label, precision }) => ({ label, precision })),
    [
      {
        label: "123 Example Street, Exampleville, EX1 2MP",
        precision: "address",
      },
      { label: "Exampleville, Example Country", precision: "city" },
    ],
  );
});

function person(
  id,
  label,
  location,
  mapsUrl = `https://maps.example/${id}`,
  latitude,
  longitude,
) {
  return {
    id: `person:people/${id}`,
    type: "person",
    label,
    href: `/note/people/${id}`,
    location,
    mapsUrl,
    latitude,
    longitude,
    relationColor: "#22c55e",
    color: "#22c55e",
  };
}
