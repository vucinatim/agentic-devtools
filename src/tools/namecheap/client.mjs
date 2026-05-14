import { XMLParser } from "fast-xml-parser";
import { getResolvedAuthConfig } from "./auth.mjs";

const DEFAULT_BASE_URL = "https://api.namecheap.com/xml.response";
const SANDBOX_BASE_URL = "https://api.sandbox.namecheap.com/xml.response";
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_TTL = 1800;

const XML_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
};

const parser = new XMLParser(XML_OPTIONS);

const asArray = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];

const textOf = (value) => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String(value["#text"]);
  }
  return "";
};

const isTruthyEnv = (value) =>
  typeof value === "string" &&
  ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());

const toInteger = (value) => {
  if (value == null || value === "") {
    return undefined;
  }
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const normalizeDomainName = (domain) =>
  String(domain).trim().toLowerCase().replace(/\.$/, "");

const splitRegisteredDomain = (domainName) => {
  const normalized = normalizeDomainName(domainName);
  const firstDot = normalized.indexOf(".");

  if (firstDot <= 0 || firstDot === normalized.length - 1) {
    throw new Error(
      `Invalid domain "${domainName}". Expected a registered domain like "example.com".`,
    );
  }

  return {
    domain: normalized,
    sld: normalized.slice(0, firstDot),
    tld: normalized.slice(firstDot + 1),
  };
};

const normalizeDnsRecord = (record) => ({
  id: toInteger(record.id ?? record.HostId),
  name: String(record.name ?? record.Name ?? "@").trim(),
  type: String(record.type ?? record.Type ?? "").trim().toUpperCase(),
  address: String(record.address ?? record.Address ?? "").trim(),
  mxPref: toInteger(record.mxPref ?? record.MXPref),
  ttl: toInteger(record.ttl ?? record.TTL) ?? DEFAULT_TTL,
  emailType:
    (record.emailType ?? record.EmailType)
      ? String(record.emailType ?? record.EmailType).trim().toUpperCase()
      : undefined,
  flag: toInteger(record.flag ?? record.Flag),
  tag:
    (record.tag ?? record.Tag)
      ? String(record.tag ?? record.Tag).trim().toLowerCase()
      : undefined,
});

const recordIdentity = (record) =>
  JSON.stringify({
    name: normalizeDnsRecord(record).name,
    type: normalizeDnsRecord(record).type,
    address: normalizeDnsRecord(record).address,
    mxPref: normalizeDnsRecord(record).mxPref ?? null,
    ttl: normalizeDnsRecord(record).ttl ?? DEFAULT_TTL,
    emailType: normalizeDnsRecord(record).emailType ?? null,
    flag: normalizeDnsRecord(record).flag ?? null,
    tag: normalizeDnsRecord(record).tag ?? null,
  });

const matchesDnsRecord = (existingRecord, targetRecord) => {
  const existing = normalizeDnsRecord(existingRecord);
  const target = normalizeDnsRecord(targetRecord);

  if (existing.name !== target.name) {
    return false;
  }
  if (existing.type !== target.type) {
    return false;
  }
  if (existing.address !== target.address) {
    return false;
  }

  if (target.type === "MX" && target.mxPref != null) {
    return existing.mxPref === target.mxPref;
  }
  if (target.type === "CAA") {
    if (target.flag != null && existing.flag !== target.flag) {
      return false;
    }
    if (target.tag && existing.tag !== target.tag) {
      return false;
    }
  }
  if (target.ttl != null && existing.ttl !== target.ttl) {
    return false;
  }

  return true;
};

const findMatchingRecordIndexes = (records, targetRecord) =>
  records.reduce((matches, existingRecord, index) => {
    if (matchesDnsRecord(existingRecord, targetRecord)) {
      matches.push(index);
    }
    return matches;
  }, []);

const formatErrors = (errorsNode) =>
  asArray(errorsNode?.Error)
    .map((error) => {
      if (typeof error === "string") {
        return { message: error };
      }

      if (!error || typeof error !== "object") {
        return { message: String(error) };
      }

      return {
        number:
          "Number" in error && error.Number != null
            ? String(error.Number)
            : undefined,
        message: textOf(error) || "Unknown Namecheap API error",
      };
    })
    .filter((error) => error.message);

const serializeForTool = (value) => JSON.stringify(value, null, 2);

const validateMutationRecords = (records) => {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Expected at least one DNS record.");
  }

  const emailTypes = new Set();

  for (const rawRecord of records) {
    const record = normalizeDnsRecord(rawRecord);

    if (!record.name) {
      throw new Error("Each DNS record requires a non-empty name.");
    }
    if (!record.type) {
      throw new Error(`DNS record "${record.name}" is missing a type.`);
    }
    if (!record.address) {
      throw new Error(
        `DNS record "${record.name}" (${record.type}) is missing an address.`,
      );
    }
    if (record.ttl != null && (record.ttl < 60 || record.ttl > 60000)) {
      throw new Error(
        `DNS record "${record.name}" (${record.type}) has invalid TTL ${record.ttl}. Expected 60-60000.`,
      );
    }
    if (record.type === "MX" && record.mxPref == null) {
      throw new Error(
        `DNS record "${record.name}" (${record.type}) requires mxPref.`,
      );
    }
    if (record.type === "CAA") {
      if (record.flag == null || !record.tag) {
        throw new Error(
          `DNS record "${record.name}" (${record.type}) requires both flag and tag.`,
        );
      }
    }
    if (record.emailType) {
      emailTypes.add(record.emailType);
    }
  }

  if (emailTypes.size > 1) {
    throw new Error(
      "Namecheap only accepts one EmailType value per setHosts request. Do not mix multiple emailType values in one mutation.",
    );
  }
};

