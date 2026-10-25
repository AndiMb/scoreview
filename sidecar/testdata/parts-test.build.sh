#!/bin/sh
# Builds parts-test.mscz (see README.md): MusicXML -> MuseScore -> section
# break -> stored parts made by MuseScore itself -> saved again by MuseScore.
# Needs MuseScore 4.7 (desktop) as MS, e.g.
#   MS="/c/Program Files/MuseScore 4/bin/MuseScore4.exe" sh parts-test.build.sh
set -e
: "${MS:?set MS to the MuseScore 4 executable}"
cd "$(dirname "$0")"
work=$(mktemp -d)
python parts-test.gen.py "$work/parts-test.musicxml"
"$MS" "$work/parts-test.musicxml" -o "$work/step1.mscz"
# A section break into the 12th measure: MusicXML has no way to say it.
python - "$work" <<'PY'
import re, sys, zipfile
work = sys.argv[1]
src = zipfile.ZipFile(f'{work}/step1.mscz')
name = [n for n in src.namelist() if n.endswith('.mscx') and '/' not in n][0]
x = src.read(name).decode('utf-8')
starts = [m.start() for m in re.finditer(r'\n      <Measure>', x)]
pos = x.index('\n', x.index('<eid>', starts[11]))
x = x[:pos] + '\n        <LayoutBreak>\n          <subtype>section</subtype>\n          </LayoutBreak>' + x[pos:]
out = zipfile.ZipFile(f'{work}/step2.mscz', 'w', zipfile.ZIP_DEFLATED)
for i in src.infolist():
    out.writestr(i, x if i.filename == name else src.read(i.filename))
out.close()
PY
"$MS" "$work/step2.mscz" -o "$work/step3.mscz"
# Two runs: MuseScore gives the parts new EIDs each time, so the merged
# two-part excerpt can take its parts from a run of its own.
"$MS" --score-parts "$work/step3.mscz" > "$work/run1.json"
"$MS" --score-parts "$work/step3.mscz" > "$work/run2.json"
python parts-test.assemble.py "$work/step3.mscz" "$work/run1.json" "$work/run2.json" "$work/step4.mscz"
"$MS" "$work/step4.mscz" -o parts-test.mscz
rm -rf "$work"
echo "parts-test.mscz written - copy it to scoreview/converter/ as well"
