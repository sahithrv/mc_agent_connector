import { ApiClient, ApiError } from "./client";

describe("ApiClient", () => {
  it("returns useful error shape for failed HTTP responses", async () => {
    const client = new ApiClient({
      baseUrl: "http://studio.test",
      fetcher: async () =>
        new Response(JSON.stringify({ error: "viewerRole must be valid" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
    });

    await expect(client.get("/chat/messages")).rejects.toMatchObject({
      shape: {
        name: "ApiError",
        status: 400,
        message: "viewerRole must be valid",
        url: "http://studio.test/chat/messages",
      },
    });
  });

  it("returns useful error shape for network failures", async () => {
    const client = new ApiClient({
      baseUrl: "/api",
      fetcher: async () => {
        throw new Error("connection refused");
      },
    });

    await expect(client.get("/healthz")).rejects.toMatchObject({
      shape: {
        name: "ApiError",
        status: 0,
        message: "Unable to reach backend at /api/healthz",
        url: "/api/healthz",
      },
    });
  });
});
