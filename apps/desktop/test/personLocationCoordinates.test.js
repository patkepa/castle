import assert from "node:assert/strict";
import test from "node:test";
import matter from "gray-matter";
import {
  coordinatesMatchLocation,
  geocodeAddress,
  personLocationCheckError,
  removePersonCoordinatesSource,
  updatePersonCoordinatesSource,
  updatePersonLocationsSource,
} from "../../../scripts/sync-person-locations.mjs";

test("reports stale coordinates in check mode without requiring geocoding", () => {
  assert.equal(personLocationCheckError(0, 0), null);
  assert.match(personLocationCheckError(2, 1), /2 locations need geocoding/);
  assert.match(personLocationCheckError(2, 1), /1 obsolete coordinate block needs removal/);
  assert.match(
    personLocationCheckError(2, 1),
    /cargo xtask sync-person-locations/,
  );
});

const personSource = `---
type: person
location: "London, United Kingdom"
tags:
  - relationship
---

# Person
`;

test("inserts coordinates tied to the address without changing note content", () => {
  const updated = updatePersonCoordinatesSource(personSource, {
    location: "London, United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
  });

  assert.deepEqual(matter(updated).data.coordinates, {
    latitude: 51.5074,
    longitude: -0.1278,
    resolved_from: "London, United Kingdom",
  });
  assert.match(updated, /\n# Person\n$/);
});

test("replaces stale coordinates and removes them for unknown locations", () => {
  const withCoordinates = updatePersonCoordinatesSource(personSource, {
    location: "London, United Kingdom",
    latitude: 51,
    longitude: 0,
  });
  const refreshed = updatePersonCoordinatesSource(withCoordinates, {
    location: "London, United Kingdom",
    latitude: 51.5074,
    longitude: -0.1278,
  });

  assert.equal((refreshed.match(/^coordinates:/gm) ?? []).length, 1);
  assert.equal(matter(refreshed).data.coordinates.latitude, 51.5074);
  assert.equal(
    matter(removePersonCoordinatesSource(refreshed)).data.coordinates,
    undefined,
  );
});

test("detects whether coordinates were resolved from the current address", () => {
  const coordinates = {
    latitude: 51.5074,
    longitude: -0.1278,
    resolved_from: "London, United Kingdom",
  };

  assert.equal(coordinatesMatchLocation(coordinates, "London, United Kingdom"), true);
  assert.equal(coordinatesMatchLocation(coordinates, "Edinburgh, United Kingdom"), false);
});

test("writes generated coordinates for every entry in a plural locations block", () => {
  const source = `---
type: person
locations:
  - label: "Primary home"
    address: "London, United Kingdom"
    primary: true
  - label: "Family home"
    address: "Edinburgh, United Kingdom"
tags:
  - relationship
---

# Person
`;
  const updated = updatePersonLocationsSource(source, [
    {
      label: "Primary home",
      address: "London, United Kingdom",
      primary: true,
      coordinates: {
        latitude: 51.5074,
        longitude: -0.1278,
        resolved_from: "London, United Kingdom",
      },
    },
    {
      label: "Family home",
      address: "Edinburgh, United Kingdom",
      primary: false,
      coordinates: {
        latitude: 55.9533,
        longitude: -3.1883,
        resolved_from: "Edinburgh, United Kingdom",
      },
    },
  ]);

  assert.deepEqual(matter(updated).data.locations, [
    {
      label: "Primary home",
      address: "London, United Kingdom",
      primary: true,
      coordinates: {
        latitude: 51.5074,
        longitude: -0.1278,
        resolved_from: "London, United Kingdom",
      },
    },
    {
      label: "Family home",
      address: "Edinburgh, United Kingdom",
      coordinates: {
        latitude: 55.9533,
        longitude: -3.1883,
        resolved_from: "Edinburgh, United Kingdom",
      },
    },
  ]);
  assert.match(updated, /\n# Person\n$/);
});

test("uses Google Geocoding v4 with the API key in a header", async () => {
  let request;
  const coordinates = await geocodeAddress(
    "London, United Kingdom",
    "secret-key",
    async (url, options) => {
      request = { url: String(url), options };
      return new Response(
        JSON.stringify({
          results: [{ location: { latitude: 51.5074, longitude: -0.1278 } }],
        }),
        { status: 200 },
      );
    },
  );

  assert.deepEqual(coordinates, { latitude: 51.5074, longitude: -0.1278 });
  assert.match(request.url, /London%2C%20United%20Kingdom$/);
  assert.equal(request.url.includes("secret-key"), false);
  assert.equal(request.options.headers["X-Goog-Api-Key"], "secret-key");
  assert.equal(
    request.options.headers["X-Goog-FieldMask"],
    "results.location",
  );
});
