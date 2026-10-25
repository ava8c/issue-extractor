function luminance(rgb: number[]) {
  const linear = rgb
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}
export function labelColors(value: string) {
  const hex = /^[a-f\d]{6}$/i.test(value) ? value : '64748b'
  let foreground = [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
  const background = foreground.map((value) => Math.round(255 * 0.92 + value * 0.08))
  while ((luminance(background) + 0.05) / (luminance(foreground) + 0.05) < 4.5)
    foreground = foreground.map((value) => Math.floor(value * 0.94))
  return { color: `rgb(${foreground.join(', ')})`, background: `rgb(${background.join(', ')})` }
}
