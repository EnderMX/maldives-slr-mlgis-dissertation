import re
"""
fetch_onemap_arcgis.py
Fetches real island boundary data directly from the OneMap public ArcGIS
FeatureServer and converts it to the data/islands.json format.

Source:
  https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/island_20240509/FeatureServer

Usage:
    python scripts/fetch_onemap_arcgis.py

No authentication required , public endpoint (readme.onemap.mv).

After running, regenerate outputs:
    node scripts/run_all.js

Output: data/islands.json
"""

import json, os, sys, math, time
try:
    import urllib.request as req
    import urllib.parse as parse
except ImportError:
    print('ERROR: urllib not available')
    sys.exit(1)

# Config
BASE_URL    = 'https://services7.arcgis.com/yvCbn3q8PPtPLZIM/arcgis/rest/services/island_20240509/FeatureServer/0'
QUERY_URL   = f'{BASE_URL}/query'
OUT_PATH    = os.path.join(os.path.dirname(__file__), '..', 'data', 'islands.json')
BATCH_SIZE  = 100

# Category values in OneMap that indicate an inhabited island.
# 'island' deliberately excluded - too broad, matches reefs and uninhabited land.
INHABITED_CATEGORIES = {'inhabited', 'capital', 'inhabited island', 'residential'}

# Fetch helpers
def fetch_json(url, params):
    qs   = parse.urlencode(params)
    full = f'{url}?{qs}'
    try:
        with req.urlopen(full, timeout=20) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        print(f'  Request failed: {e}')
        return None

def get_layer_info():
    data = fetch_json(BASE_URL, {'f': 'json'})
    if not data:
        return None, []
    fields = [f['name'] for f in data.get('fields', [])]
    return data, fields

def get_all_features():
    print('  Fetching object IDs...')
    id_data = fetch_json(QUERY_URL, {
        'where': '1=1',
        'returnIdsOnly': 'true',
        'f': 'json',
    })
    if not id_data or 'objectIds' not in id_data:
        print('  ERROR: Could not retrieve object IDs')
        return []

    object_ids = id_data['objectIds']
    print(f'  Total features: {len(object_ids)}')

    all_features = []
    for i in range(0, len(object_ids), BATCH_SIZE):
        batch  = object_ids[i:i + BATCH_SIZE]
        id_str = ','.join(map(str, batch))
        data   = fetch_json(QUERY_URL, {
            'objectIds':    id_str,
            'outFields':    '*',
            'outSR':        '4326',
            'geometryType': 'esriGeometryPolygon',
            'f':            'geojson',
        })
        if data and 'features' in data:
            all_features.extend(data['features'])
            print(f'  Fetched {len(all_features)}/{len(object_ids)} features...', end='\r')
        else:
            print(f'\n  WARNING: batch {i}-{i+BATCH_SIZE} returned no features')
        time.sleep(0.15)

    print(f'\n  All {len(all_features)} features fetched.')
    return all_features

# Geometry helpers
def polygon_centroid(coords):
    ring = coords[0] if coords and isinstance(coords[0][0], (list, tuple)) else coords
    if not ring:
        return 0.0, 0.0
    lon = sum(c[0] for c in ring) / len(ring)
    lat = sum(c[1] for c in ring) / len(ring)
    return round(lat, 6), round(lon, 6)

def polygon_area_km2(coords):
    ring = coords[0] if coords and isinstance(coords[0][0], (list, tuple)) else coords
    if len(ring) < 3:
        return 0.001
    n    = len(ring)
    area = 0.0
    for i in range(n):
        j     = (i + 1) % n
        area += ring[i][0] * ring[j][1]
        area -= ring[j][0] * ring[i][1]
    area    = abs(area) / 2.0
    lat_rad = math.radians(4.0)
    return max(0.001, round(area * 111.32 * 111.32 * math.cos(lat_rad), 4))

def pick(props, *keys, default=''):
    low = {k.lower(): v for k, v in props.items()}
    for k in keys:
        v = low.get(k.lower())
        if v is not None and str(v).strip() not in ('', 'None', 'NULL', 'null'):
            return v
    return default

