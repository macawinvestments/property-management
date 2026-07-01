import { useEffect, useRef, useState } from 'react';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

// Load the Google Maps JS + Places library once, shared across mounts.
let loadPromise = null;
function loadGoogleMaps() {
  if (window.google && window.google.maps && window.google.maps.places) {
    return Promise.resolve(window.google);
  }
  if (loadPromise) return loadPromise;
  if (!KEY) return Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_KEY'));

  loadPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&libraries=places`;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve(window.google);
    s.onerror = () => reject(new Error('Failed to load Google Maps'));
    document.head.appendChild(s);
  });
  return loadPromise;
}

// A text input backed by Google Places Autocomplete. On selection it reports
// the canonical formatted address, place_id, and coordinates via onSelect.
// Falls back to a plain input (with manual typing) if the key is missing.
export default function AddressAutocomplete({ value, onChange, onSelect, placeholder }) {
  const inputRef = useRef(null);
  const acRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!KEY) { setErr('no-key'); return; }
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !inputRef.current) return;
        const ac = new google.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'place_id', 'geometry'],
          types: ['address'],
          componentRestrictions: { country: 'us' },
        });
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place || !place.place_id) return;
          const addr = place.formatted_address || '';
          const lat = place.geometry?.location?.lat?.() ?? null;
          const lng = place.geometry?.location?.lng?.() ?? null;
          onSelect({ address: addr, placeId: place.place_id, lat, lng });
        });
        acRef.current = ac;
        setReady(true);
      })
      .catch((e) => setErr(e.message || 'load-failed'));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <input
        ref={inputRef}
        className="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || 'Start typing an address…'}
        autoComplete="off"
      />
      {err === 'no-key' && (
        <span className="calc-note">Address autocomplete needs VITE_GOOGLE_MAPS_KEY — typing still works.</span>
      )}
      {err && err !== 'no-key' && (
        <span className="calc-note">Autocomplete unavailable ({err}) — typing still works.</span>
      )}
    </>
  );
}
