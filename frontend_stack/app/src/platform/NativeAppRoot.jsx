import React from 'react';
import { OverlayStackProvider } from '@beonedge/shared/overlay/OverlayStackContext.jsx';
import NativeBackCoordinator from './NativeBackCoordinator.jsx';
import SystemBarsController from './SystemBarsController.jsx';
import NetworkStatusProvider from './NetworkStatusProvider.jsx';
import ConnectivityBanner from './ConnectivityBanner.jsx';

/**
 * The target-neutral device layer, mounted exactly once above whichever build
 * target is active.
 *
 * Why it exists at all: device concerns were previously owned by whichever shell
 * happened to need them, which meant either duplicating them in `ClientLayout` and
 * `AdminShell` or letting one target's shell own behaviour for both. Back handling,
 * system bars, connectivity and the overlay stack are properties of *the app on
 * this device*, not of a screen — and Back in particular must have exactly one
 * listener, which is only guaranteed if it is registered above the routers.
 *
 * Contains no Client or Admin business logic, and no-ops cleanly on web: every
 * child either checks `Capacitor.isNativePlatform()` or uses APIs that exist in the
 * browser too, so the same tree serves both builds.
 *
 * Ordering matters:
 *   - OverlayStackProvider is outermost of the three because the back coordinator
 *     consumes it.
 *   - NetworkStatusProvider wraps the tree so any screen can read connectivity.
 *   - The two controllers render null; they are effect-only.
 *
 * @param {object} props
 * @param {(context: {pathname: string}) => object} props.resolveBackPolicy
 *   Per-target route policy for the back coordinator.
 * @param {(context: {pathname: string}) => boolean} [props.onTransactionalBack]
 * @param {() => Promise<boolean>} [props.probeReachability]
 */
export default function NativeAppRoot({
  resolveBackPolicy,
  onTransactionalBack,
  probeReachability,
  children,
}) {
  return (
    <NetworkStatusProvider probe={probeReachability}>
      <OverlayStackProvider>
        <SystemBarsController />
        <NativeBackCoordinator
          resolvePolicy={resolveBackPolicy}
          onTransactionalBack={onTransactionalBack}
        />
        <ConnectivityBanner />
        {children}
      </OverlayStackProvider>
    </NetworkStatusProvider>
  );
}
