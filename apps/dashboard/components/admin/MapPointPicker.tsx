'use client';

import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import type { Map as LeafletMap, Marker, LayerGroup } from 'leaflet';

export interface MapArea { id: string; name: string; centerLatitude: number; centerLongitude: number; radiusMeters: number }

/**
 * Owner UAT 2026-11-27 (ML-01): choose a point by clicking the map (OpenStreetMap — no key needed). The served areas are drawn as
 * circles; the marker can be dragged. Leaflet is loaded only in the browser.
 */
export function MapPointPicker({ lat, lng, areas, highlightAreaId, onPick, height = 320 }: { lat: number | null; lng: number | null; areas: MapArea[]; highlightAreaId?: string | null; onPick: (lat: number, lng: number) => void; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const circles = useRef<LayerGroup | null>(null);
  const L = useRef<typeof import('leaflet') | null>(null);
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((mod) => {
      if (cancelled || !box.current || map.current) return;
      const leaflet = (mod as unknown as { default?: typeof import('leaflet') }).default ?? mod;
      L.current = leaflet;
      const start = lat != null && lng != null ? [lat, lng] : areas[0] ? [areas[0].centerLatitude, areas[0].centerLongitude] : [30.4167, 31.5667];
      const m = leaflet.map(box.current, { center: start as [number, number], zoom: lat != null ? 16 : 13 });
      leaflet.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
      circles.current = leaflet.layerGroup().addTo(m);
      m.on('click', (e: { latlng: { lat: number; lng: number } }) => pick.current(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))));
      map.current = m;
      drawAreas();
      placeMarker();
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const drawAreas = () => {
    const leaflet = L.current;
    if (!leaflet || !circles.current) return;
    circles.current.clearLayers();
    for (const a of areas) {
      const on = !highlightAreaId || a.id === highlightAreaId;
      leaflet.circle([a.centerLatitude, a.centerLongitude], { radius: a.radiusMeters, color: on ? '#e0650a' : '#9ca3af', weight: 2, fillOpacity: on ? 0.08 : 0.03, interactive: false }).addTo(circles.current);
    }
  };
  const placeMarker = () => {
    const leaflet = L.current;
    const m = map.current;
    if (!leaflet || !m) return;
    if (lat == null || lng == null) { marker.current?.remove(); marker.current = null; return; }
    if (!marker.current) {
      const icon = leaflet.divIcon({ className: '', html: '<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:#e0650a;transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>', iconSize: [22, 22], iconAnchor: [11, 22] });
      marker.current = leaflet.marker([lat, lng], { draggable: true, icon }).addTo(m);
      marker.current.on('dragend', () => { const p = marker.current!.getLatLng(); pick.current(Number(p.lat.toFixed(6)), Number(p.lng.toFixed(6))); });
    } else marker.current.setLatLng([lat, lng]);
    if (!m.getBounds().contains([lat, lng])) m.setView([lat, lng], Math.max(m.getZoom(), 15));
  };

  useEffect(() => { drawAreas(); }, [areas, highlightAreaId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { placeMarker(); }, [lat, lng]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={box} style={{ height }} className="z-0 mt-2 w-full overflow-hidden rounded-lg border border-gray-200" data-testid="map-point-picker" role="application" aria-label="Map: click to set the location" />;
}
