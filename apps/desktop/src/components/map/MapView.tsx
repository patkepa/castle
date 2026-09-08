import { useEffect, type ReactNode } from "react";
import type { LatLngExpression } from "leaflet";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./mapView.css";

const DEFAULT_CENTER: LatLngExpression = [52.2297, 21.0122];

export interface MapViewProps {
  center?: LatLngExpression;
  zoom?: number;
  children?: ReactNode;
  className?: string;
  ariaLabel?: string;
}

function MapSizeObserver() {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();
    let frameId: number | null = null;

    const invalidate = () => {
      if (frameId !== null) cancelAnimationFrame(frameId);

      frameId = requestAnimationFrame(() => {
        map.invalidateSize({ pan: false });
        frameId = null;
      });
    };

    const resizeObserver = new ResizeObserver(invalidate);
    resizeObserver.observe(container);
    container.addEventListener("transitionend", invalidate);
    invalidate();

    return () => {
      if (frameId !== null) cancelAnimationFrame(frameId);
      container.removeEventListener("transitionend", invalidate);
      resizeObserver.disconnect();
    };
  }, [map]);

  return null;
}

export function MapView({
  center = DEFAULT_CENTER,
  zoom = 5,
  children,
  className = "",
  ariaLabel = "Interactive map",
}: MapViewProps) {
  return (
    <section
      aria-label={ariaLabel}
      className={["map-view", className].filter(Boolean).join(" ")}
    >
      <MapContainer
        center={center}
        className="map-view-canvas"
        preferCanvas
        scrollWheelZoom
        zoom={zoom}
      >
        <TileLayer
          attribution={'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
          maxZoom={19}
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapSizeObserver />
        {children}
      </MapContainer>
    </section>
  );
}
