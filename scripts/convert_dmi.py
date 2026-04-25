"""
convert_dmi.py
Converts raw NOAA PSL DMI long data file → data/dmi.csv

Source: https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data
Save that file as data/dmi_had_long.data, then run:
    python scripts/convert_dmi.py

Output format: date,dmi
  date = first day of month
  dmi  = Dipole Mode Index (°C)
"""

import os, sys

SRC = os.path.join(os.path.dirname(__file__), '..', 'data', 'dmi_had_long.data')
OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'dmi.csv')

if not os.path.exists(SRC):
    print(f'ERROR: {SRC} not found.')
    print('Download from https://psl.noaa.gov/gcos_wgsp/Timeseries/Data/dmi.had.long.data')
    print('and save as data/dmi_had_long.data')
    sys.exit(1)

rows = ['date,dmi']
written = 0
MISSING = -999.0  # NOAA missing value flag

with open(SRC) as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        try:
            year = int(parts[0])
        except ValueError:
            continue
        # Format A: one value per row with month as second column
        if len(parts) == 2:
            try:
                val = float(parts[1])
            except ValueError:
                continue
            # Skip — need month info, handle below
            continue
        # Format B: year followed by 12 monthly values
        if len(parts) == 13:
            for m, v in enumerate(parts[1:], 1):
                try:
                    val = float(v)
                except ValueError:
                    continue
                if abs(val - MISSING) < 1:
                    continue
                rows.append(f'{year}-{str(m).zfill(2)}-01,{val:.4f}')
                written += 1
        # Format C: year, month, value
        elif len(parts) == 3:
            try:
                month = int(parts[1])
                val   = float(parts[2])
            except ValueError:
                continue
            if abs(val - MISSING) < 1:
                continue
            rows.append(f'{year}-{str(month).zfill(2)}-01,{val:.4f}')
            written += 1

with open(OUT, 'w') as f:
    f.write('\n'.join(rows))

print(f'Wrote {written} monthly DMI values to {OUT}')
