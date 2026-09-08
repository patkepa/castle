import { existsSync } from "node:fs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import matter from "gray-matter";
import { readCastleConfiguration } from "./read-configuration.mjs";

const castleRoot = path.resolve(import.meta.dirname, "..");
const configuration = readCastleConfiguration({ castleRoot });
const peopleRoot = path.join(configuration.libraryPath, "people");
const envPath = path.join(castleRoot, ".env");

export function isKnownLocation(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().toLocaleLowerCase() !== "unknown"
  );
}

export function coordinatesMatchLocation(coordinates, location) {
  return (
    isCoordinates(coordinates) &&
    coordinates.resolved_from === location.trim()
  );
}

export async function geocodeAddress(
  location,
  apiKey,
  fetchImpl = fetch,
) {
  const encodedLocation = encodeURIComponent(location.trim());
  const url = new URL(
    `https://geocode.googleapis.com/v4/geocode/address/${encodedLocation}`,
  );
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "results.location",
    },
  });

  if (!response.ok) {
    throw new Error(`Google Geocoding returned HTTP ${response.status}`);
  }

  const body = await response.json();
  const coordinates = body?.results?.[0]?.location;
  if (!isCoordinatePair(coordinates)) {
    throw new Error("Google Geocoding did not return a valid location");
  }

  return {
    latitude: coordinates.latitude,
    longitude: coordinates.longitude,
  };
}

export function updatePersonCoordinatesSource(
  source,
  { location, latitude, longitude },
) {
  return mutateFrontmatter(source, (frontmatter) => {
    const locationIndex = findTopLevelProperty(frontmatter, "location");
    if (locationIndex < 0) {
      throw new Error("Person record is missing a top-level location property");
    }

    const block = [
      "coordinates:",
      `  latitude: ${formatCoordinate(latitude)}`,
      `  longitude: ${formatCoordinate(longitude)}`,
      `  resolved_from: ${JSON.stringify(location.trim())}`,
    ];
    replaceOrInsertBlock(frontmatter, "coordinates", locationIndex + 1, block);
  });
}

export function removePersonCoordinatesSource(source) {
  return mutateFrontmatter(source, (frontmatter) => {
    const coordinatesIndex = findTopLevelProperty(frontmatter, "coordinates");
    if (coordinatesIndex < 0) return;
    const end = nestedBlockEnd(frontmatter, coordinatesIndex);
    frontmatter.splice(coordinatesIndex, end - coordinatesIndex);
  });
}

export function updatePersonLocationsSource(source, locations) {
  return mutateFrontmatter(source, (frontmatter) => {
    const locationsIndex = findTopLevelProperty(frontmatter, "locations");
    if (locationsIndex < 0) {
      throw new Error("Person record is missing a top-level locations property");
    }

    const block = ["locations:"];
    for (const location of locations) {
      block.push(`  - label: ${JSON.stringify(location.label.trim())}`);
      block.push(`    address: ${JSON.stringify(location.address.trim())}`);
      if (location.primary === true) block.push("    primary: true");
      if (isCoordinates(location.coordinates)) {
        block.push("    coordinates:");
        block.push(
          `      latitude: ${formatCoordinate(location.coordinates.latitude)}`,
        );
        block.push(
          `      longitude: ${formatCoordinate(location.coordinates.longitude)}`,
        );
        block.push(
          `      resolved_from: ${JSON.stringify(location.coordinates.resolved_from.trim())}`,
        );
      }
    }
    replaceOrInsertBlock(
      frontmatter,
      "locations",
      locationsIndex,
      block,
    );
  });
}

