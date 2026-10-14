// plant: put a sapling in each empty spot. The seed module, so the
// checker has one feature to report before any demo has run.
export const name = 'plant';

export function run(trees, options = {}) {
  const spacing = options.spacing ?? 4;
  for (const tree of trees) tree.planted = true;
  return { name, treated: trees.length, spacing };
}
