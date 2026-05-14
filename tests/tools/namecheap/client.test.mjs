import assert from "node:assert/strict";
import { test } from "vitest";
import { createNamecheapClient, NamecheapApiError } from "../../../src/tools/namecheap/client.mjs";

const makeResponse = (xml, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return xml;
  },
});

test("listDomains parses paged domain results", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="true" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging>
      <TotalItems>1</TotalItems>
      <CurrentPage>1</CurrentPage>
      <PageSize>100</PageSize>
    </Paging>
  </CommandResponse>
</ApiResponse>`;

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(xml),
  });

  const result = await client.listDomains();
  assert.equal(result.domains.length, 1);
  assert.equal(result.domains[0].name, "example.com");
  assert.equal(result.domains[0].isLocked, true);
  assert.equal(result.paging.totalItems, 1);
});

test("getDomainDns returns nameservers and records", async () => {
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging>
      <TotalItems>1</TotalItems>
      <CurrentPage>1</CurrentPage>
      <PageSize>100</PageSize>
    </Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1800" />
      <host HostId="14" Name="www" Type="CNAME" Address="@" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(responses.shift()),
  });

  const result = await client.getDomainDns("example.com");
  assert.equal(result.domain, "example.com");
  assert.equal(result.nameservers.length, 2);
  assert.equal(result.records.length, 2);
  assert.equal(result.emailType, "FWD");
  assert.equal(result.records[0].address, "1.2.3.4");
});

test("replaceDomainDns serializes records into setHosts parameters", async () => {
  const requestBodies = [];
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="example.com" IsSuccess="true" />
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" IsUsingOurDNS="true">
      <host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="300" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async (_url, init) => {
      requestBodies.push(init.body.toString());
      return makeResponse(responses.shift());
    },
  });

  const result = await client.replaceDomainDns({
    domain: "example.com",
    records: [
      {
        name: "@",
        type: "A",
        address: "1.2.3.4",
        ttl: 300,
      },
    ],
  });

  const setHostsBody = requestBodies[2];
  assert.match(setHostsBody, /Command=namecheap\.domains\.dns\.setHosts/);
  assert.match(setHostsBody, /HostName1=%40/);
  assert.match(setHostsBody, /RecordType1=A/);
  assert.match(setHostsBody, /Address1=1.2.3.4/);
  assert.match(setHostsBody, /TTL1=300/);
  assert.equal(result.records.length, 1);
});

test("replaceDomainDns preserves zone-level EmailType", async () => {
  const requestBodies = [];
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="example.com" IsSuccess="true" />
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="300" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async (_url, init) => {
      requestBodies.push(init.body.toString());
      return makeResponse(responses.shift());
    },
  });

  await client.replaceDomainDns({
    domain: "example.com",
    emailType: "FWD",
    records: [
      {
        name: "@",
        type: "A",
        address: "1.2.3.4",
        ttl: 300,
      },
    ],
  });

  assert.match(requestBodies[2], /EmailType=FWD/);
});

test("API errors surface Namecheap error details", async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="ERROR">
  <Errors>
    <Error Number="2019166">Domain not found</Error>
  </Errors>
</ApiResponse>`;

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(xml),
  });

  await assert.rejects(() => client.listDomains(), (error) => {
    assert.ok(error instanceof NamecheapApiError);
    assert.match(error.message, /2019166/);
    return true;
  });
});

test("removeDomainDnsRecord matches TXT records without requiring returned MXPref", async () => {
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1800" />
      <host HostId="88" Name="_codex" Type="TXT" Address="hello" MXPref="10" TTL="300" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="example.com" IsSuccess="true" />
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(responses.shift()),
  });

  const result = await client.removeDomainDnsRecord({
    domain: "example.com",
    record: {
      name: "_codex",
      type: "TXT",
      address: "hello",
      ttl: 300,
    },
  });

  assert.equal(result.changed, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].name, "@");
});