const buildSetHostsPayload = (records, { emailType } = {}) => {
  validateMutationRecords(records);
  const payload = {};
  let resolvedEmailType = emailType;

  records.map(normalizeDnsRecord).forEach((record, index) => {
    const item = index + 1;
    payload[`HostName${item}`] = record.name;
    payload[`RecordType${item}`] = record.type;
    payload[`Address${item}`] = record.address;
    payload[`TTL${item}`] = String(record.ttl ?? DEFAULT_TTL);

    if (record.mxPref != null) {
      payload[`MXPref${item}`] = String(record.mxPref);
    }
    if (record.flag != null) {
      payload[`Flag${item}`] = String(record.flag);
    }
    if (record.tag) {
      payload[`Tag${item}`] = record.tag;
    }
    if (record.emailType) {
      resolvedEmailType = record.emailType;
    }
  });

  if (resolvedEmailType) {
    payload.EmailType = resolvedEmailType;
  }

  return payload;
};

const parseDomainListResponse = (data) => {
  const commandResponse = data?.ApiResponse?.CommandResponse ?? {};
  const paging = commandResponse.Paging ?? {};

  return {
    domains: asArray(commandResponse.DomainGetListResult?.Domain).map(
      (domain) => ({
        id: toInteger(domain.ID),
        name: normalizeDomainName(domain.Name),
        createdAt: domain.Created,
        expiresAt: domain.Expires,
        isExpired: String(domain.IsExpired).toLowerCase() === "true",
        isLocked: String(domain.IsLocked).toLowerCase() === "true",
        autoRenew: String(domain.AutoRenew).toLowerCase() === "true",
        whoisGuard: domain.WhoisGuard,
        isPremium: String(domain.IsPremium).toLowerCase() === "true",
        isOurDns: String(domain.IsOurDNS).toLowerCase() === "true",
      }),
    ),
    paging: {
      totalItems: toInteger(paging.TotalItems) ?? 0,
      currentPage: toInteger(paging.CurrentPage) ?? 1,
      pageSize: toInteger(paging.PageSize) ?? DEFAULT_PAGE_SIZE,
    },
  };
};

const parseDnsListResponse = (data) => {
  const result = data?.ApiResponse?.CommandResponse?.DomainDNSGetListResult ?? {};

  return {
    domain: normalizeDomainName(result.Domain ?? ""),
    isUsingOurDns: String(result.IsUsingOurDNS).toLowerCase() === "true",
    nameservers: asArray(result.Nameserver).map((value) => String(value)),
  };
};

const parseDnsHostsResponse = (data) => {
  const result =
    data?.ApiResponse?.CommandResponse?.DomainDNSGetHostsResult ?? {};

  return {
    domain: normalizeDomainName(result.Domain ?? ""),
    isUsingOurDns: String(result.IsUsingOurDNS).toLowerCase() === "true",
    emailType: result.EmailType ? String(result.EmailType).trim().toUpperCase() : undefined,
    records: asArray(result.Host ?? result.host).map(normalizeDnsRecord),
  };
};

export class NamecheapApiError extends Error {
  constructor(message, { command, errors = [], response } = {}) {
    super(message);
    this.name = "NamecheapApiError";
    this.command = command;
    this.errors = errors;
    this.response = response;
  }
}

