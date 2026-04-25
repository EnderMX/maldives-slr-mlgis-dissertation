"""
convert_oni.py
Converts raw NOAA CPC ONI ascii file → data/oni.csv

Source: https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt
Save that file as data/oni_ascii.txt, then run:
    python scripts/convert_oni.py

Output format: date,oni
  date = first day of the centre month of each 3-month season
  oni  = 3-month rolling mean SST anomaly (°C)
"""

import os, sys

SRC = os.path.join(os.path.dirname(__file__), '..', 'data', 'oni_ascii.txt')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'oni.csv')

MONTH_MAP = {
    'DJF': 1, 'JFM': 2, 'FMA': 3, 'MAM': 4, 'AMJ': 5, 'MJJ': 6,
    'JJA': 7, 'JAS': 8, 'ASO': 9, 'SON': 10, 'OND': 11, 'NDJ': 12,
}

if not os.path.exists(SRC):
    print(f'ERROR: {SRC} not found.')
    print('Download from https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt')
    print('and save as data/oni_ascii.txt')
    sys.exit(1)

rows = ['date,oni']
skipped = 0

with open(SRC) as f:
    for line in f:
        parts = line.strip().split()
        # Expected format: SEAS  YR  TOTAL  ANOM
        if len(parts) < 4:
            continue
        seas, yr = parts[0], parts[1]
        try:
            yr   = int(yr)
            anom = float(parts[3])
        except ValueError:
            skipped += 1
            continue
        month = MONTH_MAP.get(seas)
        if not month:
            skipped += 1
            continue
        rows.append(f'{yr}-{str(month).zfill(2)}-01,{anom}')

with open(OUT, 'w') as f:
    f.write('\n'.join(rows))

print(f'Wrote {len(rows)-1} monthly ONI values to {OUT}')
if skipped:
    print(f'  (skipped {skipped} unrecognised lines)')
