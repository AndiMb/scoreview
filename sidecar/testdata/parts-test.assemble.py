# Puts MuseScore-generated parts into the master as stored excerpts
# (step of parts-test.build.sh):
# "Sopran" (one part) and "Frauenstimmen" (Sopran + Alt, merged from a
# second --score-parts run so that no EID occurs twice).
import base64, io, json, re, sys, zipfile
master, run1, run2, out = sys.argv[1:5]

def parts(path):
    d = json.load(open(path, encoding='utf-8'))
    res = {}
    for name, b in zip(d['parts'], d['partsBin']):
        z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b)))
        mscx = [n for n in z.namelist() if n.endswith('.mscx')][0]
        res[name] = (z.read(mscx).decode('utf-8'), z.read('score_style.mss').decode('utf-8'))
    return res

def block(x, start_re, end_tag):
    m = re.search(start_re, x)
    end = x.index(end_tag, m.start()) + len(end_tag)
    return m.start(), end

p1, p2 = parts(run1), parts(run2)
sop_x, sop_s = p1['Sopran']
fs_x, fs_s = p2['Sopran']
alt_x, _ = p2['Alt']

# Part block of Alt (4-space indent) and its top-level staff, renumbered to 2.
a0, a1 = block(alt_x, r'\n    <Part id="\d+">', '\n      </Part>')
alt_part = alt_x[a0:a1]
s0, s1 = block(alt_x, r'\n    <Staff id="1">', '\n      </Staff>')
alt_staff = alt_x[s0:s1].replace('<Staff id="1">', '<Staff id="2">', 1)
# System objects (tempo, voltas) belong to the first staff only; the Alt
# part brought its own copies, which would be drawn a second time.
alt_staff = re.sub(r'\n *<Tempo>.*?</Tempo>', '', alt_staff, flags=re.S)
alt_staff = re.sub(r'\n *<Spanner type="Volta">.*?</Spanner>', '', alt_staff, flags=re.S)

f0, f1 = block(fs_x, r'\n    <Part id="\d+">', '\n      </Part>')
fs_x = fs_x[:f1] + alt_part + fs_x[f1:]
t0, t1 = block(fs_x, r'\n    <Staff id="1">', '\n      </Staff>')
fs_x = fs_x[:t1] + alt_staff + fs_x[t1:]
fs_x = fs_x.replace('<name>Sopran</name>', '<name>Frauenstimmen</name>', 1)
fs_x = re.sub(r'(<style>instrument_excerpt</style>\s*<text>)Sopran(</text>)', r'\g<1>Frauenstimmen\g<2>', fs_x, count=1)
fs_x = fs_x.replace('<metaTag name="partName">Sopran</metaTag>', '<metaTag name="partName">Frauenstimmen</metaTag>', 1)

zin = zipfile.ZipFile(master)
zout = zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED)
for item in zin.infolist():
    zout.writestr(item, zin.read(item.filename))
for name, x, s in [('Sopran', sop_x, sop_s), ('Frauenstimmen', fs_x, fs_s)]:
    zout.writestr(f'Excerpts/{name}/{name}.mscx', x)
    zout.writestr(f'Excerpts/{name}/{name}.mss', s)
zout.close()
print('written', out)
