export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      for (const ext of ['.js', '.jsx', '/index.js', '/index.jsx']) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {
          // continue
        }
      }
    }
    throw err;
  }
}
