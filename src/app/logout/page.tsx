"use client";

export default function LogoutPage() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-gray-50">
      <div className="rounded-lg bg-white p-8 shadow-md">
        <h1 className="mb-4 text-2xl font-bold text-gray-900">Logged out</h1>
        <p className="mb-6 text-gray-600">
          You have been logged out. Close this window or navigate elsewhere to
          log in again.
        </p>
        <button
          onClick={() => {
            window.location.href = "/";
          }}
          className="rounded-lg bg-brand px-4 py-2 text-white hover:bg-brand-dark"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
