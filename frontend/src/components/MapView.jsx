import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';

const center = [-1.85, 106.12];

const markerIcon = (status) => L.divIcon({
  className: 'marker-shell',
  html: `<span class="map-pin ${status === 'PROSPECT' ? 'map-pin-prospect' : status === 'LOW' || status === 'EMPTY' ? 'map-pin-alert' : 'map-pin-partner'}"></span>`,
  iconSize: [24, 30],
  iconAnchor: [12, 27],
});

function MapBehavior({ points, focusLocation }) {
  const map = useMap();
  useEffect(() => {
    if (focusLocation) {
      map.flyTo([Number(focusLocation.latitude), Number(focusLocation.longitude)], 15, { duration: 0.45 });
    } else if (points.length > 1) {
      map.fitBounds(points.map((point) => [Number(point.latitude), Number(point.longitude)]), { padding: [36, 36], maxZoom: 14 });
    } else if (points.length === 1) {
      map.setView([Number(points[0].latitude), Number(points[0].longitude)], 13);
    }
  }, [focusLocation, map, points]);
  return null;
}

function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(event) {
      onMapClick?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    },
  });
  return null;
}

function MapLegend() {
  return (
    <div className="map-legend">
      <span><i className="legend-dot partner-dot" /> Mitra</span>
      <span><i className="legend-dot alert-dot" /> Stok menipis/habis</span>
      <span><i className="legend-dot prospect-dot" /> Calon mitra</span>
    </div>
  );
}

export default function MapView({
  outlets = [],
  routeStops = [],
  className = '',
  focusLocation,
  selectedLocation,
  onMapClick,
  showLegend = true,
}) {
  const points = useMemo(
    () => outlets.filter((outlet) => Number.isFinite(Number(outlet.latitude)) && Number.isFinite(Number(outlet.longitude))),
    [outlets],
  );
  const routePositions = routeStops
    .filter((stop) => Number.isFinite(Number(stop.latitude)) && Number.isFinite(Number(stop.longitude)))
    .map((stop) => [Number(stop.latitude), Number(stop.longitude)]);

  return (
    <div className={`map-wrap ${className}`}>
      <MapContainer center={center} zoom={11} scrollWheelZoom className="distribution-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapBehavior points={points} focusLocation={focusLocation || selectedLocation} />
        {onMapClick && <MapClickHandler onMapClick={onMapClick} />}
        {points.map((outlet) => (
          <Marker
            key={outlet.outletId}
            position={[Number(outlet.latitude), Number(outlet.longitude)]}
            icon={markerIcon(outlet.partnershipStatus === 'PROSPECT' ? 'PROSPECT' : outlet.stockCondition)}
          >
            <Popup>
              <strong>{outlet.outletName}</strong>
              <br />
              {outlet.partnershipStatus === 'PROSPECT' ? 'Calon mitra' : 'Mitra'}
              {outlet.stockCondition && <><br />{({ SAFE: 'Aman', LOW: 'Stok menipis', EMPTY: 'Stok habis' })[outlet.stockCondition]}</>}
              {outlet.address && <><br />{outlet.address}</>}
            </Popup>
          </Marker>
        ))}
        {selectedLocation && (
          <Marker
            position={[Number(selectedLocation.latitude), Number(selectedLocation.longitude)]}
            icon={markerIcon('PARTNER')}
          >
            <Popup>Lokasi toko baru</Popup>
          </Marker>
        )}
        {routePositions.length > 1 && <Polyline positions={routePositions} pathOptions={{ color: '#267da6', weight: 4, dashArray: '7 8' }} />}
      </MapContainer>
      {showLegend && <MapLegend />}
    </div>
  );
}
