// Copyright (c) The Malloy Foundation
// SPDX-License-Identifier: MIT

import { NextResponse } from "next/server";
import { originFromRequest } from "@/lib/oauth/base-url";
import { corsPreflight, withCors } from "@/lib/oauth/cors";
import { DEVICE_GRANT_TYPE } from "@/lib/oauth/device-codes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const origin = originFromRequest(request);
  return withCors(NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    // A client that cannot receive a redirect (a container, a Codespace, CI)
    // discovers the device flow here and skips the loopback path entirely.
    device_authorization_endpoint: `${origin}/api/oauth/device_authorization`,
    scopes_supported: ["mcp"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token", DEVICE_GRANT_TYPE],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
  }));
}

export async function OPTIONS() {
  return corsPreflight();
}
