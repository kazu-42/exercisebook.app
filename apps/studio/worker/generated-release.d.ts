// The release builder creates this private input before Wrangler bundles it.
// A clean checkout still typechecks; runtime validation accepts unknown data.
declare module "*/.release/catalog.json" {
  const catalog: unknown;
  export default catalog;
}
