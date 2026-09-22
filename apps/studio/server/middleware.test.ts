import { createServer, request as httpRequest, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Workbook } from "../src/contracts";
import { createStudioMiddleware } from "./middleware";

describe("local-only studio API", () => {
  let server: Server;
  let port: number;
  const render = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
  const reportFailure = vi.fn();
  beforeAll(async () => {
    const middleware = createStudioMiddleware({ renderPdf: render, reportFailure });
    server = createServer((request, response) =>
      middleware(request, response, () => {
        response.statusCode = 404;
        response.end("outside api");
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test server port");
    port = address.port;
  });
  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });

  async function request(
    path: string,
    options: { method?: string; body?: string; headers?: Record<string, string> } = {},
  ) {
    return new Promise<{
      status: number;
      headers: Record<string, unknown>;
      text: string;
    }>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method: options.method ?? "GET",
          headers: { "content-type": "application/json", ...options.headers },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(options.body);
    });
  }

  async function create() {
    const response = await request("/studio-api/workbooks", {
      method: "POST",
      body: JSON.stringify({ topicId: "equations", level: "foundation", count: 4 }),
    });
    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers["set-cookie"]).toBeUndefined();
    return JSON.parse(response.text) as Workbook;
  }

  it("serves catalog and deterministic public workbook prompts", async () => {
    const catalog = await request("/studio-api/catalog");
    expect(catalog.status).toBe(200);
    expect(JSON.parse(catalog.text).topics).toHaveLength(3);
    const first = await create();
    expect(await create()).toEqual(first);
    expect(JSON.stringify(first)).not.toContain('"answer"');
  });

  it("grades only on explicit POST and sends answer key only to the PDF adapter", async () => {
    const workbook = await create();
    const response = await request(`/studio-api/workbooks/${workbook.id}/grade`, {
      method: "POST",
      body: JSON.stringify({ answers: { "q-1": "x=4" } }),
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.text).correctCount).toBe(1);
    const pdf = await request(
      `/studio-api/workbooks/${workbook.id}/pdf?variant=student`,
    );
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.text).toBe("%PDF");
    expect(render).toHaveBeenLastCalledWith(workbook, expect.any(Array), "student");
  });

  it.each([
    { host: "evil.example" },
    { host: "127.0.0.1.evil.example" },
    { host: "127.0.0.1:65536" },
    { origin: "https://evil.example" },
    { origin: "null" },
    { "sec-fetch-site": "cross-site" },
  ])("rejects foreign Host, Origin and browser request contexts", async (headers) => {
    const result = await request("/studio-api/catalog", { headers });
    expect(result.status).toBe(403);
  });

  it("accepts its same-origin local browser", async () => {
    expect(
      (
        await request("/studio-api/catalog", {
          headers: {
            origin: `http://127.0.0.1:${port}`,
            "sec-fetch-site": "same-origin",
          },
        })
      ).status,
    ).toBe(200);
  });

  it("enforces methods, exact routes and query allowlists", async () => {
    expect((await request("/studio-api/workbooks")).status).toBe(405);
    expect((await request("/studio-api/catalog", { method: "POST" })).status).toBe(405);
    expect((await request("/studio-api/catalog?name=private")).status).toBe(400);
    expect((await request("/studio-api/missing")).status).toBe(404);
    expect((await request("/outside-api")).text).toBe("outside api");
    const workbook = await create();
    expect((await request(`/studio-api/workbooks/${workbook.id}/grade`)).status).toBe(
      405,
    );
    expect(
      (await request(`/studio-api/workbooks/${workbook.id}/pdf?variant=teacher`))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          `/studio-api/workbooks/${workbook.id}/pdf?variant=student&variant=answers`,
        )
      ).status,
    ).toBe(400);
    expect(
      (await request("/studio-api/workbooks/draft-unknown/pdf?variant=student")).status,
    ).toBe(404);
  });

  it("bounds request bodies and rejects malformed JSON and content types", async () => {
    expect(
      (await request("/studio-api/workbooks", { method: "POST", body: "{" })).status,
    ).toBe(400);
    expect(
      (
        await request("/studio-api/workbooks", {
          method: "POST",
          body: "{}",
          headers: { "content-type": "text/plain" },
        })
      ).status,
    ).toBe(415);
    expect(
      (
        await request("/studio-api/workbooks", {
          method: "POST",
          body: JSON.stringify({ oversized: "a".repeat(9000) }),
        })
      ).status,
    ).toBe(413);
    expect(
      (
        await request("/studio-api/workbooks", {
          method: "POST",
          body: "{}",
          headers: { "content-encoding": "gzip" },
        })
      ).status,
    ).toBe(415);
  });

  it("reports infrastructure errors without input details, while keeping web requests available", async () => {
    render.mockRejectedValueOnce(new Error("private renderer path and learner input"));
    const workbook = await create();
    const result = await request(
      `/studio-api/workbooks/${workbook.id}/pdf?variant=answers`,
    );
    expect(result.status).toBe(503);
    expect(result.text).not.toMatch(/private renderer|learner input/);
    expect(reportFailure).toHaveBeenLastCalledWith("studio_pdf_failed");
    expect((await request("/studio-api/catalog")).status).toBe(200);
  });
});
