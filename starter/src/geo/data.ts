/**
 * Sample data for the map: an invented company's revenue share by country and
 * a few office sites. Country outlines are real (Natural Earth, via the
 * world-atlas package); the numbers are made up. City coordinates are real.
 */
export const REVENUE_SHARE: Record<string, number> = {
  "United States of America": 31.5, Germany: 11.2, "United Kingdom": 9.8, Japan: 7.4, France: 6.1, Canada: 4.9,
  Switzerland: 3.6, Netherlands: 3.3, Australia: 3.1, Singapore: 2.8, Sweden: 2.2, Italy: 2.1, Spain: 1.9,
  Brazil: 1.8, India: 1.7, "South Korea": 1.5, Mexico: 1.1, Norway: 0.9, Poland: 0.8, "South Africa": 0.7,
  Ireland: 0.6, Denmark: 0.5, Austria: 0.4, "New Zealand": 0.3, Chile: 0.2,
};

export interface Site {
  id: string;
  city: string;
  country: string;
  lon: number;
  lat: number;
  staff: number;
  role: string;
}

export const SITES: Site[] = [
  { id: "nyc", city: "New York", country: "United States of America", lon: -74.006, lat: 40.713, staff: 140, role: "Headquarters" },
  { id: "chi", city: "Chicago", country: "United States of America", lon: -87.63, lat: 41.878, staff: 45, role: "Engineering" },
  { id: "lon", city: "London", country: "United Kingdom", lon: -0.128, lat: 51.507, staff: 95, role: "Research" },
  { id: "fra", city: "Frankfurt", country: "Germany", lon: 8.682, lat: 50.111, staff: 60, role: "Operations" },
  { id: "zrh", city: "Zurich", country: "Switzerland", lon: 8.541, lat: 47.377, staff: 25, role: "Sales" },
  { id: "sin", city: "Singapore", country: "Singapore", lon: 103.82, lat: 1.352, staff: 55, role: "Operations" },
  { id: "tyo", city: "Tokyo", country: "Japan", lon: 139.692, lat: 35.69, staff: 70, role: "Sales" },
  { id: "syd", city: "Sydney", country: "Australia", lon: 151.209, lat: -33.869, staff: 30, role: "Support" },
  { id: "sao", city: "São Paulo", country: "Brazil", lon: -46.633, lat: -23.55, staff: 20, role: "Sales" },
];
