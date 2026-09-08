import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { divIcon, type Marker as LeafletMarker } from "leaflet";
import { Link } from "react-router-dom";
import { Circle, Marker, Popup, Tooltip, useMap } from "react-leaflet";
import type { GraphNode } from "../../types";
import {
  createRelationshipMapLocations,
  type RelationshipMapLocation,
  type RelationshipMapPlacement,
} from "../../features/relationships/relationshipMap";
import type { GraphPersonLocation } from "../../types";
import { MapView } from "./MapView";

interface RelationshipMapViewProps {
  people: GraphNode[];
}

const CITY_ZONE_RADIUS_METERS = 7_500;

export function RelationshipMapView({ people }: RelationshipMapViewProps) {
  const locations = useMemo(
    () => createRelationshipMapLocations(people),
    [people],
  );
  const locatedPeopleCount = new Set(
    locations.flatMap((location) => location.people.map((person) => person.id)),
  ).size;
  const addressCount = locations.filter(
    (location) => location.precision === "address",
  ).length;
  const cityZoneCount = locations.length - addressCount;

  return (
    <div className="relationship-people-map">
      <MapView ariaLabel="Relationships map">
        <RelationshipMapLayers locations={locations} />
      </MapView>
      <div
        aria-label="Location precision legend"
        className="relationship-map-legend"
      >
        <span>
          <i aria-hidden="true" className="relationship-map-legend-pin" />
          Exact address
        </span>
        <span>
          <i aria-hidden="true" className="relationship-map-legend-zone" />
          City only
        </span>
      </div>
      <div className="relationship-map-summary" role="status">
        <span>{locatedPeopleCount} people</span>
        {addressCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {addressCount} {addressCount === 1 ? "address" : "addresses"}
            </span>
          </>
        ) : null}
        {cityZoneCount > 0 ? (
          <>
            <span aria-hidden="true">·</span>
            <span>
              {cityZoneCount} city {cityZoneCount === 1 ? "zone" : "zones"}
            </span>
          </>
        ) : null}
      </div>
      {locations.length === 0 ? (
        <div className="relationship-map-empty">
          <h1>No locations available</h1>
          <p>
            Add a known location to a person note, then run the location sync
            to place them on this map.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function RelationshipMapLayers({
  locations,
}: {
  locations: RelationshipMapLocation[];
}) {
  const map = useMap();
  const [activeLocationId, setActiveLocationId] = useState<string>();
  const pendingMoveEnd = useRef<(() => void) | null>(null);
  const locationsByPersonLocationId = useMemo(
    () =>
      new Map(
        locations.flatMap((location) =>
          location.placements.map((placement) => [
            placement.personLocation.id,
            location,
          ]),
        ),
      ),
    [locations],
  );
  const navigateToPersonLocation = useCallback(
    (personLocation: GraphPersonLocation) => {
      const location = locationsByPersonLocationId.get(personLocation.id);
      if (!location) return;

      if (pendingMoveEnd.current) {
        map.off("moveend", pendingMoveEnd.current);
      }
      map.closePopup();
      setActiveLocationId(undefined);
      const openDestinationPopup = () => {
        pendingMoveEnd.current = null;
        setActiveLocationId(location.id);
      };
      pendingMoveEnd.current = openDestinationPopup;
      map.once("moveend", openDestinationPopup);
      map.flyTo(
        [location.latitude, location.longitude],
        location.precision === "city" ? 10 : 13,
        { duration: 0.65 },
      );
    },
    [locationsByPersonLocationId, map],
  );

  useEffect(
    () => () => {
      if (pendingMoveEnd.current) {
        map.off("moveend", pendingMoveEnd.current);
      }
    },
    [map],
  );

  return (
    <>
      <MapBounds locations={locations} />
      {locations.map((location) =>
        location.precision === "city" ? (
          <RelationshipCityZone
            active={activeLocationId === location.id}
            key={location.id}
            location={location}
            onNavigate={navigateToPersonLocation}
            onSelect={() => setActiveLocationId(location.id)}
          />
        ) : (
          <RelationshipLocationMarker
            active={activeLocationId === location.id}
            key={location.id}
            location={location}
            onNavigate={navigateToPersonLocation}
            onSelect={() => setActiveLocationId(location.id)}
          />
        ),
      )}
    </>
  );
}

function MapBounds({
  locations,
}: {
  locations: RelationshipMapLocation[];
}) {
  const map = useMap();

  useEffect(() => {
    if (locations.length === 0) return;
    if (locations.length === 1) {
      const [location] = locations;
      map.setView(
        [location.latitude, location.longitude],
        location.precision === "city" ? 10 : 13,
      );
      return;
    }

    const includesCityZone = locations.some(
      (location) => location.precision === "city",
    );
    map.fitBounds(
      locations.map(({ latitude, longitude }) => [latitude, longitude]),
      { padding: [56, 56], maxZoom: includesCityZone ? 10 : 13 },
    );
  }, [locations, map]);

  return null;
}

function RelationshipCityZone({
  active,
  location,
  onNavigate,
  onSelect,
}: {
  active: boolean;
  location: RelationshipMapLocation;
  onNavigate: (location: GraphPersonLocation) => void;
  onSelect: () => void;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const peopleCount = location.people.length;
  const zoneColor = peopleCount > 1 ? "#a78bfa" : location.color;
  const peopleLabel =
    peopleCount === 1 ? location.people[0].label : `${peopleCount} people`;
  const zoneLabel = `${peopleLabel}, city-level location in ${location.label}; exact address unknown`;
  const icon = useMemo(
    () =>
      divIcon({
        className: "relationship-map-zone-marker",
        html: `<span class="relationship-map-zone-badge" style="--relationship-zone-color: ${zoneColor}">${peopleCount}</span>`,
        iconAnchor: [17, 17],
        iconSize: [34, 34],
        popupAnchor: [0, -18],
        tooltipAnchor: [0, -18],
      }),
    [peopleCount, zoneColor],
  );

  useEffect(() => {
    if (active) markerRef.current?.openPopup();
  }, [active]);

  return (
    <>
      <Circle
        center={[location.latitude, location.longitude]}
        interactive={false}
        pathOptions={{
          color: zoneColor,
          dashArray: "7 7",
          fillColor: zoneColor,
          fillOpacity: 0.13,
          opacity: 0.78,
          weight: 2,
        }}
        radius={CITY_ZONE_RADIUS_METERS}
      />
      <Marker
        alt={zoneLabel}
        eventHandlers={{ click: onSelect }}
        icon={icon}
        position={[location.latitude, location.longitude]}
        ref={markerRef}
        title={zoneLabel}
        zIndexOffset={-100}
      >
        <LocationTooltip location={location} peopleLabel={peopleLabel} cityOnly />
        <LocationPopup
          location={location}
          cityOnly
          onNavigate={onNavigate}
        />
      </Marker>
    </>
  );
}

function RelationshipLocationMarker({
  active,
  location,
  onNavigate,
  onSelect,
}: {
  active: boolean;
  location: RelationshipMapLocation;
  onNavigate: (location: GraphPersonLocation) => void;
  onSelect: () => void;
}) {
  const markerRef = useRef<LeafletMarker | null>(null);
  const peopleCount = location.people.length;
  const markerColor = peopleCount > 1 ? "#a78bfa" : location.color;
  const icon = useMemo(
    () =>
      divIcon({
        className: "relationship-map-marker",
        html: `<span class="relationship-map-marker-dot" style="--relationship-marker-color: ${markerColor}"><span class="relationship-map-marker-count">${peopleCount > 1 ? peopleCount : ""}</span></span>`,
        iconAnchor: [18, 36],
        iconSize: [36, 36],
        popupAnchor: [0, -32],
        tooltipAnchor: [0, -28],
      }),
    [markerColor, peopleCount],
  );
  const peopleLabel =
    peopleCount === 1 ? location.people[0].label : `${peopleCount} people`;
  const markerLabel = `${peopleLabel}, ${location.label}`;

  useEffect(() => {
    if (active) markerRef.current?.openPopup();
  }, [active]);

  return (
    <Marker
      alt={markerLabel}
      eventHandlers={{ click: onSelect }}
      icon={icon}
      position={[location.latitude, location.longitude]}
      ref={markerRef}
      title={markerLabel}
    >
      <LocationTooltip location={location} peopleLabel={peopleLabel} />
      <LocationPopup location={location} onNavigate={onNavigate} />
    </Marker>
  );
}

function LocationTooltip({
  location,
  peopleLabel,
  cityOnly = false,
}: {
  location: RelationshipMapLocation;
  peopleLabel: string;
  cityOnly?: boolean;
}) {
  return (
    <Tooltip direction="top" opacity={1}>
      <strong>{peopleLabel}</strong>
      <span>{location.label}</span>
      {cityOnly ? <em>City only · exact address unknown</em> : null}
    </Tooltip>
  );
}

function LocationPopup({
  location,
  cityOnly = false,
  onNavigate,
}: {
  location: RelationshipMapLocation;
  cityOnly?: boolean;
  onNavigate: (location: GraphPersonLocation) => void;
}) {
  const map = useMap();
  const peopleCount = location.people.length;
  const zoomIn = () => {
    const detailZoom = location.precision === "city" ? 13 : 17;
    map.flyTo(
      [location.latitude, location.longitude],
      Math.min(18, Math.max(detailZoom, map.getZoom() + 2)),
      { duration: 0.45 },
    );
  };

  return (
    <Popup maxWidth={320} minWidth={240}>
      <div className="relationship-map-popup">
        <span className="relationship-map-popup-kicker">
          {cityOnly
            ? "City area · exact address unknown"
            : `${peopleCount} ${peopleCount === 1 ? "person" : "people"}`}
        </span>
        <div className="relationship-map-popup-location-row">
          {location.mapsUrl ? (
            <a
              className="relationship-map-popup-location"
              href={location.mapsUrl}
              rel="noreferrer"
              target="_blank"
            >
              {location.label}
            </a>
          ) : (
            <span className="relationship-map-popup-location">
              {location.label}
            </span>
          )}
          <button
            aria-label={`Zoom in on ${location.label}`}
            className="relationship-map-popup-zoom"
            onClick={zoomIn}
            type="button"
          >
            Zoom in
            <span aria-hidden="true">+</span>
          </button>
        </div>
        <ul>
          {location.placements.map((placement) => (
            <li key={`${placement.person.id}:${placement.personLocation.id}`}>
              <Link to={placement.person.href}>
                <span
                  aria-hidden="true"
                  className="relationship-map-person-dot"
                  style={{ backgroundColor: placement.person.relationColor }}
                />
                <span>{placement.person.label}</span>
              </Link>
              <PersonLocationNavigation
                onNavigate={onNavigate}
                placement={placement}
              />
            </li>
          ))}
        </ul>
      </div>
    </Popup>
  );
}

function PersonLocationNavigation({
  onNavigate,
  placement,
}: {
  onNavigate: (location: GraphPersonLocation) => void;
  placement: RelationshipMapPlacement;
}) {
  const { locationCount, locationIndex, person, personLocation } = placement;
  const nextLocation =
    locationCount > 1
      ? person.locations?.[(locationIndex + 1) % locationCount]
      : undefined;

  if (!nextLocation) {
    return personLocation.label === "Location" ? null : (
      <span className="relationship-map-person-location-label">
        {personLocation.label}
      </span>
    );
  }

  return (
    <div className="relationship-map-person-location-navigation">
      <span>
        {personLocation.label} · {locationIndex + 1} of {locationCount}
      </span>
      <button
        aria-label={`Show ${person.label}'s ${nextLocation.label.toLocaleLowerCase()} on the map`}
        onClick={() => onNavigate(nextLocation)}
        type="button"
      >
        Next: {nextLocation.label}
        <span aria-hidden="true">→</span>
      </button>
    </div>
  );
}
