import { Routes, Route, Navigate } from 'react-router-dom';
import ClientLayout from './layout/ClientLayout.jsx';

import Splash from './pages/Splash.jsx';
import Login from './pages/Login.jsx';
import KycVerify from './pages/KycVerify.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Explore from './pages/Explore.jsx';
import FundDetail from './pages/FundDetail.jsx';
import StartSipSheet from './pages/StartSipSheet.jsx';
import LumpsumSheet from './pages/LumpsumSheet.jsx';
import PaymentStatus from './pages/PaymentStatus.jsx';
import MandateDetail from './pages/MandateDetail.jsx';
import Portfolio from './pages/Portfolio.jsx';
import Transactions from './pages/Transactions.jsx';
import Statements from './pages/Statements.jsx';
import Notifications from './pages/Notifications.jsx';
import Profile from './pages/Profile.jsx';
import KycDetail from './pages/KycDetail.jsx';
import Security from './pages/Security.jsx';
import Support from './pages/Support.jsx';
import Legal from './pages/Legal.jsx';
import InvestorCharter from './pages/InvestorCharter.jsx';
import GrievanceRedressal from './pages/GrievanceRedressal.jsx';
import NotFound from './pages/NotFound.jsx';
import { useSession } from './store/SessionContext.jsx';
import { SESSION_STATUS } from './store/sessionState.js';
import { RouteErrorBoundary } from '@beonedge/shared/components/RouteErrorBoundary.jsx';
import BootstrapShell from '@beonedge/shared/components/BootstrapShell.jsx';
import { RESOURCE_STATUS } from '@beonedge/shared/data/ResourceCacheProvider.jsx';
import { useEligibility } from './data/clientResources.js';
import AppUpdateGate from './components/AppUpdateGate.jsx';
import './styles/mobile/index.css';

// Execution routes (invest / pay) require investing
// eligibility. Eligibility is derived server-side on every read — never trust a
// stored status — so this gate asks `GET /v1/client/eligibility` and sends
// `canInvest=false` users to the email-verification (KYC OTP) step. If the
// check itself fails we let the user through: order/SIP creation enforces the
// same rule server-side, so a failed check must not lock the app.
//
// The result is cached for ELIGIBILITY (60s) rather than re-fetched per mount. It
// used to run on every entry into every guarded route, so tapping between a fund
// and its SIP form re-asked the same question repeatedly. The cache is a UX
// measure ONLY: the server re-derives eligibility on every write, so a stale
// `true` here cannot authorise anything — it can at most let a user reach a form
// whose submit is then refused.
function RequireApproved({ children }) {
  const { user, status } = useSession();
  const {
    data: eligibility,
    status: resourceStatus,
    error,
  } = useEligibility(user?.id);

  // Was `return null` for all of these, so entering an investment flow blanked the
  // screen while the request was in flight — the tap appeared to do nothing, then
  // the form appeared from nowhere. ClientLayout has already handled the
  // unauthenticated case by the time this renders.
  const settled = resourceStatus === RESOURCE_STATUS.SUCCESS || resourceStatus === RESOURCE_STATUS.ERROR;
  if (status === SESSION_STATUS.RESTORING || !user || !settled) {
    return <BootstrapShell label="Checking your account" />;
  }

  // A failed check lets the user through, as before: the server is the authority and
  // a backend hiccup must not lock the app.
  if (!error && eligibility?.canInvest === false) {
    return <Navigate to="/app/verify-email" replace />;
  }
  return children;
}

export default function ClientApp() {
  return (
    <>
      {/*
        Mounted above the routes so a required update can also be enforced on the
        login screen; it renders nothing while the splash is on screen, and
        nothing at all on the web build where there is no APK to update.
      */}
      <AppUpdateGate />
      <Routes>
      <Route index element={<Navigate to="splash" replace />} />
      <Route element={<ClientLayout />}>
        <Route path="splash" element={<RouteErrorBoundary><Splash /></RouteErrorBoundary>} />
        <Route path="login" element={<RouteErrorBoundary><Login /></RouteErrorBoundary>} />
        <Route path="verify-email" element={<RouteErrorBoundary><KycVerify /></RouteErrorBoundary>} />
        <Route path="start" element={<Navigate to="/app/dashboard" replace />} />
        <Route path="dashboard" element={<RouteErrorBoundary><Dashboard /></RouteErrorBoundary>} />
        <Route path="explore" element={<RouteErrorBoundary><Explore /></RouteErrorBoundary>} />
        <Route path="funds/:fundId" element={<RouteErrorBoundary><FundDetail /></RouteErrorBoundary>} />
        <Route path="invest/sip/:fundId" element={<RequireApproved><RouteErrorBoundary><StartSipSheet /></RouteErrorBoundary></RequireApproved>} />
        <Route path="invest/lumpsum/:fundId" element={<RequireApproved><RouteErrorBoundary><LumpsumSheet /></RouteErrorBoundary></RequireApproved>} />
        <Route path="payment/:paymentId" element={<RequireApproved><RouteErrorBoundary><PaymentStatus /></RouteErrorBoundary></RequireApproved>} />
        <Route path="mandates/:mandateId" element={<RouteErrorBoundary><MandateDetail /></RouteErrorBoundary>} />
        <Route path="portfolio" element={<RouteErrorBoundary><Portfolio /></RouteErrorBoundary>} />
        <Route path="transactions" element={<RouteErrorBoundary><Transactions /></RouteErrorBoundary>} />
        <Route path="statements" element={<RouteErrorBoundary><Statements /></RouteErrorBoundary>} />
        <Route path="notifications" element={<RouteErrorBoundary><Notifications /></RouteErrorBoundary>} />
        <Route path="profile" element={<RouteErrorBoundary><Profile /></RouteErrorBoundary>} />
        <Route path="profile/kyc" element={<RouteErrorBoundary><KycDetail /></RouteErrorBoundary>} />
        <Route path="profile/security" element={<RouteErrorBoundary><Security /></RouteErrorBoundary>} />
        <Route path="profile/support" element={<RouteErrorBoundary><Support /></RouteErrorBoundary>} />
        <Route path="profile/legal" element={<RouteErrorBoundary><Legal /></RouteErrorBoundary>} />
        <Route path="investor-charter" element={<RouteErrorBoundary><InvestorCharter /></RouteErrorBoundary>} />
        <Route path="grievance" element={<RouteErrorBoundary><GrievanceRedressal /></RouteErrorBoundary>} />
        {/*
          Unknown `/app/*` paths render a recoverable Not Found *inside* the
          shell rather than redirecting to splash, which looked like the app
          relaunching and hid the broken link entirely.

          Deliberately inside the ClientLayout block: the layout's guards still
          run for an unmatched path, so an unauthenticated visitor is still sent
          to login and a terminal account still sees Blocked. Only an
          authenticated client reaches Not Found.
        */}
        <Route path="*" element={<RouteErrorBoundary><NotFound /></RouteErrorBoundary>} />
      </Route>
      </Routes>
    </>
  );
}
