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

const normalizeSelector = (value) =>
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

    throw new ErrorClass(
      `${operation} needs a ${resourceLabel} selector because multiple ${resourceLabel}s are accessible: ${collection
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
