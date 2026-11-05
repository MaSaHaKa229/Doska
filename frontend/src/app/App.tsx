import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '../store/auth';
import { setHttpHooks } from '../api/http';
import { FullScreenSpinner, Toasts } from '../ui/misc';
import { RequireAuth } from './RequireAuth';
import { AppLayout } from './AppLayout';
import { AdminLayout } from './AdminLayout';
import { LoginPage } from '../pages/LoginPage';
import { ChangePasswordPage } from '../pages/ChangePasswordPage';
import { AssignmentsPage } from '../pages/assignments/AssignmentsPage';
import { AssignmentPage } from '../pages/assignments/AssignmentPage';
import { LibraryPage } from '../pages/library/LibraryPage';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { DashboardPage } from '../pages/admin/DashboardPage';
import { UsersPage } from '../pages/admin/UsersPage';
import { ImportPage } from '../pages/admin/ImportPage';
import { CredentialsPage } from '../pages/admin/CredentialsPage';
import { ClassesPage } from '../pages/admin/ClassesPage';
import { ClassPage } from '../pages/admin/ClassPage';
import { AuditPage } from '../pages/admin/AuditPage';
// Доска (Konva, Yjs) — отдельный чанк: вход и админка загружаются без неё.
const BoardPage = lazy(() => import('../pages/board/BoardPage').then((m) => ({ default: m.BoardPage })));

export function App() {
  const status = useAuth((s) => s.status);

  useEffect(() => {
    setHttpHooks({
      onSessionLost: () => useAuth.getState().sessionLost(),
      onPasswordChangeRequired: () => useAuth.getState().markPasswordChangeRequired(),
    });
    void useAuth.getState().init();
  }, []);

  if (status === 'loading') return <FullScreenSpinner />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={status === 'authenticated' ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route
          path="/change-password"
          element={
            <RequireAuth allowPendingPassword>
              <ChangePasswordPage />
            </RequireAuth>
          }
        />
        <Route
          path="/boards/:id"
          element={
            <RequireAuth>
              <Suspense fallback={<FullScreenSpinner />}>
                <BoardPage />
              </Suspense>
            </RequireAuth>
          }
        />
        <Route
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="assignments" element={<AssignmentsPage />} />
          <Route path="assignments/:id" element={<AssignmentPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route
            path="admin"
            element={
              <RequireAuth roles={['ADMIN']}>
                <AdminLayout />
              </RequireAuth>
            }
          >
            <Route index element={<DashboardPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="users/import" element={<ImportPage />} />
            <Route path="credentials" element={<CredentialsPage />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="classes/:id" element={<ClassPage />} />
            <Route path="audit" element={<AuditPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Routes>
      <Toasts />
    </BrowserRouter>
  );
}
