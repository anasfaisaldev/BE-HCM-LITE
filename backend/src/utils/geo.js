/** Great-circle distance in metres (Haversine). Always computed on the server from raw coordinates. */
export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
