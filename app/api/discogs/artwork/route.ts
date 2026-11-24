import { NextResponse } from "next/server";

import { cdRoutesDisabledResponse } from "@/app/api/_cd-route-guard";

const allowedImageHosts = new Set(["i.discogs.com", "img.discogs.com"]);
const maxImageBytes = 8 * 1024 * 1024;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export async function GET(request: Request) {
  const disabled = cdRoutesDisabledResponse();
  if (disabled) return disabled;

  const rawSource = new URL(request.url).searchParams.get("src");
  let source: URL;
  try {
    source = new URL(rawSource ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid artwork source" }, { status: 400 });
  }
  if (
    source.protocol !== "https:" ||
    !allowedImageHosts.has(source.hostname) ||
    source.username ||
    source.password ||
    (source.port && source.port !== "443")
  ) {
    return NextResponse.json({ error: "Invalid artwork source" }, { status: 400 });
  }

  try {
    const upstream = await fetch(source, {
      cache: "no-store",
      redirect: "error",
      headers: { Accept: "image/jpeg,image/png,image/webp,image/gif" },
    });
    if (!upstream.ok) {
      return NextResponse.json({ error: "Discogs artwork is unavailable" }, { status: 502 });
    }

    const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    const contentLength = Number(upstream.headers.get("content-length") ?? 0);
    if (
      !contentType ||
      !allowedImageTypes.has(contentType) ||
      (contentLength > 0 && contentLength > maxImageBytes)
    ) {
      return NextResponse.json({ error: "Discogs returned invalid artwork" }, { status: 502 });
    }

    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > maxImageBytes) {
      return NextResponse.json({ error: "Discogs artwork size is invalid" }, { status: 502 });
    }

    return new Response(bytes, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, max-age=21600, must-revalidate",
        "CDN-Cache-Control": "no-store",
        "Vercel-CDN-Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Discogs artwork is unavailable" }, { status: 502 });
  }
}
