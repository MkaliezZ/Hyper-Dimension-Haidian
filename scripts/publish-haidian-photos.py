"""Publish reviewed official Haidian photos, preserving original JPEG bytes.

Default: verify installed assets and rebuild the UW-compatible manifest offline.
--cache DIR: import reviewed downloads; --download: restore the pinned originals.
No image generation, cropping, re-encoding, or campus-geometry changes.
"""
import argparse, hashlib, json, pathlib, struct, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'public'
REGISTRY = ROOT / 'data/haidian-place-photos.json'


def jpeg_size(raw):
    if raw[:2] != b'\xff\xd8':
        raise ValueError('Not a JPEG')
    i = 2
    while i < len(raw):
        if raw[i] != 255:
            raise ValueError('Invalid JPEG segment')
        while raw[i] == 255:
            i += 1
        marker = raw[i]
        i += 1
        if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
            continue
        length = struct.unpack('>H', raw[i:i+2])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack('>HH', raw[i+3:i+7])
            return width, height
        i += length
    raise ValueError('Missing JPEG dimensions')


def publish(cache=None, download=False):
    registry = json.loads(REGISTRY.read_text(encoding='utf-8'))
    collection = registry['collection']
    photos = {photo['id']: photo for photo in registry['photos']}
    for photo in photos.values():
        target = PUBLIC / photo['path'].lstrip('/')
        if cache:
            raw = (cache / photo['cacheFile']).read_bytes()
        elif download:
            req = urllib.request.Request(photo['original'], headers={
                'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.720yun.com/'})
            with urllib.request.urlopen(req, timeout=45) as response:
                raw = response.read()
        else:
            raw = target.read_bytes()
        if hashlib.sha256(raw).hexdigest() != photo['sha256']:
            raise ValueError('Source changed; review before publishing: '+photo['id'])
        if jpeg_size(raw) != (photo['width'], photo['height']):
            raise ValueError('Dimensions changed: '+photo['id'])
        if cache or download:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)

    manifest = {}
    for place_id, match in registry['places'].items():
        if match.get('status') == 'unavailable':
            manifest[place_id] = {'status': 'unavailable', 'subject': match['subject'],
                                  'note': match['reason']}
            continue
        photo = photos[match['photoId']]
        manifest[place_id] = {
            'subject': match['subject'], 'path': photo['path'],
            'viewLabel': match['viewLabel'], 'source': photo['source'],
            'original': photo['original'], 'downloadedFrom': photo['original'],
            'creditLabel': '发布', 'author': collection['credit'],
            'license': collection['rights'], 'licenseUrl': photo['source'],
            'date': None, 'retrievedAt': registry['retrievedAt'],
            'width': photo['width'], 'height': photo['height'],
            'sha256': photo['sha256'], 'adaptation': collection['adaptation'],
            'title': photo['sceneName'], 'sceneId': photo['sceneId'],
            'face': photo['face'], 'match': match['match'],
        }
    destination = PUBLIC / 'assets/place-photos/manifest.json'
    destination.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps({'status': 'PASS', 'photographedPlaces': sum('path' in p for p in manifest.values()),
                      'unmatchedPlaces': sum(p.get('status') == 'unavailable' for p in manifest.values()),
                      'originalImages': len(photos), 'offline': not download}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--cache', type=pathlib.Path)
    group.add_argument('--download', action='store_true')
    args = parser.parse_args()
    publish(args.cache, args.download)
