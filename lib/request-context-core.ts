// What a request tells us about where it came from.
//
// The visitor's address comes from x-forwarded-for, through visitorAddress
// (lib/visitor.ts), never from anything the visitor can choose. Whether
// the app is running in development is read from NODE_ENV, given by the
// caller so tests can pass any value.

import { visitorAddress, type HeaderSource } from "./visitor.ts";

export type RequestContext = {
  address: string;
  isDevelopment: boolean;
};

export function contextFromRequest(headers: HeaderSource, nodeEnv: unknown): RequestContext {
  return {
    address: visitorAddress(headers),
    // Only the exact word "development" counts.
    isDevelopment: nodeEnv === "development",
  };
}
