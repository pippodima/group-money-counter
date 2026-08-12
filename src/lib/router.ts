/**
 * Hash routing.
 *
 * Hash rather than history routing because the app is served from GitHub
 * Pages, which has no server-side rewrite: a deep link to /balances would
 * 404. Hashes never reach the server, so no `404.html` trick is needed — and
 * the phone's back gesture works, which matters more here than clean URLs.
 */

import { useEffect, useState } from 'react';

function current(): string {
  return window.location.hash.replace(/^#/, '') || '/';
}

export function useRoute(): string {
  const [route, setRoute] = useState(current);

  useEffect(() => {
    const onChange = () => setRoute(current());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function navigate(path: string, replace = false): void {
  if (replace) window.location.replace(`#${path}`);
  else window.location.hash = path;
}

export function back(): void {
  if (window.history.length > 1) window.history.back();
  else navigate('/');
}

/** Pulls the trailing id out of a route like `/expense/9f2c`. */
export function routeParam(route: string, prefix: string): string | undefined {
  return route.startsWith(prefix) ? route.slice(prefix.length) || undefined : undefined;
}