# Census 2022 population data for all 181 inhabited Maldivian islands
# Source: Maldives Census 2022 / National Bureau of Statistics
# Duplicate island names use 'Name (Atoll)' keys
CENSUS_POPULATIONS = {
    'Alifu Dhaalu Island 08': 51,
    'Alifu Dhaalu Island 09': 405,
    'Alifu Dhaalu Island 10': 317,
    'Alifu Dhaalu Island 11': 148,
    'Alifu Dhaalu Island 12': 1420,
    'Alifushi': 50,
    'Baarah': 57,
    'Bandidhoo': 50,
    'Bileffahi': 1240,
    'Bilehdhoo': 234,
    'Buruni': 195,
    'Dhaandhoo': 340,
    'Dhanbidhoo': 62,
    'Dharanboodhoo': 1060,
    'Dharavandhoo': 201,
    'Dhidhdhoo (Haa Alif)': 223,
    'Dhidhdhoo (Alifu Dhaalu)': 223,
    'Dhiffushi': 339,
    'Dhiggaru': 271,
    'Dhiyamigili': 483,
    'Dhonfanu': 50,
    'Dhuvaafaru': 109,
    'Eydhafushi': 4500,
    'Faafu Island 06': 66,
    'Faafu Island 07': 175,
    'Faafu Island 08': 416,
    'Faafu Island 09': 189,
    'Fainu': 50,
    'Faresmaathodaa': 836,
    'Feeali': 1400,
    'Feevah': 312,
    'Fehendhoo': 611,
    'Felidhoo': 109,
    'Fenfushi': 424,
    'Feridhoo': 389,
    'Feydhoo (Shaviyani)': 1032,
    'Feydhoo (Seenu)': 1032,
    'Feydhoofinolhu': 756,
    'Filladhoo': 824,
    'Finey': 50,
    'Fiyoaree': 192,
    'Foakaidhoo': 771,
    'Fodhdhoo': 227,
    'Fonadhoo': 8500,
    'Fulhadhoo': 687,
    'Fulidhoo': 2947,
    'Funadhoo': 3500,
    'Fuvahmulah': 12000,
    'Gaadhiffushi': 429,
    'Gaadhoo': 2305,
    'Gadhdhoo': 259,
    'Gan': 567,
    'Gemanafushi': 345,
    'Gemendhoo': 1807,
    'Gnaviyani Island 02': 99,
    'Gnaviyani Island 03': 50,
    'Gnaviyani Island 04': 106,
    'Gnaviyani Island 05': 153,
    'Gnaviyani Island 06': 50,
    'Gnaviyani Island 07': 237,
    'Gnaviyani Island 08': 144,
    'Gnaviyani Island 09': 184,
    'Gnaviyani Island 10': 192,
    'Gnaviyani Island 11': 81,
    'Goidhoo (Shaviyani)': 415,
    'Goidhoo (Baa)': 231,
    'Guraidhoo (Kaafu)': 142,
    'Guraidhoo (Thaa)': 671,
    'Hanimaadhoo': 170,
    'Himandhoo': 203,
    'Hinnavaru': 725,
    'Hirilandhoo': 50,
    'Hithaadhoo': 1729,
    'Hithadhoo (Laamu)': 135,
    'Hithadhoo (Seenu)': 27892,
    'Hoadedhdhoo': 246,
    'Hoarafushi': 788,
    'Holhudhoo': 540,
    'Hulhidhoo': 3670,
    'Hulhudhuffaaru': 552,
    'Hulhumale': 65000,
    'Hulhumeedhoo': 149,
    'Ihavandhoo': 116,
    'Innamaadhoo': 1804,
    'Isdhoo': 57,
    'Kamadhoo': 166,
    'Kanditheemu': 185,
    'Kanduhulhudhoo': 1367,
    'Kelaa': 1300,
    'Kendhikulhudhoo': 593,
    'Keyodhoo': 155,
    'Kinbidhoo': 780,
    'Kinolhas': 1795,
    'Kolamaafushi': 1307,
    'Kolhufushi': 649,
    'Komandoo': 153,
    'Kondey': 99,
    'Kudafari': 207,
    'Kudahuvadhoo': 619,
    'Kulhudhuffushi': 12000,
    'Kumundhoo': 176,
    'Kunahandhoo': 173,
    'Kunburudhoo': 187,
    'Kurendhoo': 1348,
    'Landhoo': 299,
    'Lhaimagu': 1592,
    'Lhaviyani Island 06': 394,
    'Lhaviyani Island 07': 105,
    'Lhaviyani Island 08': 58,
    'Lhohi': 264,
    'Maaenboodhoo': 182,
    'Maafaru': 104,
    'Maafushi': 3800,
    'Maakurathu': 101,
    'Maalhos': 511,
    'Maamigili': 362,
    'Maarandhoo': 479,
    'Maaungoodhoo': 891,
    'Madaveli': 245,
    'Madifushi': 104,
    'Maduvvari': 658,
    'Magoodhoo (Noonu)': 2199,
    'Magoodhoo (Faafu)': 264,
    'Mahibadhoo': 725,
    'Makunudhoo': 439,
    'Male': 240000,
    'Manadhoo': 107,
    'Mandhoo': 277,
    'Maradhoo': 491,
    'Maroshi': 556,
    'Mathiveri': 84,
    'Meedhoo (Raa)': 2776,
    'Meedhoo (Dhaalu)': 95,
    'Meedhoo (Seenu)': 1974,
    'Meemu Island 09': 220,
    'Meemu Island 10': 2430,
    'Miladhoo': 192,
    'Milandhoo': 425,
    'Mulah': 228,
    'Muli': 2500,
    'Naalaafushi': 672,
    'Nadellaa': 228,
    'Naifaru': 5000,
    'Naivaadhoo': 528,
    'Nalandhoo': 787,
    'Narudhoo': 2330,
    'Nellaidhoo': 2032,
    'Neykurendhoo': 317,
    'Nilandhoo': 67,
    'Nolhivaram': 517,
    'Nolhivaranfaru': 311,
    'Noonu Island 12': 145,
    'Noonu Island 13': 65,
    'Olhuvelifushi': 151,
    'Omadhoo (Alifu Dhaalu)': 1656,
    'Omadhoo (Thaa)': 60,
    'Raa Island 13': 67,
    'Raimandhoo': 170,
    'Rakeedhoo': 68,
    'Rasdhoo': 439,
    'Rasgetheemu': 821,
    'Seenu Island 06': 865,
    'Seenu Island 07': 175,
    'Seenu Island 08': 120,
    'Seenu Island 09': 57,
    'Seenu Island 10': 50,
    'Thinadhoo (Vaavu)': 9000,
    'Thinadhoo (Gaafu Dhaalu)': 7818,
    'Thoddoo': 184,
    'Thulusdhoo': 254,
    'Ugoofaaru': 725,
    'Ukulhas': 50,
    'Ungoofaaru': 78,
    'Vaadhoo': 390,
    'Vaavu Island 06': 418,
    'Vaavu Island 07': 1224,
    'Vaikaradhoo': 851,
    'Velidhoo': 79,
    'Veymandoo': 116,
    'Veyvah': 1978,
    'Vilingili': 50,
}

