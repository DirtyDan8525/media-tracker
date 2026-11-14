/** Test-time values of the build flags in ../features (see the mock in setup.ts); reset to the real defaults before each test. */
export const flags = { compare: false };

export function setCompareEnabled(on: boolean) {
  flags.compare = on;
}
