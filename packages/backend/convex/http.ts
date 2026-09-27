import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { generationWebhook } from "./generation";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/webhooks/generation",
  method: "POST",
  handler: generationWebhook,
});

export default http;
