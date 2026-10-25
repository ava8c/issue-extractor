import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
await mkdir('build/icon.iconset', { recursive: true })
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    await sharp('public/icon.svg', { density: 300 })
      .resize(size * scale, size * scale)
      .png()
      .toFile(`build/icon.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`)
  }
}
execFileSync('iconutil', ['-c', 'icns', 'build/icon.iconset', '-o', 'build/icon.icns'])