export const createNamecheapClient = ({
  apiUser,
  apiKey,
  username,
  clientIp,
  baseUrl,
  sandbox,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (!apiUser) {
    throw new Error("Missing NAMECHEAP_API_USER.");
  }
  if (!apiKey) {
    throw new Error("Missing NAMECHEAP_API_KEY.");
  }
  if (!username) {
    throw new Error("Missing NAMECHEAP_USERNAME.");
  }
  if (!clientIp) {
    throw new Error("Missing NAMECHEAP_CLIENT_IP.");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("Global fetch is unavailable in this Node runtime.");
  }

  const resolvedBaseUrl =
    baseUrl || (isTruthyEnv(sandbox) ? SANDBOX_BASE_URL : DEFAULT_BASE_URL);

  const call = async (command, params = {}) => {
    const body = new URLSearchParams({
      ApiUser: apiUser,
      ApiKey: apiKey,
      UserName: username,
      ClientIp: clientIp,
      Command: command,
      ...Object.fromEntries(
        Object.entries(params).map(([key, value]) => [key, String(value)]),
      ),
    });

    const response = await fetchImpl(resolvedBaseUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/xml, text/xml",
      },
      body,
    });

    const xml = await response.text();

    if (!response.ok) {
      throw new NamecheapApiError(
        `Namecheap API request failed with HTTP ${response.status}.`,
        { command, response: xml },
      );
    }

    const data = parser.parse(xml);
    const apiResponse = data?.ApiResponse;

    if (!apiResponse) {
      throw new NamecheapApiError("Failed to parse Namecheap API response.", {
        command,
        response: xml,
      });
    }

    const errors = formatErrors(apiResponse.Errors);
    if (String(apiResponse.Status).toUpperCase() !== "OK" || errors.length > 0) {
      const errorMessage =
        errors
          .map((error) =>
            error.number
              ? `${error.number}: ${error.message}`
              : error.message,
          )
          .join("; ") || `Namecheap API command ${command} failed.`;

      throw new NamecheapApiError(errorMessage, {
        command,
        errors,
        response: xml,
      });
    }

    return data;
  };

  const listDomains = async ({
    searchTerm,
    page = 1,
    pageSize = DEFAULT_PAGE_SIZE,
    listType = "ALL",
    sortBy = "NAME",
  } = {}) => {
    const normalizedPageSize = Math.min(
      Math.max(10, Number(pageSize) || DEFAULT_PAGE_SIZE),
      MAX_PAGE_SIZE,
    );

    const data = await call("namecheap.domains.getList", {
      ListType: listType,
      Page: page,
      PageSize: normalizedPageSize,
      SortBy: sortBy,
      ...(searchTerm ? { SearchTerm: searchTerm } : {}),
    });

    return parseDomainListResponse(data);
  };

  const resolveRegisteredDomain = async (domain) => {
    const normalized = normalizeDomainName(domain);
    let page = 1;

    while (true) {
      const result = await listDomains({
        searchTerm: normalized,
        page,
        pageSize: DEFAULT_PAGE_SIZE,
      });

      const match = result.domains.find((entry) => entry.name === normalized);
      if (match) {
        return {
          ...match,
          ...splitRegisteredDomain(match.name),
        };
      }

      const seen = result.paging.currentPage * result.paging.pageSize;
      if (seen >= result.paging.totalItems || result.domains.length === 0) {
        break;
      }
      page += 1;
    }

    throw new Error(
      `Domain "${normalized}" was not found in the configured Namecheap account.`,
    );
  };

  const getDnsStatus = async (domain) => {
    const resolved = await resolveRegisteredDomain(domain);
    const data = await call("namecheap.domains.dns.getList", {
      SLD: resolved.sld,
      TLD: resolved.tld,
    });

    return {
      ...resolved,
      ...parseDnsListResponse(data),
    };
  };

  const getDomainDns = async (domain) => {
    const status = await getDnsStatus(domain);
    if (!status.isUsingOurDns) {
      return {
        ...status,
        records: [],
      };
    }

    const data = await call("namecheap.domains.dns.getHosts", {
      SLD: status.sld,
      TLD: status.tld,
    });

    return {
      ...status,
      ...parseDnsHostsResponse(data),
    };
  };

  const replaceDomainDns = async ({ domain, records, emailType }) => {
    const status = await getDnsStatus(domain);

    if (!status.isUsingOurDns) {
      throw new Error(
        `Domain "${status.domain}" is not using Namecheap DNS. Current nameservers: ${status.nameservers.join(", ")}`,
      );
    }

    const normalizedRecords = records.map(normalizeDnsRecord);
    const resolvedEmailType =
      emailType ??
      normalizedRecords.find((record) => record.emailType)?.emailType;

    await call("namecheap.domains.dns.setHosts", {
      SLD: status.sld,
      TLD: status.tld,
      ...buildSetHostsPayload(normalizedRecords, {
        emailType: resolvedEmailType,
      }),
    });

    return getDomainDns(status.domain);
  };

  const addDomainDnsRecord = async ({ domain, record }) => {
    const current = await getDomainDns(domain);
    const nextRecord = normalizeDnsRecord(record);
    const exists = current.records.some((existingRecord) =>
      matchesDnsRecord(existingRecord, nextRecord),
    );

    if (exists) {
      return {
        ...current,
        changed: false,
      };
    }

    const next = await replaceDomainDns({
      domain: current.domain,
      emailType: current.emailType,
      records: [...current.records, nextRecord],
    });

    return {
      ...next,
      changed: true,
    };
  };

  const removeDomainDnsRecord = async ({ domain, record }) => {
    const current = await getDomainDns(domain);
    const matchingIndexes = findMatchingRecordIndexes(current.records, record);
    const remainingRecords = current.records.filter(
      (_existingRecord, index) => !matchingIndexes.includes(index),
    );

    if (remainingRecords.length === current.records.length) {
      return {
        ...current,
        changed: false,
      };
    }

    const next =
      remainingRecords.length === 0
        ? await replaceDomainDns({ domain: current.domain, records: [] }).catch(
            async (error) => {
              if (
                error instanceof Error &&
                /Expected at least one DNS record/.test(error.message)
              ) {
                throw new Error(
                  "Refusing to remove the final DNS record through removeDomainDnsRecord. Use replaceDomainDns with the exact target state if you intentionally want an empty zone.",
                );
              }
              throw error;
            },
          )
        : await replaceDomainDns({
            domain: current.domain,
            emailType: current.emailType,
            records: remainingRecords,
          });

    return {
      ...next,
      changed: true,
    };
  };

  const updateDomainDnsRecord = async ({
    domain,
    matchRecord,
    newRecord,
  }) => {
    const current = await getDomainDns(domain);
    const matchingIndexes = findMatchingRecordIndexes(current.records, matchRecord);

    if (matchingIndexes.length === 0) {
      throw new Error(
        `No DNS record matched the requested update target on "${current.domain}".`,
      );
    }

    if (matchingIndexes.length > 1) {
      throw new Error(
        `Update target on "${current.domain}" is ambiguous. ${matchingIndexes.length} records matched.`,
      );
    }

    const targetIndex = matchingIndexes[0];
    const existingRecord = current.records[targetIndex];
    const normalizedNewRecord = normalizeDnsRecord(newRecord);

    if (matchesDnsRecord(existingRecord, normalizedNewRecord)) {
      return {
        ...current,
        changed: false,
      };
    }

    const nextRecords = current.records.map((record, index) =>
      index === targetIndex ? normalizedNewRecord : record,
    );

    const next = await replaceDomainDns({
      domain: current.domain,
      emailType: current.emailType,
      records: nextRecords,
    });

    return {
      ...next,
      changed: true,
    };
  };

  return {
    baseUrl: resolvedBaseUrl,
    listDomains,
    resolveRegisteredDomain,
    getDnsStatus,
    getDomainDns,
    replaceDomainDns,
    addDomainDnsRecord,
    removeDomainDnsRecord,
    updateDomainDnsRecord,
    serializeForTool,
    helpers: {
      normalizeDomainName,
      splitRegisteredDomain,
      normalizeDnsRecord,
      recordIdentity,
      buildSetHostsPayload,
      matchesDnsRecord,
      findMatchingRecordIndexes,
    },
  };
};

export const createResolvedNamecheapClient = async (options = {}) => {
  const auth = await getResolvedAuthConfig();

  return createNamecheapClient({
    apiUser: options.apiUser ?? auth.apiUser,
    apiKey: options.apiKey ?? auth.apiKey,
    username: options.username ?? auth.username ?? auth.apiUser,
    clientIp: options.clientIp ?? auth.clientIp,
    baseUrl: options.baseUrl ?? auth.baseUrl,
    sandbox:
      options.sandbox ?? (typeof auth.sandbox === "boolean" ? auth.sandbox : false),
    fetchImpl: options.fetchImpl,
  });
};
