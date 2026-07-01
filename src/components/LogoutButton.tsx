"use client";

export default function LogoutButton() {
  function handleLogout() {
    window.location.href = `/logout`;
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
