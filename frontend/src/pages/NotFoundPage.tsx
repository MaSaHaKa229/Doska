import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../ui/misc';

export function NotFoundPage() {
  return (
    <main className="page">
      <EmptyState icon={<Compass size={44} />} title="Страница не найдена">
        <span>Возможно, адрес набран с ошибкой или у вас нет доступа к этому разделу.</span>
        <Link to="/" className="btn btn--primary" style={{ marginTop: 8 }}>
          На главную
        </Link>
      </EmptyState>
    </main>
  );
}
