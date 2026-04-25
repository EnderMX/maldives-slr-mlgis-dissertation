"""
convert_onemap.py
Converts OneMap GeoJSON island boundaries → data/islands.json

Usage:
    1. Download island boundary GeoJSON from https://onemap.mv
    2. Save as maldives_islands.geojson in the project root
    3. Run: python scripts/convert_onemap.py

The script auto-detects common OneMap field name variants.
"""

import json, os, sys, math

SRC = os.path.join(os.path.dirname(__file__), '..', 'maldives_islands.geojson')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'islands.json')

if not os.path.exists(SRC):
    print(f'ERROR: {SRC} not found.')
    print('Download island GeoJSON from https://onemap.mv')
    print('and save as maldives_islands.geojson in the project root.')
    sys.exit(1)

with open(SRC) as f:
    geojson = json.load(f)

features = geojson.get('features', [])
print(f'GeoJSON loaded: {len(features)} features')

if features:
    print('Sample properties:', list(features[0]['properties'].keys()))

def pick(props, *candidates, default=''):
    """Return the first matching key from props, case-insensitive."""
    lower = {k.lower(): v for k, v in props.items()}
    for c in candidates:
        v = lower.get(c.lower())
        if v is not None:
            return v
    return default

def polygon_centroid(coords):
    """Centroid of a polygon ring (first ring of first polygon)."""
    if not coords:
        return 0.0, 0.0
    ring = coords[0] if isinstance(coords[0][0], list) else coords
    n = len(ring)
    if n == 0:
        return 0.0, 0.0
    lon = sum(c[0] for c in ring) / n
    lat = sum(c[1] for c in ring) / n
    return lat, lon

def polygon_area_km2(coords):
    """Approximate area using shoelace formula (degrees → km²)."""
    ring = coords[0] if isinstance(coords[0][0], list) else coords
    if len(ring) < 3:
        return 0.0
    n = len(ring)
    area = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += ring[i][0] * ring[j][1]
        area -= ring[j][0] * ring[i][1]
    area = abs(area) / 2.0
    # Convert degrees² to km² at ~4°N (Maldives latitude)
    lat_rad = math.radians(4.0)
    km_per_deg_lat = 111.32
    km_per_deg_lon = 111.32 * math.cos(lat_rad)
    return area * km_per_deg_lat * km_per_deg_lon

islands = []
skipped = 0

for i, feat in enumerate(features, 1):
    props = feat.get('properties', {})
    geom  = feat.get('geometry', {})

    if not geom or geom.get('type') not in ('Polygon', 'MultiPolygon'):
        skipped += 1
        continue

    # Extract coordinates
    coords = geom['coordinates']
    if geom['type'] == 'MultiPolygon':
        # Use largest polygon
        coords = max(coords, key=lambda c: len(c[0]))

    lat, lon = polygon_centroid(coords)
    area     = polygon_area_km2(coords)
    if area < 0.001:
        area = 0.001  # minimum 1000 m²

    # Field name detection — OneMap uses different names in different exports
    name  = str(pick(props,
        'island_name', 'IslandName', 'ISLAND_NAME', 'island', 'Island',
        'NAME_EN', 'name_en', 'Name', 'NAME', default=f'Island {i}'))
    atoll = str(pick(props,
        'atoll_name', 'AtollName', 'ATOLL_NAME', 'atoll', 'Atoll',
        'ATOLL_EN', 'atoll_en', default='Unknown'))
    pop   = int(float(pick(props,
        'population', 'Population', 'POP', 'pop_2022', 'census_pop', default=0)))

    # Elevation: use if available, else apply published Maldives stats
    mean_e = float(pick(props, 'mean_elev', 'mean_elevation', 'elev_mean', 'MEAN_ELEV', default=1.2))
    max_e  = float(pick(props, 'max_elev',  'max_elevation',  'elev_max',  'MAX_ELEV',  default=mean_e + 0.6))
    flt1   = float(pick(props, 'frac_lt1m', 'frac_below_1m',  'pct_lt1m',  default=0.72))

    # Clamp to realistic Maldivian ranges
    mean_e = max(0.3, min(3.5, mean_e))
    max_e  = max(mean_e + 0.2, min(5.0, max_e))
    flt1   = max(0.1, min(0.99, flt1))

    islands.append({
        'id':          i,
        'atoll':       atoll,
        'name':        name,
        'area_km2':    round(area, 4),
        'population':  pop,
        'mean_elev_m': round(mean_e, 2),
        'max_elev_m':  round(max_e, 2),
        'frac_lt1m':   round(flt1, 3),
        'lat':         round(lat, 6),
        'lon':         round(lon, 6),
    })

# Only keep inhabited islands (population > 0, or all if population not in data)
has_pop = any(i['population'] > 0 for i in islands)
if has_pop:
    islands = [i for i in islands if i['population'] > 0]
    print(f'Filtered to {len(islands)} inhabited islands (population > 0)')

with open(OUT, 'w') as f:
    json.dump(islands, f, indent=2)

print(f'✓ Wrote {len(islands)} islands to {OUT}')
if skipped:
    print(f'  ({skipped} features skipped — not Polygon/MultiPolygon)')
print()
print('Atoll breakdown:')
from collections import Counter
for atoll, count in sorted(Counter(i['atoll'] for i in islands).items()):
    print(f'  {atoll:30} {count} islands')
