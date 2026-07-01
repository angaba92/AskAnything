import { NextResponse } from "next/server";

function challenge() {
  return new NextResponse("Logged out.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="AskAnything internal demo", charset="UTF-8"',
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

export async function GET() {
  return challenge();
}

export async function POST() {
  return challenge();
}
