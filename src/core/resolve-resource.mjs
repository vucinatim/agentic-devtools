/**
 * Generic "resolve a single named resource from a list" helper.
 *
 * Lifted from src/tools/cloudflare/client.mjs where it shipped first. It
 * handles the 0 / 1 / many cases with exact-then-fuzzy matching and produces
 * clear errors that include candidate names. Provider clients should use this
 * in place of ad-hoc loops.
 *
 * The caller injects a `ResourceError` class so the thrown error carries the
 * right name (CloudflareApiError, RailwayApiError, etc.). If omitted, throws
 * a generic Error.
 */

export const normalizeSelector = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

export const matchesSelector = (candidate, requested) => {
  const wanted = normalizeSelector(requested);
  if (!wanted) {
    return true;
  }
  const value = normalizeSelector(candidate);
  return value.includes(wanted);
};

export const resolveSingleNamedResource = ({
  items,
  requestedName,
  getId,
  getLabel,
  resourceLabel,
  operation,
  ErrorClass = Error,
  // Optional: when no name is given and multiple items match, pick a default
  // (e.g. the "production" environment) instead of erroring. Returns an item
  // from the collection, or null/undefined to fall through to the error.
  fallbackResolver,
}) => {
  const collection = Array.isArray(items) ? items : [];

  if (collection.length === 0) {
    return null;
  }

  if (!requestedName) {
    if (collection.length === 1) {
      return {
        id: getId(collection[0]),
        label: getLabel(collection[0]),
      };
    }

    const fallback =
      typeof fallbackResolver === "function"
        ? fallbackResolver(collection)
        : null;
    if (fallback) {
      return { id: getId(fallback), label: getLabel(fallback) };
    }

    // Name the exact selector flags when the label is a single word
    // (e.g. account → `--account-id` / `--account-name`); fall back to prose
    // for multi-word labels.
    const selectorHint = resourceLabel.includes(" ")
      ? `an explicit ${resourceLabel} id or name`
      : `\`--${resourceLabel}-id\` or \`--${resourceLabel}-name\``;
    throw new ErrorClass(
      `${operation} matched multiple ${resourceLabel}s — pass ${selectorHint} to choose one. Accessible: ${collection
        .slice(0, 10)
        .map((item) => getLabel(item))
        .join(", ")}.`,
    );
  }

  const exactMatches = collection.filter(
    (item) =>
      normalizeSelector(getLabel(item)) === normalizeSelector(requestedName),
  );

  if (exactMatches.length === 1) {
    return {
      id: getId(exactMatches[0]),
      label: getLabel(exactMatches[0]),
    };
  }

  const fuzzyMatches = collection.filter((item) =>
    matchesSelector(getLabel(item), requestedName),
  );

  if (fuzzyMatches.length === 1) {
    return {
      id: getId(fuzzyMatches[0]),
      label: getLabel(fuzzyMatches[0]),
    };
  }

  if (exactMatches.length > 1 || fuzzyMatches.length > 1) {
    const matches = (exactMatches.length > 1 ? exactMatches : fuzzyMatches)
      .slice(0, 10)
      .map((item) => getLabel(item))
      .join(", ");

    throw new ErrorClass(
      `${operation} found multiple matching ${resourceLabel}s for "${requestedName}": ${matches}. Use the explicit ${resourceLabel} id if needed.`,
    );
  }

  return null;
};