export async function syncPersonLocations({
  apiKey = process.env.GOOGLE_MAPS_API_KEY,
  checkOnly = false,
  fetchImpl = fetch,
} = {}) {
  const entries = (await readdir(peopleRoot, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && [".md", ".mdx"].includes(path.extname(entry.name)),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
  const records = await Promise.all(
    entries.map(async (entry) => {
      const filePath = path.join(peopleRoot, entry.name);
      const source = await readFile(filePath, "utf8");
      const frontmatter = matter(source).data;
      const locations = readPersonLocations(frontmatter);
      return {
        filePath,
        source,
        frontmatter,
        locations,
        usesPluralLocations: Array.isArray(frontmatter.locations),
      };
    }),
  );

  const staleLocations = records.flatMap((record) =>
    record.locations.flatMap((location, locationIndex) =>
      isKnownLocation(location.address) &&
      !coordinatesMatchLocation(location.coordinates, location.address)
        ? [{ record, location, locationIndex }]
        : [],
    ),
  );
  const removableLocations = records.flatMap((record) =>
    record.locations.flatMap((location, locationIndex) =>
      !isKnownLocation(location.address) && location.coordinates !== undefined
        ? [{ record, location, locationIndex }]
        : [],
    ),
  );

  if (checkOnly) {
    const error = personLocationCheckError(
      staleLocations.length,
      removableLocations.length,
    );
    if (error) throw new Error(error);
    console.log("Person coordinates are current.");
    return {
      updatedPeople: 0,
      updatedLocations: 0,
      removedPeople: 0,
    };
  }

  if (staleLocations.length > 0 && !apiKey) {
    throw new Error(
      `${staleLocations.length} person location${staleLocations.length === 1 ? " needs" : "s need"} updated coordinates. Set GOOGLE_MAPS_API_KEY in castle/.env, then rerun cargo xtask sync-person-locations.`,
    );
  }

  const uniqueLocations = [
    ...new Set(staleLocations.map(({ location }) => location.address)),
  ];
  const coordinatesByLocation = new Map();
  for (const location of uniqueLocations) {
    coordinatesByLocation.set(
      location,
      await geocodeAddress(location, apiKey, fetchImpl),
    );
  }

  const changedRecords = new Set([
    ...staleLocations.map(({ record }) => record),
    ...removableLocations.map(({ record }) => record),
  ]);
  const writes = [...changedRecords].map((record) => {
    if (record.usesPluralLocations) {
      const locations = record.locations.map((location) => {
        if (!isKnownLocation(location.address)) {
          return { ...location, coordinates: undefined };
        }
        const coordinates = coordinatesByLocation.get(location.address);
        return coordinates
          ? {
              ...location,
              coordinates: {
                ...coordinates,
                resolved_from: location.address,
              },
            }
          : location;
      });
      return writeFile(
        record.filePath,
        updatePersonLocationsSource(record.source, locations),
      );
    }

    const [location] = record.locations;
    const coordinates = coordinatesByLocation.get(location.address);
    const source = coordinates
      ? updatePersonCoordinatesSource(record.source, {
          location: location.address,
          ...coordinates,
        })
      : removePersonCoordinatesSource(record.source);
    return writeFile(record.filePath, source);
  });
  await Promise.all(writes);

  if (writes.length === 0) {
    console.log("Person coordinates are current.");
  } else {
    console.log(
      `Updated ${staleLocations.length} person locations across ${uniqueLocations.length} geocoded addresses${removableLocations.length > 0 ? `; removed ${removableLocations.length} unknown locations` : ""}.`,
    );
  }

  return {
    updatedPeople: new Set(staleLocations.map(({ record }) => record.filePath))
      .size,
    updatedLocations: uniqueLocations.length,
    removedPeople: new Set(
      removableLocations.map(({ record }) => record.filePath),
    ).size,
  };
}

export function personLocationCheckError(staleCount, removableCount) {
  const pendingCount = staleCount + removableCount;
  if (pendingCount === 0) return null;
  return (
    `Person coordinates are not current: ${staleCount} location${staleCount === 1 ? " needs" : "s need"} geocoding` +
    `${removableCount > 0 ? ` and ${removableCount} obsolete coordinate block${removableCount === 1 ? " needs" : "s need"} removal` : ""}. ` +
    "Run cargo xtask sync-person-locations, review the Markdown changes, then validate again."
  );
}

function readPersonLocations(frontmatter) {
  if (Array.isArray(frontmatter.locations)) {
    return frontmatter.locations.map((location) => ({
      label: typeof location?.label === "string" ? location.label.trim() : "",
      address:
        typeof location?.address === "string" ? location.address.trim() : "",
      primary: location?.primary === true,
      coordinates: location?.coordinates,
    }));
  }

  return [
    {
      label: "Location",
      address:
        typeof frontmatter.location === "string"
          ? frontmatter.location.trim()
          : "",
      primary: true,
      coordinates: frontmatter.coordinates,
    },
  ];
}

function isCoordinates(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    isCoordinatePair(value) &&
    typeof value.resolved_from === "string"
  );
}

function isCoordinatePair(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    value.latitude >= -90 &&
    value.latitude <= 90 &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.longitude >= -180 &&
    value.longitude <= 180
  );
}

function mutateFrontmatter(source, mutate) {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  if (lines[0] !== "---") {
    throw new Error("Person record requires existing frontmatter");
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) throw new Error("Unclosed person frontmatter");

  const frontmatter = lines.slice(1, end);
  mutate(frontmatter);
  return ["---", ...frontmatter, "---", ...lines.slice(end + 1)].join(newline);
}

function findTopLevelProperty(frontmatter, property) {
  const prefix = `${property}:`;
  return frontmatter.findIndex(
    (line) => !/^\s/.test(line) && line.startsWith(prefix),
  );
}

function replaceOrInsertBlock(frontmatter, property, insertAt, block) {
  const existingIndex = findTopLevelProperty(frontmatter, property);
  if (existingIndex < 0) {
    frontmatter.splice(insertAt, 0, ...block);
    return;
  }
  const end = nestedBlockEnd(frontmatter, existingIndex);
  frontmatter.splice(existingIndex, end - existingIndex, ...block);
}

function nestedBlockEnd(frontmatter, start) {
  let end = start + 1;
  while (end < frontmatter.length && /^\s/.test(frontmatter[end])) end += 1;
  return end;
}

function formatCoordinate(value) {
  if (!Number.isFinite(value)) throw new Error("Invalid coordinate value");
  return String(value);
}

if (existsSync(envPath)) process.loadEnvFile(envPath);

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await syncPersonLocations({ checkOnly: process.argv.includes("--check") });
}
