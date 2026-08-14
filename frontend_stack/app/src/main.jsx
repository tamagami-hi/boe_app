import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@beonedge/design-tokens/tokens.css';
import '@beonedge/design-tokens/kit.css';
import './index.css';
import NativeAppRoot from './platform/NativeAppRoot.jsx';

// Canonical entry point for the Vite app shell. See app/index.html.

/**
 * Load the active build target.
 *
 * The device layer (Back, system bars, overlays, connectivity) is target-neutral and
 * must be mounted exactly once above the router — Back especially, since two
 * listeners both acting on one press is a bug that is very hard to see. But the
 * *rules* Back follows are target-specific.
 *
 * So each root module exports its own `backPolicy` and `probeReachability`
 * alongside its component, and this file imports exactly ONE module per target.
 *
 * That single-import shape is load-bearing, not stylistic. Importing the policy
 * separately — `Promise.all([import(root), import(policy)])` — defeated Vite's
 * dead-branch elimination, and the client APK ended up shipping the admin chunk
 * *and its 82 KB stylesheet*. Keeping the ternary means the unused target's whole
 * subtree is statically unreachable and gets dropped. Verify with
 * `npm run build:android`: no `admin-*` asset may appear.
 */
async function boot() {
  const targetModule = import.meta.env.VITE_BEO_APP_TARGET === 'client'
    ? await import('./ClientRoot.jsx')
    : await import('./BrowserRoot.jsx');

  const Root = targetModule.default;
  const { backPolicy, probeReachability } = targetModule;

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      {/*
        BrowserRouter is outside NativeAppRoot because the back coordinator needs
        `useNavigate`/`useLocation`. The device layer still sits above both target
        roots, which is what guarantees a single Back listener.
      */}
      <BrowserRouter>
        <NativeAppRoot
          resolveBackPolicy={backPolicy}
          probeReachability={probeReachability}
        >
          <Root />
        </NativeAppRoot>
      </BrowserRouter>
    </React.StrictMode>
  );
}

boot();