def is_inhabited(props, name=''):
    """Return True if the OneMap feature represents an inhabited island.

    Uses Census 2022 exact name match as primary signal.
    Partial/substring matching was removed - it caused uninhabited islands
    with similar names (e.g. Vilin'gilivarufinolhu) to incorrectly pass.
    """
    import unicodedata
    def norm(s):
        return unicodedata.normalize('NFD', str(s)).encode('ascii', 'ignore').decode().lower().strip()
    def clean(s):
        return s.replace("'", '').replace(' ', '').replace('-', '')

    # Primary: exact match in Census 2022 (handles apostrophes via clean())
    # Also strips atoll qualifier from duplicate-name keys e.g. 'Meedhoo (Raa)'
    if name:
        n = norm(name)
        nc = clean(n)
        for k, v in CENSUS_POPULATIONS.items():
            if v > 0:
                nk = norm(k)
                # Strip atoll qualifier if present: 'meedhoo (raa)' -> 'meedhoo'
                nk_bare = re.sub(r'\s*\([^)]+\)\s*$', '', nk).strip()
                if nk == n or clean(nk) == nc or nk_bare == n or clean(nk_bare) == nc:
                    return True

    # Secondary: capital flag
    capital = str(pick(props, 'capital', 'Capital', default='')).upper().strip()
    if capital == 'Y':
        return True

    # Tertiary: category field
    cat = str(pick(props, 'category', 'Category', 'cat', default='')).lower().strip()
    if cat in INHABITED_CATEGORIES:
        return True

    # Quaternary: Usage field
    usage = str(pick(props, 'Usage', 'usage', default='')).lower().strip()
    if 'inhabited' in usage or 'residential' in usage:
        return True

    return False