test("addDomainDnsRecord is idempotent for an existing TXT record despite returned MXPref", async () => {
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="88" Name="_codex" Type="TXT" Address="hello" MXPref="10" TTL="300" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(responses.shift()),
  });

  const result = await client.addDomainDnsRecord({
    domain: "example.com",
    record: {
      name: "_codex",
      type: "TXT",
      address: "hello",
      ttl: 300,
    },
  });

  assert.equal(result.changed, false);
  assert.equal(result.records.length, 1);
});

test("updateDomainDnsRecord updates exactly one matching record", async () => {
  const requestBodies = [];
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="_codex" Type="TXT" Address="old" MXPref="10" TTL="300" />
      <host HostId="14" Name="www" Type="CNAME" Address="@" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.setHosts">
    <DomainDNSSetHostsResult Domain="example.com" IsSuccess="true" />
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="_codex" Type="TXT" Address="new" MXPref="10" TTL="300" />
      <host HostId="14" Name="www" Type="CNAME" Address="@" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async (_url, init) => {
      requestBodies.push(init.body.toString());
      return makeResponse(responses.shift());
    },
  });

  const result = await client.updateDomainDnsRecord({
    domain: "example.com",
    matchRecord: {
      name: "_codex",
      type: "TXT",
      address: "old",
      ttl: 300,
    },
    newRecord: {
      name: "_codex",
      type: "TXT",
      address: "new",
      ttl: 300,
    },
  });

  assert.equal(result.changed, true);
  assert.match(requestBodies[5], /Address1=new|Address2=new/);
  assert.equal(result.records.find((record) => record.name === "_codex")?.address, "new");
});

test("updateDomainDnsRecord fails when no record matches", async () => {
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="www" Type="CNAME" Address="@" MXPref="10" TTL="1800" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(responses.shift()),
  });

  await assert.rejects(
    () =>
      client.updateDomainDnsRecord({
        domain: "example.com",
        matchRecord: {
          name: "_codex",
          type: "TXT",
          address: "old",
          ttl: 300,
        },
        newRecord: {
          name: "_codex",
          type: "TXT",
          address: "new",
          ttl: 300,
        },
      }),
    /No DNS record matched/,
  );
});

test("updateDomainDnsRecord fails when multiple records match", async () => {
  const responses = [
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="false" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true"/>
    </DomainGetListResult>
    <Paging><TotalItems>1</TotalItems><CurrentPage>1</CurrentPage><PageSize>20</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getList">
    <DomainDNSGetListResult Domain="example.com" IsUsingOurDNS="true">
      <Nameserver>dns1.name-servers.com</Nameserver>
      <Nameserver>dns2.name-servers.com</Nameserver>
    </DomainDNSGetListResult>
  </CommandResponse>
</ApiResponse>`,
    `<?xml version="1.0" encoding="UTF-8"?>
<ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK">
  <Errors />
  <CommandResponse Type="namecheap.domains.dns.getHosts">
    <DomainDNSGetHostsResult Domain="example.com" EmailType="FWD" IsUsingOurDNS="true">
      <host HostId="12" Name="_codex" Type="TXT" Address="old" MXPref="10" TTL="300" />
      <host HostId="13" Name="_codex" Type="TXT" Address="old" MXPref="10" TTL="300" />
    </DomainDNSGetHostsResult>
  </CommandResponse>
</ApiResponse>`,
  ];

  const client = createNamecheapClient({
    apiUser: "u",
    apiKey: "k",
    username: "u",
    clientIp: "127.0.0.1",
    fetchImpl: async () => makeResponse(responses.shift()),
  });

  await assert.rejects(
    () =>
      client.updateDomainDnsRecord({
        domain: "example.com",
        matchRecord: {
          name: "_codex",
          type: "TXT",
          address: "old",
          ttl: 300,
        },
        newRecord: {
          name: "_codex",
          type: "TXT",
          address: "new",
          ttl: 300,
        },
      }),
    /ambiguous/,
  );
});
