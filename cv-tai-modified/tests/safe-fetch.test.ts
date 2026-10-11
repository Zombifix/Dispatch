import { describe, it, expect } from "vitest";
import http from "http";
import { isPrivateAddress, validatePublicUrl, safeFetchText } from "../server/safe-fetch";
import { resolveJobInput } from "../server/job-input";

describe("protection SSRF", () => {
  it("classe les adresses internes", () => {
    for (const a of ["127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
    for (const a of ["1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) expect(isPrivateAddress(a), a).toBe(false);
  });
  it("refuse les URL non publiques", () => {
    for (const u of ["file:///etc/passwd", "http://localhost/x", "http://127.0.0.1/", "http://[::1]/", "http://169.254.169.254/latest/meta-data",
      "http://intranet.internal/", "http://example.com:8080/", "ftp://example.com/", "http://user:pw@example.com/"]) {
      expect(validatePublicUrl(u), u).toBeNull();
    }
    expect(validatePublicUrl("https://www.welcometothejungle.com/fr/jobs/x")).not.toBeNull();
  });
  it("ne se connecte jamais à un service local, même par son nom", async () => {
    let hits = 0;
    const server = http.createServer((_q, r) => { hits++; r.end("secret"); });
    await new Promise<void>(res => server.listen(0, "127.0.0.1", () => res()));
    const port = (server.address() as any).port;
    expect(await safeFetchText(`http://127.0.0.1:${port}/`)).toBeNull();
    expect(await safeFetchText(`http://localhost/`)).toBeNull();
    server.close();
    expect(hits).toBe(0);
  });
  it("le flux d'annonce refuse un lien interne sans le contacter", async () => {
    const r = await resolveJobInput({ url: "http://169.254.169.254/latest/meta-data/iam" });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/adresse web publique/);
  });
});
