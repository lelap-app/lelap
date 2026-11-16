// iOS only shows an apple-touch-startup-image whose media query matches the device exactly, so
// each screen size needs its own image. Sizes are portrait CSS pixels; add new devices here and
// rerun `pnpm --filter @lelap/site icons`.
interface Screen {
  width: number;
  height: number;
  ratio: number;
  devices: string;
}

const screens: readonly Screen[] = [
  { width: 440, height: 956, ratio: 3, devices: 'iPhone 16 Pro Max, 17 Pro Max' },
  { width: 430, height: 932, ratio: 3, devices: 'iPhone 14 Pro Max to 16 Plus' },
  { width: 428, height: 926, ratio: 3, devices: 'iPhone 12 Pro Max to 14 Plus' },
  { width: 420, height: 912, ratio: 3, devices: 'iPhone Air' },
  { width: 414, height: 896, ratio: 3, devices: 'iPhone XS Max, 11 Pro Max' },
  { width: 414, height: 896, ratio: 2, devices: 'iPhone XR, 11' },
  { width: 414, height: 736, ratio: 3, devices: 'iPhone 6s Plus to 8 Plus' },
  { width: 402, height: 874, ratio: 3, devices: 'iPhone 16 Pro, 17, 17 Pro' },
  { width: 393, height: 852, ratio: 3, devices: 'iPhone 14 Pro to 16' },
  { width: 390, height: 844, ratio: 3, devices: 'iPhone 12 to 14' },
  { width: 375, height: 812, ratio: 3, devices: 'iPhone X to 13 mini' },
  { width: 375, height: 667, ratio: 2, devices: 'iPhone 8, SE' },
  { width: 1032, height: 1376, ratio: 2, devices: 'iPad Pro 13" (M4)' },
  { width: 1024, height: 1366, ratio: 2, devices: 'iPad Pro 12.9", iPad Air 13"' },
  { width: 834, height: 1210, ratio: 2, devices: 'iPad Pro 11" (M4)' },
  { width: 834, height: 1194, ratio: 2, devices: 'iPad Pro 11"' },
  { width: 820, height: 1180, ratio: 2, devices: 'iPad Air 10.9", iPad 10.9"' },
  { width: 810, height: 1080, ratio: 2, devices: 'iPad 10.2"' },
  { width: 744, height: 1133, ratio: 2, devices: 'iPad mini 8.3"' },
];

export interface SplashImage {
  href: string;
  media: string;
  pixelWidth: number;
  pixelHeight: number;
}

export const splashImages: readonly SplashImage[] = screens.flatMap(({ width, height, ratio }) =>
  (['portrait', 'landscape'] as const).map((orientation) => {
    const portrait = orientation === 'portrait';
    const pixelWidth = (portrait ? width : height) * ratio;
    const pixelHeight = (portrait ? height : width) * ratio;
    return {
      href: `/splash/apple-splash-${pixelWidth}x${pixelHeight}.png`,
      media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`,
      pixelWidth,
      pixelHeight,
    };
  }),
);
