// Asks Shopify's CDN for a square image of the given size (pixels). Strips any
// size suffix baked into the file name (e.g. "_80x80.jpg").
export function sizedImageUrl(url: string, size: number) {
  const image = new URL(url);
  image.pathname = image.pathname.replace(/_\d+x\d+(?=\.\w+$)/, "");
  image.searchParams.set("width", String(size));
  image.searchParams.set("height", String(size));
  return image.toString();
}
