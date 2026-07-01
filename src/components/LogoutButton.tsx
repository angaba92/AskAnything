"use client";

export default function LogoutButton() {
  function handleLogout() {
    // For HTTP Basic Auth, forcing a 401 challenge is the practical way to
    // "log out" and require credentials again.
    window.location.href = `/api/logout?ts=${Date.now()}`;
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="fixed bottom-16 left-4 z-50 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      title="Log out"
      aria-label="Log out"
    >
      Logout
    </button>
  );
}
