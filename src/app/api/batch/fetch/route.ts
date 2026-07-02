import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Convert common OneDrive / SharePoint "share" links into a direct-download URL.
 * Works for links shared as "anyone with the link". Corporate links that require
 * sign-in cannot be downloaded server-side and will return an HTML login page —
 * we detect that and return a helpful error.
 */
function toDirectDownload(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  const host = url.hostname.toLowerCase();

  // Short links (1drv.ms) resolve through redirects; just append download hint.
  if (host.endsWith("1drv.ms")) {
    return url.toString();
  }

  // Personal OneDrive: onedrive.live.com/redir?resid=... -> download?resid=...
  if (host.endsWith("onedrive.live.com")) {
    url.pathname = url.pathname.replace(/\/redir$/i, "/download");
    return url.toString();
  }

  // SharePoint / OneDrive for Business share links: add download=1
  if (host.includes("sharepoint.com") || host.includes("-my.sharepoint.com")) {
    url.searchParams.set("download", "1");
    return url.toString();
  }

  // Fallback: try adding download=1
  url.searchParams.set("download", "1");
  return url.toString();
}

export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const link = (body.url ?? "").trim();
  if (!link) {
    return NextResponse.json({ error: "Missing link." }, { status: 400 });
  }

  const target = toDirectDownload(link);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      redirect: "follow",
      headers: {
        // Some SharePoint endpoints behave better with a browser-like UA.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Could not reach the link: " + (err as Error).message },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      {
        error: `The link returned HTTP ${upstream.status}. Make sure it is shared as "anyone with the link" and points directly to the file.`,
      },
      { status: 502 },
    );
  }

  const contentType = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const buf = Buffer.from(await upstream.arrayBuffer());

  // If we got an HTML page it's almost always a sign-in / access-denied page.
  const looksHtml =
    contentType.includes("text/html") ||
    buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase().startsWith("<!doctype") ||
    buf.subarray(0, 64).toString("utf8").trimStart().toLowerCase().startsWith("<html");

  if (looksHtml) {
    return NextResponse.json(
      {
        error:
          "The link required sign-in (got an HTML page, not a file). Share the file as \"anyone with the link\", or download it and upload it manually.",
      },
      { status: 422 },
    );
  }

  // A valid .xlsx is a ZIP (starts with 'PK'); .xls starts with D0 CF 11 E0.
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isOle =
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
  if (!isZip && !isOle) {
    return NextResponse.json(
      {
        error:
          "The downloaded content does not look like an Excel file. Check the link points directly to an .xlsx/.xls file.",
      },
      { status: 422 },
    );
  }

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store",
    },
  });
}
