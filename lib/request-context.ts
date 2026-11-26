// What this request tells us: the server-only front door. headers() is
// async and read-only in this version of Next.js.
import "server-only";

import { headers } from "next/headers";

import { contextFromRequest, type RequestContext } from "./request-context-core.ts";

export async function getRequestContext(): Promise<RequestContext> {
  return contextFromRequest(await headers(), process.env.NODE_ENV);
}
