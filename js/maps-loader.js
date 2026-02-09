// js/maps-loader.js
(function () {
  let p = null;

  window.WTDLoadGoogleMaps = function () {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (p) return p;

    p = new Promise((resolve, reject) => {
      const key = window.WTD_MAPS_KEY;
      if (!key) return reject(new Error("Missing WTD_MAPS_KEY"));

      const s = document.createElement("script");
      // Places library for Autocomplete
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
        key,
      )}&libraries=places`;
      s.async = true;
      s.onerror = () => reject(new Error("Failed to load Google Maps script"));
      s.onload = () => resolve(window.google.maps);
      document.head.appendChild(s);
    });

    return p;
  };
})();
