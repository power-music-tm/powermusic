import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { AuthProvider } from './context/AuthContext';
import { PartnerProvider } from './context/PartnerContext';
import { AdminRoute, ManagerRoute, ManagerGuestRoute } from './components/ProtectedRoute';

import Home from './pages/Home';
import ManagerForm from './pages/ManagerForm';
import NewRequests from './pages/NewRequests';
import RequestDetail from './pages/RequestDetail';
import GroupDetail from './pages/GroupDetail';
import Directory from './pages/Directory';
import PartnerSettings from './pages/PartnerSettings';
import AdminLogin from './pages/AdminLogin';
import Signup from './pages/Signup';
import AuthCallback from './pages/AuthCallback';
import PartnerSubmitEntry from './pages/PartnerSubmitEntry';

/** Admin pages that use the persistent sidebar shell. */
function AdminShellLayout() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PartnerProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/auth/callback" element={<AuthCallback />} />

            <Route element={<ManagerGuestRoute />}>
              <Route path="/submit/signup" element={<Signup />} />
              <Route path="/:partner/submit/signup" element={<Signup />} />
            </Route>

            {/* Legacy paths → canonical manager auth URL */}
            <Route path="/submit/login" element={<Navigate to="/submit/signup" replace />} />
            <Route path="/login" element={<Navigate to="/submit/signup" replace />} />
            <Route path="/signup" element={<Navigate to="/submit/signup" replace />} />

            <Route element={<ManagerRoute />}>
              <Route path="/submit" element={<ManagerForm />} />
            </Route>

            {/* Partner-branded manager portal entry (shareable link per partner) */}
            <Route path="/:partner/submit" element={<PartnerSubmitEntry />} />

            <Route element={<AdminRoute />}>
              <Route element={<AdminShellLayout />}>
                <Route path="/" element={<Home />} />
                <Route path="/new-requests" element={<NewRequests />} />
                <Route path="/new-requests/group/:groupId" element={<GroupDetail />} />
                <Route path="/new-requests/:requestId" element={<RequestDetail />} />
                <Route path="/directory" element={<Directory />} />
                <Route path="/directory/archived" element={<Directory />} />
                <Route path="/partner-settings" element={<PartnerSettings />} />
                <Route path="/templates" element={<Navigate to="/" replace />} />
                <Route path="/email-responses" element={<Navigate to="/" replace />} />
                <Route path="/email-accounts" element={<Navigate to="/partner-settings" replace />} />
                <Route path="/ignore-list" element={<Navigate to="/partner-settings" replace />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/submit/signup" replace />} />
          </Routes>
        </BrowserRouter>
      </PartnerProvider>
    </AuthProvider>
  );
}
