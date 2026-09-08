from pathlib import Path
import json


root = Path("/opt/opendesign/runtime/daemon/node_modules/.pnpm/image-size@1.2.1/node_modules/image-size")

icns = root / "dist/types/icns.js"
text = icns.read_text()
first = """        let imageHeader = readImageHeader(input, imageOffset);
        let imageSize = getImageSize(imageHeader[0]);
        imageOffset += imageHeader[1];"""
replacement = """        let imageHeader = readImageHeader(input, imageOffset);
        if (imageHeader[1] < SIZE_HEADER)
            throw new TypeError('Invalid ICNS image entry length');
        let imageSize = getImageSize(imageHeader[0]);
        imageOffset += imageHeader[1];"""
assert text.count(first) == 1
text = text.replace(first, replacement)
loop = """            imageHeader = readImageHeader(input, imageOffset);
            imageSize = getImageSize(imageHeader[0]);
            imageOffset += imageHeader[1];"""
loop_replacement = """            imageHeader = readImageHeader(input, imageOffset);
            if (imageHeader[1] < SIZE_HEADER)
                throw new TypeError('Invalid ICNS image entry length');
            imageSize = getImageSize(imageHeader[0]);
            imageOffset += imageHeader[1];"""
assert text.count(loop) == 1
icns.write_text(text.replace(loop, loop_replacement))

jxl = root / "dist/types/jxl.js"
text = jxl.read_text()
needle = """        if (!jxlpBox)
            break;
        partialStreams.push(input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size));"""
replacement = """        if (!jxlpBox)
            break;
        if (jxlpBox.size < 12)
            throw new TypeError('Invalid JPEG XL partial codestream box size');
        partialStreams.push(input.slice(jxlpBox.offset + 12, jxlpBox.offset + jxlpBox.size));"""
assert text.count(needle) == 1
jxl.write_text(text.replace(needle, replacement))

package_json = root / "package.json"
package = json.loads(package_json.read_text())
assert package["name"] == "image-size" and package["version"] == "1.2.1"
package["name"] = "image-size-alpon"
package["version"] = "1.2.2-alpon.1"
package_json.write_text(json.dumps(package, indent=2) + "\n")

test = Path("/tmp/remediate-runtime.py.test.cjs")
test.write_text(
    """const imageSize = require('/opt/opendesign/runtime/daemon/node_modules/.pnpm/image-size@1.2.1/node_modules/image-size');
const icns = Buffer.alloc(16);
icns.write('icns', 0); icns.writeUInt32BE(16, 4); icns.write('ic07', 8); icns.writeUInt32BE(0, 12);
try { imageSize(icns); throw new Error('malformed ICNS accepted'); } catch (error) {
  if (error.message === 'malformed ICNS accepted') throw error;
}
const jxl = Buffer.alloc(32);
jxl.writeUInt32BE(12, 0); jxl.write('JXL ', 4);
jxl.writeUInt32BE(12, 12); jxl.write('ftyp', 16); jxl.write('jxl ', 20);
jxl.writeUInt32BE(0, 24); jxl.write('jxlp', 28);
try { imageSize(jxl); throw new Error('malformed JXL accepted'); } catch (error) {
  if (error.message === 'malformed JXL accepted') throw error;
}
console.log('image-size malformed input guards=ok');
"""
)
