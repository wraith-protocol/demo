/** Extract every same-origin script/modulepreload src from built index.html. */
export function extractInitialLoadPaths(html) {
  const paths = new Set();
  const tagPattern =
    /<(?:script[^>]*\stype="module"[^>]*\ssrc="([^"]+)"|link[^>]*\srel="modulepreload"[^>]*\shref="([^"]+)")/g;
  let match;
  while ((match = tagPattern.exec(html)) !== null) {
    const src = match[1] ?? match[2];
    if (src && !/^https?:\/\//.test(src)) paths.add(src);
  }
  return [...paths];
}
