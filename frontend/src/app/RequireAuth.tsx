import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { UserRole } from '@doska/shared';
import { useAuth } from '../store/auth';
import { NotFoundPage } from '../pages/NotFoundPage';

/**
 * Защита маршрутов в интерфейсе (удобство, а не безопасность: права
 * проверяет сервер). Неавторизованных отправляет на вход с возвратом;
 * пользователя с временным паролем — на смену пароля.
 */
export function RequireAuth({
  children,
  roles,
  allowPendingPassword,
}: {
  children: ReactNode;
  roles?: UserRole[];
  allowPendingPassword?: boolean;
}) {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status !== 'authenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  if (user.mustChangePassword && !allowPendingPassword) {
    return <Navigate to="/change-password" replace />;
  }
  if (roles && !roles.includes(user.role)) {
    return <NotFoundPage />;
  }
  return <>{children}</>;
}