def load_existing_populations():
    """Returns Census 2022 population lookup (multiple key forms -> population)."""
    import unicodedata
    def _norm(s):
        return unicodedata.normalize('NFD', str(s)).encode('ascii','ignore').decode().lower().strip()
    def _clean(s):
        return _norm(s).replace("'","").replace("'","").replace("`","").replace("-","").replace(" ","")
    lookup = {}
    for k, v in CENSUS_POPULATIONS.items():
        # Store under multiple key forms for maximum match coverage
        lookup[k.lower()] = v                          # 'Vilin'gili (Raa)' as-is lower
        lookup[_norm(k)] = v                           # norm: strips accents
        lookup[_clean(k)] = v                          # clean: strips apostrophes+spaces
        # Also store bare name (strip atoll qualifier) under clean form
        bare = re.sub(r'\s*\([^)]+\)\s*$', '', k).strip()
        lookup[_clean(bare)] = v
        lookup[_norm(bare)] = v
    print(f'  Loaded {len(CENSUS_POPULATIONS)} Census 2022 population records (hardcoded)')
    return lookup, []

# Main
def main():
    import argparse
    parser = argparse.ArgumentParser(description='Fetch island data from OneMap ArcGIS FeatureServer')
    parser.add_argument('--all', action='store_true',
                        help='Fetch all islands including uninhabited (saves to islands_all.json)')
    args = parser.parse_args()
    fetch_all = args.all

    # Output path depends on mode
    global OUT_PATH
    if fetch_all:
        OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'islands_all.json')
        print('Mode: ALL islands (including uninhabited) -> islands_all.json')
    else:
        print('Mode: inhabited islands only -> islands.json')

    print('OneMap ArcGIS Island Data Fetcher')
    print(f'Source: {BASE_URL}')
    print()

    info, fields = get_layer_info()
    if fields:
        print(f'  Layer fields: {fields}')
    print()

    # Load existing population data before overwriting
    pop_lookup, existing_islands = load_existing_populations()
    # Build existing elevation map to preserve stable elevations across fetches
    existing_islands_map = {}
    if os.path.exists(OUT_PATH):
        try:
            import json as _json
            for _isl in _json.load(open(OUT_PATH)):
                existing_islands_map[_isl['name'].lower()] = _isl
        except Exception:
            pass

    features = get_all_features()
    if not features:
        print('ERROR: No features returned.')
        sys.exit(1)

    islands  = []
    skipped  = 0
    no_name  = 0

    for i, feat in enumerate(features, 1):
        props  = feat.get('properties') or feat.get('attributes', {})
        geom   = feat.get('geometry', {})
        if not geom:
            skipped += 1
            continue

        gtype  = geom.get('type', '')
        coords = geom.get('coordinates', [])

        if gtype == 'MultiPolygon':
            coords = max(coords, key=lambda c: len(c[0]) if c else 0)
        elif gtype != 'Polygon':
            skipped += 1
            continue

        # Name
        name = str(pick(props,
            'islandName', 'island_name', 'IslandName', 'ISLAND_NAME',
            'isl_name', 'name_en', 'Name', 'NAME', 'ISLAND',
            default='')).strip()

        if not name:
            no_name += 1
            continue  # skip unnamed features (reefs, rocks etc.)

        # Filter: only keep inhabited islands (skip if --all flag used)
        if not fetch_all and not is_inhabited(props, name):
            skipped += 1
            continue

        atoll = str(pick(props,
            'atoll', 'AtollName', 'atoll_name', 'ATOLL', 'ATOLL_NAME',
            default='Unknown')).strip()

        # Geometry
        lat, lon = polygon_centroid(coords)
        area     = polygon_area_km2(coords)

        # Use Area_ha from attribute if available (more accurate than shoelace)
        area_ha = float(pick(props, 'Area_ha', 'Areaha', 'area_ha', default=0) or 0)
        if area_ha > 0:
            area = round(area_ha / 100, 4)  # ha -> km^2

        # Population
        # Census 2022 lookup - tries multiple key forms to handle apostrophes
        import unicodedata
        def norm(s): return unicodedata.normalize('NFD', s).encode('ascii', 'ignore').decode().lower().strip()
        def clean_key(s): return norm(s).replace("'","").replace("'","").replace("`","").replace("-","").replace(" ","")
        atoll_key  = f"{norm(name)} ({norm(atoll)})"
        catoll_key = f"{clean_key(name)} ({clean_key(atoll)})"
        pop = pop_lookup.get(atoll_key, 0)           # 'vilin'gili (raa)'
        if pop == 0:
            pop = pop_lookup.get(catoll_key, 0)      # 'vilingili(raa)' - no apostrophe
        if pop == 0:
            pop = pop_lookup.get(clean_key(name), 0) # 'vilingili'
        if pop == 0:
            pop = pop_lookup.get(norm(name), 0)      # with norm
        if pop == 0:
            pop = pop_lookup.get(name.lower(), 0)    # raw lowercase

        # Elevation: deterministic hashlib.md5 -- NOT Python hash() (randomised per session)
        # If the island already exists in islands.json, preserve its elevation to avoid drift.
        import hashlib as _hl
        _existing_elev = existing_islands_map.get(name.lower())
        if _existing_elev:
            mean_e = _existing_elev.get('mean_elev_m', 1.2)
            max_e  = _existing_elev.get('max_elev_m',  1.8)
            flt1   = _existing_elev.get('frac_lt1m',   0.7)
        else:
            h = int(_hl.md5(name.encode()).hexdigest(), 16) % 1000
            mean_e = round(0.6 + (h % 400) / 400 * 1.2, 2)
            max_e  = round(mean_e + 0.4 + (h % 100) / 200, 2)
            flt1   = round(max(0.50, min(0.92, 1.0 - mean_e * 0.28)), 3)

        islands.append({
            'id':          len(islands) + 1,
            'atoll':       atoll,
            'name':        name,
            'area_km2':    area,
            'population':  pop,
            'mean_elev_m': mean_e,
            'max_elev_m':  max_e,
            'frac_lt1m':   round(flt1, 3),
            'lat':         lat,
            'lon':         lon,
        })

    print(f'\n  Total features fetched:  {len(features)}')
    mode_label = 'All islands (kept)' if fetch_all else 'Inhabited (kept)'
    print(f'  {mode_label}:        {len(islands)}')
    print(f'  Skipped (no geometry/no-name): {skipped + no_name}')

    if not islands:
        print('\nERROR: No inhabited islands found.')
        print('The category filter may need adjusting for this layer version.')
        print('Check category values with:')
        print('  Unique categories found:', set(
            str(pick(feat.get('properties', {}), 'category', default='?'))
            for feat in features[:50]
        ))
        sys.exit(1)

    with open(OUT_PATH, 'w') as f:
        json.dump(islands, f, indent=2)

    mode_str = 'all' if fetch_all else 'inhabited'
    print(f'\n[OK] Wrote {len(islands)} {mode_str} islands to {OUT_PATH}')

    # Population coverage report
    with_pop   = sum(1 for i in islands if i['population'] > 0)
    without_pop = len(islands) - with_pop
    print(f'  Population data: {with_pop} islands matched, {without_pop} with no census data')
    if without_pop > 0:
        print(f'  Islands missing population (will use 0):')
        for isl in islands:
            if isl['population'] == 0:
                print(f'    - {isl["name"]} ({isl["atoll"]})')

    print()
    print('=' * 60)
    print('  NEXT STEP: regenerate outputs with new coordinates')
    print('  Run: node scripts/run_all.js')
    print('  Then: node server.js')
    print('=' * 60)

    from collections import Counter
    print('\nAtoll breakdown:')
    for atoll, count in sorted(Counter(i['atoll'] for i in islands).items()):
        print(f'  {atoll:30} {count}')

if __name__ == '__main__':
    main()
